import { workerData, parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

const {path,input} = workerData || {};
const db=new DatabaseSync(path,{readOnly:true,timeout:6500});
const begin=performance.now();
const stopWords=new Set(['и','в','во','на','с','со','к','у','по','о','об','а','но','или']);
const tokenize=value=>(String(value||'').normalize('NFKC').toLocaleLowerCase('ru')
  .match(/[\p{L}\p{N}]+/gu)||[]).filter(w=>!stopWords.has(w)).slice(0,8);
const endings=['иями','ями','ами','ого','ему','ыми','ими','ов','ев','ей','ам','ям','ах','ях','ом','ем','ую','ая','яя','ые','ие','ый','ий','ых','их','ой','ое','ее','ете','ешь','ет','ут','ют','ться','ся','а','я','ы','и','е','у'];
function stem(w){
  if(w.length<6)return w;
  for(const suffix of endings)if(w.endsWith(suffix)&&w.length-suffix.length>=4)
    return w.slice(0,-suffix.length);
  return w;
}
function distance(a,b,limit=2){
  if(Math.abs(a.length-b.length)>limit)return limit+1;
  let old=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i];
    for(let j=1;j<=b.length;j++)
      next[j]=Math.min(next[j-1]+1,old[j]+1,old[j-1]+(a[i-1]===b[j-1]?0:1));
    if(Math.min(...next)>limit)return limit+1;
    old=next;
  }
  return old[b.length];
}
function buildMatch(words,mode,fuzzy=false){
  if(mode==='phrase')return '"'+words.join(' ').replace(/"/g,'""')+'"';
  const output=[];
  for(const original of words){
    let roots=[original];
    if(mode!=='exact'){
      const base=stem(original);
      if(base!==original)roots.push(base+'*');
      else if(original.length>=5)roots.push(original+'*');
    }
    if(original.includes('ё'))roots.push(original.replaceAll('ё','е'));
    if(fuzzy&&original.length>=5){
      const head=original.slice(0,2);
      const found=db.prepare('SELECT term FROM fts_terms WHERE term>=? AND term<? LIMIT 120')
        .all(head,head+'\uffff').map(x=>x.term);
      const max=original.length>=9?2:1;
      for(const candidate of found){
        if(candidate!==original&&distance(original,candidate,max)<=max)roots.push(candidate);
      }
    }
    roots=[...new Set(roots)];
    output.push(roots.length>1?'('+roots.map(x=>x.endsWith('*')?
      '"'+x.slice(0,-1).replace(/"/g,'""')+'"*':'"'+x.replace(/"/g,'""')+'"').join(' OR ')+')':
      '"'+roots[0].replace(/"/g,'""')+'"');
  }
  return output.join(' AND ');
}
function query(ftsQuery,needle,archived,limit,offset,sort){
  // A descendant sees only messages from an ancestor up to its fork point.
  // The recursive mapping is indexed and no source message is duplicated.
  const cte=[
    'WITH RECURSIVE lineage(root,ancestor,cutoff,depth) AS (',
    'SELECT id,id,message_count,0 FROM conversations',
    'UNION ALL',
    'SELECT l.root,c.parent_id,MIN(l.cutoff,c.inherited_count),l.depth+1',
    'FROM lineage l JOIN conversations c ON c.id=l.ancestor',
    'WHERE c.parent_id IS NOT NULL AND l.depth<32',
    '), matching AS MATERIALIZED (',
    "SELECT m.conversation_id,m.sequence,bm25(message_fts) relevance,snippet(message_fts,0,'‹','›','…',15) excerpt",
    'FROM message_fts JOIN messages m ON m.rowid=message_fts.rowid',
    'WHERE message_fts MATCH ?',
    '), ranked AS MATERIALIZED (',
    'SELECT l.root id,MIN(m.relevance) rank,MIN(m.excerpt) excerpt',
    'FROM matching m JOIN lineage l ON l.ancestor=m.conversation_id',
    'WHERE m.sequence<=l.cutoff GROUP BY l.root',
    ')'
  ].join(' ');
  const filter=" FROM conversations c LEFT JOIN ranked r ON r.id=c.id WHERE c.archived=? AND (c.title LIKE ? ESCAPE '\\' OR r.id IS NOT NULL)";
  const title='%'+needle.replace(/[\\%_]/g,ch=>'\\'+ch)+'%';
  const sortSql=sort==='date'?'c.updated_at DESC,c.id DESC':
    "CASE WHEN c.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END ASC,COALESCE(r.rank,1000) ASC,c.updated_at DESC,c.id DESC";
  const params=sort==='date'?[ftsQuery,archived,title,limit,offset]:
    [ftsQuery,archived,title,title,limit,offset];
  const rows=db.prepare(cte+' SELECT c.*,r.rank,r.excerpt,COUNT(*) OVER() total'+filter+
    ' ORDER BY '+sortSql+' LIMIT ? OFFSET ?').all(...params);
  return {rows,total:rows.length?Number(rows[0].total):0};
}
try{
  if(typeof path!=='string')throw Error('Отсутствует путь к базе.');
  const text=String(input?.query||'').trim().slice(0,180);
  const words=tokenize(text);
  const archived=input?.archived?1:0;
  const sort=['date','relevance'].includes(input?.sort)?input.sort:'relevance';
  const limit=Number.isSafeInteger(input?.limit)?Math.min(100,Math.max(1,input.limit)):60;
  const offset=Number.isSafeInteger(input?.offset)?Math.max(0,input.offset):0;
  if(!words.length){
    const rows=db.prepare('SELECT c.*,COUNT(*) OVER() total FROM conversations c WHERE archived=? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(archived,limit,offset);
    parentPort?.postMessage({rows,total:rows[0]?.total||0,elapsedMs:performance.now()-begin});
  }else{
    const mode=['phrase','exact','morphology'].includes(input?.mode)?input.mode:'morphology';
    if(mode!=='phrase'&&input?.typos)db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.fts_terms USING fts5vocab(message_fts,'row')");
    let result=query(buildMatch(words,mode,false),text,archived,limit,offset,sort);
    if(!result.rows.length&&input?.typos&&mode!=='phrase')
      result=query(buildMatch(words,mode,true),text,archived,limit,offset,sort);
    parentPort?.postMessage({...result,elapsedMs:performance.now()-begin,mode});
  }
}catch(e){parentPort?.postMessage({error:e instanceof Error?e.message:'Ошибка поиска'});}
finally{db.close();}
