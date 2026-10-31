import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expired } from './recall.ts';
import type { MemoryItem } from './memory.ts';

type StudyKind='missing-source'|'conflict'|'temporal'|'association';
type StudyInput={id:string;kind:StudyKind;priority:number;description:string;refs:string[];signature:string};
type ReviewStatus='supported'|'blocked'|'uncertain'|'unverified';
type Growth={sourceChecks?:unknown[];conflicts?:unknown[];temporal?:unknown[];candidateLinks?:unknown[]};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const sensitive=/(парол|токен|api.?key|пин.?код|номер карты|паспорт|диагноз|лекарств|секрет|банковск|сч[её]т)/iu;
const safe=(m:MemoryItem|undefined)=>!!m&&m.kind==='fact'&&m.status!=='superseded'&&!expired(m)&&
  m.category!=='health'&&m.category!=='personal'&&m.category!=='people'&&!sensitive.test(m.text);
const limited=(value:unknown,max:number)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[\w-]{1,100}$/.test(x);
const refs=(list:unknown)=>Array.isArray(list)?[...new Set(list.filter(validId))].slice(0,4):[];
const version=(m:MemoryItem)=>hash(JSON.stringify([m.id,m.text,m.status,m.until,m.source,m.evidence?.map(e=>[e.version,e.role,e.source])]));
const hasIndependentProof=(m:MemoryItem)=>m.source==='user'||m.evidence?.some(e=>e.role==='user'||e.role==='note')===true;

/** All study items are source-linked *investigations*, never facts or
 * model predictions. Outcome counters are not a claim of factual accuracy. */
export function openCognitiveLearning(dataDir:string,resolve:(id:string)=>MemoryItem|undefined){
  const db=new DatabaseSync(join(dataDir,'cognitive-learning.sqlite'),{timeout:5000});
  try{
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS study (
        id TEXT PRIMARY KEY,kind TEXT NOT NULL,priority INTEGER NOT NULL,
        description TEXT NOT NULL,refs TEXT NOT NULL,signature TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open','resolved')),updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS study_focus ON study(status,priority DESC,updated_at DESC);
      CREATE TABLE IF NOT EXISTS answer_checks (
        id TEXT PRIMARY KEY,at TEXT NOT NULL,status TEXT NOT NULL
          CHECK(status IN ('supported','blocked','uncertain','unverified'))
      );
      CREATE INDEX IF NOT EXISTS answer_checks_time ON answer_checks(at DESC);
      CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY,at TEXT NOT NULL,kind TEXT NOT NULL);
    `);
    const get=db.prepare('SELECT id,signature FROM study WHERE id=?');
    const put=db.prepare(`INSERT INTO study(id,kind,priority,description,refs,signature,status,updated_at)
      VALUES(?,?,?,?,?,?,'open',?)
      ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,priority=excluded.priority,description=excluded.description,
      refs=excluded.refs,signature=excluded.signature,status='open',updated_at=excluded.updated_at`);
    const setResolved=db.prepare("UPDATE study SET status='resolved' WHERE id=?");
    const open=db.prepare("SELECT id,kind,priority,description,refs,signature,updated_at FROM study WHERE status='open' ORDER BY priority DESC,updated_at DESC LIMIT ?");
    const complete=db.prepare("SELECT COUNT(*) AS n FROM study WHERE status='resolved'");
    const inserted=db.prepare('INSERT OR IGNORE INTO answer_checks(id,at,status) VALUES(?,?,?)');
    const capAnswers=db.prepare('DELETE FROM answer_checks WHERE id NOT IN (SELECT id FROM answer_checks ORDER BY at DESC LIMIT 500)');
    const addedFeedback=db.prepare('INSERT OR IGNORE INTO feedback(id,at,kind) VALUES(?,?,?)');
    const capFeedback=db.prepare('DELETE FROM feedback WHERE id NOT IN (SELECT id FROM feedback ORDER BY at DESC LIMIT 200)');
    const answerCounts=db.prepare('SELECT status,COUNT(*) AS n FROM answer_checks GROUP BY status');
    const recent=db.prepare('SELECT status FROM answer_checks ORDER BY at DESC LIMIT 50');
    const feedbackCount=db.prepare('SELECT COUNT(*) AS n FROM feedback');
    let closed=false;
    const valid=(r:string[])=>r.length>0&&r.every(id=>safe(resolve(id)));
    function collect(growth:Growth):StudyInput[]{
      const out:StudyInput[]=[];
      const offer=(kind:StudyKind,items:string[],priority:number,label:string)=>{
        const ids=refs(items).sort();
        if(ids.length!==(kind==='missing-source'?1:2)||!valid(ids))return;
        const rows=ids.map(id=>resolve(id)!);
        // A missing-source investigation is no longer necessary after a
        // direct user quote or a validated user/note citation was added.
        if(kind==='missing-source' && hasIndependentProof(rows[0]))return;
        const signature=hash(JSON.stringify(rows.map(version)));
        const key=hash(kind+':'+ids.join(':'));
        out.push({id:key,kind,priority,description:label,refs:ids,signature});
      };
      for(const raw of (growth.sourceChecks||[]).slice(0,32)){
        const x=raw as {id?:string};if(x?.id)offer('missing-source',[x.id],90,'Найти проверяемый первоисточник для сохранённого утверждения');
      }
      for(const raw of (growth.conflicts||[]).slice(0,24)){
        const x=raw as {left?:{id:string};right?:{id:string}};
        if(x?.left?.id&&x?.right?.id)offer('conflict',[x.left.id,x.right.id],85,'Проверить возможное противоречие по исходным записям');
      }
      for(const raw of (growth.temporal||[]).slice(0,16)){
        const x=raw as {ids?:string[]};if(x?.ids)offer('temporal',x.ids,65,'Сопоставить дату и актуальность двух записей');
      }
      for(const raw of (growth.candidateLinks||[]).slice(0,48)){
        const x=raw as {left?:{id:string};right?:{id:string}};
        if(x?.left?.id&&x?.right?.id)offer('association',[x.left.id,x.right.id],25,'Уточнить возможную связь, не выводя причинность из сходства слов');
      }
      return out.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)).slice(0,90);
    }
    function update(growth:Growth){
      if(closed)return 0;
      const items=collect(growth),now=new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try{
        for(const x of items){
          const prev=get.get(x.id) as {signature:string}|undefined;
          if(prev?.signature===x.signature)continue;
          put.run(x.id,x.kind,x.priority,x.description,JSON.stringify(x.refs),x.signature,now);
        }
        // Closed investigations are not deleted; they remain in the audit
        // trail, but no longer influence focus or memory context.
        for(const row of open.all(250) as {id:string;refs:string;signature:string;kind:StudyKind}[]){
          const ids=refs(JSON.parse(row.refs));
          const records=ids.map(resolve);
          if(!valid(ids)||row.signature!==hash(JSON.stringify(records.map(x=>x?version(x):'')))||
             (row.kind==='missing-source'&&records[0]&&hasIndependentProof(records[0])))
            setResolved.run(row.id);
        }
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e}
      return items.length;
    }
    function focus(){
      if(closed)return [];
      return (open.all(80) as {id:string;kind:StudyKind;priority:number;description:string;refs:string;signature:string}[])
        .map(row=>({...row,refs:refs(JSON.parse(row.refs))}))
        .filter(row=>valid(row.refs)&&row.signature===hash(JSON.stringify(row.refs.map(id=>version(resolve(id)!)))))
        .slice(0,5).map(row=>({kind:row.kind,priority:row.priority,description:row.description,refs:row.refs}));
    }
    function recordAnswer(id:string,status:ReviewStatus){
      if(closed||!/^[a-f0-9]{64}$/.test(id)||!['supported','blocked','uncertain','unverified'].includes(status))return false;
      const changed=inserted.run(id,new Date().toISOString(),status).changes>0;
      capAnswers.run();return changed;
    }
    function feedback(id:string){
      if(closed||!/^[a-f0-9]{64}$/.test(id))return false;
      const changed=addedFeedback.run(id,new Date().toISOString(),'undo').changes>0;
      capFeedback.run();return changed;
    }
    function overview(){
      const counts={supported:0,blocked:0,uncertain:0,unverified:0};
      for(const row of answerCounts.all() as {status:ReviewStatus;n:number}[])counts[row.status]=row.n;
      const window={supported:0,blocked:0,uncertain:0,unverified:0};
      for(const row of recent.all() as {status:ReviewStatus}[])window[row.status]++;
      const checked=window.supported+window.blocked+window.uncertain;
      const outcomes=(recent.all() as {status:ReviewStatus}[]).map(x=>x.status);
      const pass=(part:ReviewStatus[])=>{
        const checked=part.filter(x=>x!=='unverified');
        return checked.length>=5?Math.round(100*checked.filter(x=>x==='supported').length/checked.length):null;
      };
      const recentRate=pass(outcomes.slice(0,25)),previousRate=pass(outcomes.slice(25,50));
      const trend=recentRate===null||previousRate===null?'insufficient':
        recentRate>=previousRate+5?'improving':recentRate<=previousRate-5?'declining':'stable';
      return {focus:focus(),resolved:(complete.get() as {n:number}).n,
        quality:{total:Object.values(counts).reduce((a,b)=>a+b,0),checked,
          supported:window.supported,blocked:window.blocked,uncertain:window.uncertain,
          unverified:window.unverified,userUndos:(feedbackCount.get() as {n:number}).n,
          supportRate:checked>=5?Math.round(100*window.supported/checked):null,
          recentRate,previousRate,trend,
          caveat:'Доля ответов, прошедших формальную проверку источников, не истинная точность. Данные: последние 50 ответов.'}};
    }
    function clear(){if(!closed){db.exec('DELETE FROM study; DELETE FROM answer_checks; DELETE FROM feedback');}}
    function close(){if(!closed){closed=true;db.close();}}
    return {update,focus,recordAnswer,feedback,overview,clear,close};
  }catch(e){db.close();throw e}
}
