import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

export type CognitiveJobKind = 'changes' | 'archive' | 'evaluation';
export type CognitiveJob = {kind:CognitiveJobKind;fingerprint:string;priority:number;attempts:number;due:number};
const known=['changes','archive','evaluation'];
export function openCognitiveJobs(dataDir:string) {
  const db=new DatabaseSync(join(dataDir,'cognitive-jobs.sqlite'),{timeout:5000});
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS jobs (
        kind TEXT PRIMARY KEY CHECK(kind IN ('changes','archive','evaluation')),
        fingerprint TEXT NOT NULL, priority INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        due INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running'))
      );
      CREATE TABLE IF NOT EXISTS run_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, fingerprint TEXT NOT NULL,
        at TEXT NOT NULL, strategy TEXT NOT NULL,
        lexical REAL NOT NULL, graph REAL NOT NULL, examples INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_by_due ON jobs(status,due,priority);
    `);
    // Interrupted jobs are safe to repeat: results are derived, never applied to user facts.
    db.prepare("UPDATE jobs SET status='queued' WHERE status='running'").run();
    const set=db.prepare(`INSERT INTO jobs(kind,fingerprint,priority,attempts,due,status)
      VALUES(?,?,?,0,?,'queued') ON CONFLICT(kind) DO UPDATE SET
      fingerprint=excluded.fingerprint,priority=excluded.priority,
      attempts=CASE WHEN fingerprint=excluded.fingerprint THEN jobs.attempts ELSE 0 END,
      due=excluded.due,status='queued'
      WHERE jobs.fingerprint<>excluded.fingerprint`);
    const due=db.prepare("SELECT kind,fingerprint,priority,attempts,due FROM jobs WHERE status='queued' AND due<=? ORDER BY priority DESC,due ASC LIMIT 1");
    const mark=db.prepare("UPDATE jobs SET status='running',attempts=attempts+1 WHERE kind=? AND fingerprint=?");
    const complete=db.prepare('DELETE FROM jobs WHERE kind=? AND fingerprint=?');
    const failed=db.prepare("UPDATE jobs SET status='queued',due=? WHERE kind=? AND fingerprint=?");
    const count=db.prepare('SELECT COUNT(*) AS total FROM jobs');
    const next=db.prepare("SELECT MIN(due) AS due FROM jobs WHERE status='queued'");
    const all=db.prepare("SELECT kind,fingerprint,priority,attempts,due FROM jobs");
    const history=db.prepare('INSERT INTO run_history(kind,fingerprint,at,strategy,lexical,graph,examples) VALUES(?,?,?,?,?,?,?)');
    const recent=db.prepare('SELECT strategy,lexical,graph,examples FROM run_history WHERE kind=? ORDER BY id DESC LIMIT 6');
    const closeHistory=db.prepare('DELETE FROM run_history WHERE id NOT IN (SELECT id FROM run_history ORDER BY id DESC LIMIT 120)');
    let closed=false;
    return {
      enqueue(kind:CognitiveJobKind,fingerprint:string,priority=1,when=Date.now()) {
        if(closed||!known.includes(kind)||!/^[a-f0-9]{64}$/.test(fingerprint))return;
        set.run(kind,fingerprint,priority,when);
      },
      take(now=Date.now()):CognitiveJob|null {
        if(closed)return null;
        const job=due.get(now) as CognitiveJob|undefined;
        if(!job)return null;
        mark.run(job.kind,job.fingerprint);
        return {...job,attempts:job.attempts+1};
      },
      finish(job:CognitiveJob){if(!closed)complete.run(job.kind,job.fingerprint);},
      retry(job:CognitiveJob,now=Date.now()){
        if(closed)return;
        const delay=Math.min(60*60_000,2_000*2**Math.min(10,job.attempts));
        failed.run(now+delay,job.kind,job.fingerprint);
      },
      record(job:CognitiveJob,metrics:{lexicalRecallAt3:number;graphRecallAt3:number;retrievalExamples:number},strategy:string){
        if(closed)return;
        history.run(job.kind,job.fingerprint,new Date().toISOString(),strategy,
          metrics.lexicalRecallAt3,metrics.graphRecallAt3,metrics.retrievalExamples);
        closeHistory.run();
      },
      history(kind:CognitiveJobKind='changes'){
        return recent.all(kind) as {strategy:string;lexical:number;graph:number;examples:number}[];
      },
      overview(){return {queued:(count.get() as {total:number}).total, next:(next.get() as {due:number|null}).due};},
      pending(){return all.all() as CognitiveJob[];},
      clear(){if(!closed){db.exec('DELETE FROM jobs; DELETE FROM run_history;');}},
      close(){if(!closed){closed=true;db.close();}}
    };
  } catch(e){db.close();throw e;}
}
