import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expired, overlap, tokens } from './recall.ts';
import type { MemoryItem } from './memory.ts';

type Kind='topic'|'association'|'route'|'temporal';
type State='observed'|'hypothesis';
type Note={id:string;kind:Kind;title:string;basis:string;refs:string[];versions:Record<string,string>;state:State;firstSeen:string;lastSeen:string;observations:number};
type Proposal={kind:Kind;title:string;basis:string;refs:string[];state:State;key:string};
type Growth={branches?:unknown[];candidateLinks?:unknown[];paths?:unknown[];temporal?:unknown[]};
const idOk=(x:unknown):x is string=>typeof x==='string' && /^[\w-]{1,100}$/.test(x);
const short=(x:unknown,max:number)=>typeof x==='string' ? x.replace(/\s+/g,' ').trim().slice(0,max) : '';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const permitted=(x:MemoryItem|undefined,now=Date.now())=>!!x && x.kind==='fact' &&
  x.status==='active' && !expired(x,now) &&
  (x.source==='user'||x.evidence?.some(e=>e.role==='user'||e.role==='note')===true);
const needed=(kind:Kind)=>kind==='topic'?3:2;

/**
 * The notebook is a separate DERIVED memory, not a source of verified facts.
 * It stores only source references and a transparent relation description.
 * Originals remain in memory.json/memory-archive.sqlite.
 */
export function openCognitiveNotebook(dataDir:string,resolve:(id:string)=>MemoryItem|undefined){
  const db=new DatabaseSync(join(dataDir,'cognitive-notebook.sqlite'),{timeout:5000});
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS notes(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,basis TEXT NOT NULL,
        refs TEXT NOT NULL,versions TEXT NOT NULL,state TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,
        observations INTEGER NOT NULL,tier INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS processed(
        job TEXT PRIMARY KEY,at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notes_by_seen ON notes(tier,last_seen DESC);
      CREATE TABLE IF NOT EXISTS inquiries(
        key TEXT PRIMARY KEY, question_id TEXT NOT NULL UNIQUE,
        created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open','answered','dismissed'))
      );
      CREATE INDEX IF NOT EXISTS inquiries_created ON inquiries(created DESC);
    `);
    const lookup=db.prepare('SELECT * FROM notes WHERE id=?');
    const put=db.prepare(`INSERT INTO notes(id,kind,title,basis,refs,versions,state,first_seen,last_seen,observations,tier)
      VALUES(?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,basis=excluded.basis,refs=excluded.refs,versions=excluded.versions,state=excluded.state,
        last_seen=excluded.last_seen,observations=notes.observations+1,tier=1`);
    const processed=db.prepare('SELECT job FROM processed WHERE job=?');
    const mark=db.prepare('INSERT OR IGNORE INTO processed(job,at) VALUES(?,?)');
    const capProcessed=db.prepare('DELETE FROM processed WHERE job NOT IN (SELECT job FROM processed ORDER BY at DESC LIMIT 1000)');
    // Keep historical notebook entries on disk; only the newest 3,000 are hot.
    const capNotes=db.prepare('UPDATE notes SET tier=0 WHERE tier=1 AND id NOT IN (SELECT id FROM notes ORDER BY last_seen DESC LIMIT 3000)');
    const list=db.prepare('SELECT * FROM notes WHERE tier=1 ORDER BY last_seen DESC LIMIT ?');
    const hot=db.prepare('SELECT * FROM notes WHERE tier=1 LIMIT 3000');
    const all=db.prepare('SELECT * FROM notes');
    const del=db.prepare('DELETE FROM notes WHERE id=?');
    const updateRefs=db.prepare('UPDATE notes SET refs=?,versions=? WHERE id=?');
    const totals=db.prepare('SELECT kind,state,count(*) AS amount FROM notes GROUP BY kind,state');
    const inquiryExists=db.prepare('SELECT key FROM inquiries WHERE key=?');
    const inquiryLatest=db.prepare('SELECT created FROM inquiries ORDER BY created DESC LIMIT 1');
    const inquiryPut=db.prepare("INSERT OR IGNORE INTO inquiries(key,question_id,created,status) VALUES(?,?,?,'open')");
    const inquiryDone=db.prepare("UPDATE inquiries SET status=? WHERE question_id=?");
    const inquiryStats=db.prepare("SELECT status,count(*) AS count FROM inquiries GROUP BY status");
    let closed=false;
    const validRefs=(refs:unknown)=>Array.isArray(refs) ? [...new Set(refs.filter(idOk))].slice(0,30) : [];
    const read=(row:any):Note=>({id:row.id,kind:row.kind,title:row.title,basis:row.basis,
      refs:validRefs(JSON.parse(row.refs)),versions:JSON.parse(row.versions),state:row.state,firstSeen:row.first_seen,
      lastSeen:row.last_seen,observations:row.observations});
    const currentVersion=(id:string)=>{
      const record=resolve(id);
      return permitted(record) ? hash(JSON.stringify([record!.text,record!.status,record!.source,
        record!.until,record!.evidence?.map(e=>[e.source,e.version,e.role])])) : '';
    };
    const canUse=(refs:string[],versions?:Record<string,string>)=>
      refs.filter(id=>{const v=currentVersion(id);return !!v && (!versions || versions[id]===v);});
    function proposals(growth:Growth):Proposal[]{
      const out:Proposal[]=[];
      for(const raw of (growth.branches||[]).slice(0,12)){
        const x=raw as any;
        const refs=validRefs(x?.ids);
        if(refs.length<3 || !short(x.title,80))continue;
        const category=short(x.category,30);
        out.push({kind:'topic',title:short(x.title,80),basis:'Повторяющаяся тема подтверждённых записей',
          refs,state:'observed',key:'topic:'+category+':'+short(x.title,80)});
      }
      for(const raw of (growth.candidateLinks||[]).slice(0,48)){
        const x=raw as any;
        const refs=validRefs([x?.left?.id,x?.right?.id]).sort();
        if(refs.length!==2)continue;
        out.push({kind:'association',title:'Возможная смысловая связь',
          basis:'Сходство формулировок: не доказательство истинности или причинности',
          refs,state:'hypothesis',key:'association:'+refs.join(':')});
      }
      for(const raw of (growth.paths||[]).slice(0,10)){
        const x=raw as any,refs=validRefs(x?.ids);
        if(refs.length<3)continue;
        out.push({kind:'route',title:'Связанные через граф знания',
          basis:'Многошаговый маршрут существующих связей, без утверждения причинности',
          refs,state:'hypothesis',key:'route:'+refs.join(':')});
      }
      for(const raw of (growth.temporal||[]).slice(0,16)){
        const x=raw as any,refs=validRefs(x?.ids).sort();
        if(refs.length<2)continue;
        out.push({kind:'temporal',title:'Возможное изменение во времени',
          basis:'Разные даты не означают противоречие',
          refs,state:'hypothesis',key:'temporal:'+refs.join(':')});
      }
      return out;
    }
    function transaction(fn:()=>void){
      db.exec('BEGIN IMMEDIATE');
      try{fn();db.exec('COMMIT');}
      catch(e){db.exec('ROLLBACK');throw e;}
    }
    function learn(growth:Growth,job:string){
      if(closed||!/^([a-z]+:)?[a-f0-9]{64}$/.test(job))return 0;
      if(processed.get(job))return 0;
      const now=new Date().toISOString();
      let saved=0;
      transaction(()=>{
        for(const proposal of proposals(growth).slice(0,80)){
          const refs=canUse(proposal.refs);
          if(refs.length<needed(proposal.kind))continue;
          const key=hash(proposal.key);
          const prior=lookup.get(key) as any;
          // Merge newly observed sources without treating repeat runs as new evidence.
          const previous=prior?canUse(read(prior).refs,read(prior).versions):[];
          const merged=[...new Set([...previous,...refs])].slice(0,30);
          if(merged.length<needed(proposal.kind))continue;
          const versions=Object.fromEntries(merged.map(id=>[id,currentVersion(id)]));
          put.run(key,proposal.kind,proposal.title,proposal.basis,
            JSON.stringify(merged),JSON.stringify(versions),proposal.state,prior?.first_seen||now,now,
            prior?.observations||1);
          saved++;
        }
        mark.run(job,now);
        capNotes.run();
        capProcessed.run();
      });
      return saved;
    }
    function reconcile(){
      if(closed)return 0;
      let removed=0;
      transaction(()=>{
        for(const raw of hot.all() as any[]){
          const note=read(raw),fresh=canUse(note.refs,note.versions);
          if(fresh.length<needed(note.kind)){
            del.run(note.id);removed++;continue;
          }
          if(fresh.length!==note.refs.length){
            updateRefs.run(JSON.stringify(fresh),JSON.stringify(Object.fromEntries(fresh.map(id=>[id,note.versions[id]]))),note.id);
          }
        }
      });
      return removed;
    }
    function eraseSource(id:string){
      if(closed)return;
      // Resolve now rejects erased facts; also purge even if memory still holds a
      // transient copy during asynchronous deletion/forgetting.
      transaction(()=>{
        for(const raw of all.all() as any[]){
          const note=read(raw);
          if(!note.refs.includes(id))continue;
          const refs=canUse(note.refs.filter(x=>x!==id),note.versions);
          if(refs.length<needed(note.kind))del.run(note.id);
          else updateRefs.run(JSON.stringify(refs),JSON.stringify(Object.fromEntries(refs.map(x=>[x,note.versions[x]]))),note.id);
        }
      });
    }
    function context(query:string){
      if(closed||!query.trim())return '';
      const q=tokens(query);
      if(!q.size)return '';
      const ranked=(list.all(200) as any[]).map(read).filter(n=>n.state==='observed')
        .map(n=>{
          const refs=canUse(n.refs,n.versions).map(resolve).filter((x):x is MemoryItem=>permitted(x));
          const exact=overlap(q,tokens(n.title));
          const related=refs.reduce((n,x)=>n+overlap(q,tokens(x.text)),0);
          return {note:n,refs,score:exact*4+related};
        }).filter(x=>x.refs.length>=3&&x.score>0)
        .sort((a,b)=>b.score-a.score || b.note.lastSeen.localeCompare(a.note.lastSeen)).slice(0,2);
      if(!ranked.length)return '';
      const out=['Автоматически организованная когнитивная память: это группы уже записанных фактов, не новые фактические утверждения.'];
      for(const {note,refs} of ranked){
        const line='- Тема «'+note.title+'» ('+refs.length+' связанных сохранённых записей): '+
          refs.slice(0,2).map(x=>x.text.slice(0,150)).join(' / ');
        if(out.join('\n').length+line.length>1100)break;
        out.push(line);
      }
      return out.length>1?out.join('\n'):'';
    }
    function overview(){
      const count={total:0,observed:0,hypotheses:0,topics:0};
      for(const row of totals.all() as {kind:Kind;state:State;amount:number}[]){
        count.total+=row.amount;
        if(row.state==='observed')count.observed+=row.amount;
        else count.hypotheses+=row.amount;
        if(row.kind==='topic')count.topics+=row.amount;
      }
      return { ...count,latest:(list.all(10) as any[]).map(read)
        .filter(n=>canUse(n.refs,n.versions).length>=needed(n.kind))
        .map(n=>({kind:n.kind,state:n.state,title:n.title,refs:n.refs.length,
          observations:n.observations,firstSeen:n.firstSeen,lastSeen:n.lastSeen})) };
    }
    function wasAsked(key:string){return !closed&&/^[a-f0-9]{64}$/.test(key)&&!!inquiryExists.get(key);}
    function rememberInquiry(key:string,questionId:string){
      if(closed||!/^[a-f0-9]{64}$/.test(key)||!idOk(questionId))return false;
      return inquiryPut.run(key,questionId,new Date().toISOString()).changes>0;
    }
    function settleInquiry(questionId:string,status:'answered'|'dismissed'){
      if(!closed&&idOk(questionId))inquiryDone.run(status,questionId);
    }
    function lastInquiryAt(){
      const row=inquiryLatest.get() as {created?:string}|undefined;
      return row?.created?Date.parse(row.created):0;
    }
    function curiosityOverview(){
      const stats={open:0,answered:0,dismissed:0};
      for(const row of inquiryStats.all() as {status:'open'|'answered'|'dismissed';count:number}[])
        stats[row.status]=row.count;
      return stats;
    }
    function clear(){
      if(!closed)transaction(()=>{db.exec('DELETE FROM notes; DELETE FROM processed; DELETE FROM inquiries');});
    }
    function close(){if(!closed){closed=true;db.close();}}
    return {learn,overview,context,reconcile,eraseSource,wasAsked,rememberInquiry,settleInquiry,lastInquiryAt,curiosityOverview,clear,close};
  }catch(e){db.close();throw e;}
}
