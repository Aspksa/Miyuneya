import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Memory, MemoryItem, Episode, Edge } from './memory.ts';
import { expired, strength, tokens, overlap } from './recall.ts';

// The archive is local and lossless for *saved* records. No cloud calls and no
// deletion when active-memory budgets are reached. User deletion is different.
type Kind = 'fact' | 'rule' | 'episode' | 'edge';
type Row = { kind: Kind; id: string; searchable: string; payload: string; tier: number };
const edgeId = (edge: Edge) => JSON.stringify([edge.from, edge.to, edge.type]);
const limited = (value: number, max: number) => Math.max(1, Math.min(max, value));

export async function openMemoryArchive(dataDir: string) {
  await mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'memory-archive.sqlite'), { timeout: 5000 });
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS entries (
        kind TEXT NOT NULL CHECK(kind IN ('fact','rule','episode','edge')),
        id TEXT NOT NULL,
        searchable TEXT NOT NULL,
        payload TEXT NOT NULL,
        tier INTEGER NOT NULL CHECK(tier IN (0,1)),
        PRIMARY KEY(kind,id)
      );
      CREATE INDEX IF NOT EXISTS entries_by_tier ON entries(tier,kind);
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(searchable, content='entries', content_rowid='rowid', tokenize='unicode61');
      CREATE TRIGGER IF NOT EXISTS archive_insert AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid,searchable) VALUES(new.rowid,new.searchable);
      END;
      CREATE TRIGGER IF NOT EXISTS archive_delete AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts,rowid,searchable) VALUES('delete',old.rowid,old.searchable);
      END;
      CREATE TRIGGER IF NOT EXISTS archive_update AFTER UPDATE OF searchable ON entries WHEN old.searchable<>new.searchable BEGIN
        INSERT INTO entries_fts(entries_fts,rowid,searchable) VALUES('delete',old.rowid,old.searchable);
        INSERT INTO entries_fts(rowid,searchable) VALUES(new.rowid,new.searchable);
      END;`);
    const insert = db.prepare(`INSERT INTO entries(kind,id,searchable,payload,tier) VALUES(?,?,?,?,?)
      ON CONFLICT(kind,id) DO UPDATE SET searchable=excluded.searchable,payload=excluded.payload,tier=excluded.tier
      WHERE searchable<>excluded.searchable OR payload<>excluded.payload OR tier<>excluded.tier`);
    const setCold = db.prepare('UPDATE entries SET tier=0 WHERE tier=1');
    const summary = db.prepare('SELECT kind,tier,count(*) AS count FROM entries GROUP BY kind,tier');
    const removeOne = db.prepare('DELETE FROM entries WHERE kind=? AND id=?');
    const removeEdges = db.prepare("DELETE FROM entries WHERE kind='edge' AND (json_extract(payload,'$.from')=? OR json_extract(payload,'$.to')=?)");
    const deleteEdgePair = db.prepare("DELETE FROM entries WHERE kind='edge' AND ((json_extract(payload,'$.from')=? AND json_extract(payload,'$.to')=?) OR (json_extract(payload,'$.from')=? AND json_extract(payload,'$.to')=?))");
    const searchStmt = db.prepare(`SELECT e.kind,e.id,e.searchable,e.payload,e.tier FROM entries_fts f
      JOIN entries e ON e.rowid=f.rowid
      WHERE entries_fts MATCH ? AND e.tier=0 AND e.kind IN ('fact','rule','episode')
      ORDER BY bm25(entries_fts),e.rowid DESC LIMIT ?`);
    const coldItemRows = db.prepare("SELECT kind,id,searchable,payload,tier FROM entries WHERE tier=0 AND kind IN ('fact','rule','episode')");
    const allRows = db.prepare('SELECT kind,id,searchable,payload,tier FROM entries ORDER BY kind,id');
    const pageRows = db.prepare("SELECT kind,id,payload FROM entries WHERE tier=0 AND kind IN ('fact','rule') ORDER BY kind,id LIMIT ? OFFSET ?");
    const coldCount = db.prepare("SELECT count(*) AS total FROM entries WHERE tier=0 AND kind IN ('fact','rule')");

    let closed = false;

    function transaction(fn: () => void) {
      if (closed) throw Error('Архив памяти закрыт');
      db.exec('BEGIN IMMEDIATE');
      try { fn(); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    // First persist all current records, *then* reduce only the hot in-memory tier.
    // A crash between SQLite COMMIT and writing memory.json leaves duplicates, not loss.
    function compact(memory: Memory, caps: { items: number; episodes: number; edges: number }, now = Date.now()) {
      const items = [...memory.items].reverse();
      const pinned = items.filter(x => x.pinned).length;
      const keepItems = new Set(items
        .sort((a,b)=>Number(b.pinned)-Number(a.pinned) ||
          Number(b.status==='active')-Number(a.status==='active') ||
          strength(b,now)-strength(a,now) || b.seen.localeCompare(a.seen))
        .slice(0, Math.max(caps.items,pinned)).map(x=>x.id));
      const episodes = [...memory.episodes];
      const pending = episodes.filter(x=>!x.consolidated);
      const keepEpisodes = new Set([...pending, ...episodes.slice(-Math.max(caps.episodes,pending.length))].map(x=>x.id));
      const edges = memory.edges;
      const hotEdges = new Set(edges.slice(-caps.edges).map(edgeId));
      transaction(() => {
        setCold.run();
        for (const item of memory.items) insert.run(item.kind,item.id,item.text,JSON.stringify(item),keepItems.has(item.id)?1:0);
        for (const episode of memory.episodes) insert.run('episode',episode.id,episode.topic+' '+episode.outcome,JSON.stringify(episode),keepEpisodes.has(episode.id)?1:0);
        for (const edge of edges) insert.run('edge',edgeId(edge),edge.from+' '+edge.to+' '+edge.type,JSON.stringify(edge),hotEdges.has(edgeId(edge))?1:0);
      });
      memory.items = memory.items.filter(x=>keepItems.has(x.id));
      memory.episodes = memory.episodes.filter(x=>keepEpisodes.has(x.id));
      memory.edges = memory.edges.filter(x=>hotEdges.has(edgeId(x)));
    }
    // Bounded read-only archive pages for autonomous analysis; no bulk loading.
    function page(offset=0,limit=48) {
      const total=(coldCount.get() as {total:number}).total;
      const start=total>0 ? Math.max(0,Math.trunc(Number.isFinite(offset)?offset:0))%total : 0;
      const take=Math.max(1,Math.min(80,Math.trunc(Number.isFinite(limit)?limit:48)));
      return {total,offset:start,items:(pageRows.all(take,start) as {kind:Kind;id:string;payload:string}[])
        .map(row=>JSON.parse(row.payload) as MemoryItem)};
    }
    function stats() {
      const count = { active: {facts:0,episodes:0,edges:0}, archived:{facts:0,episodes:0,edges:0} };
      for (const row of summary.all() as {kind:Kind;tier:number;count:number}[]) {
        const group = row.tier===1?count.active:count.archived;
        if (row.kind==='fact'||row.kind==='rule') group.facts+=row.count;
        else if (row.kind==='episode') group.episodes+=row.count;
        else group.edges+=row.count;
      }
      return count;
    }
    function search(query: string, limit=12, now=Date.now(), safeOnly=false) {
      if (typeof query!=='string'||query.length>4000) return [];
      const terms=[...new Set((query.match(/[\p{L}\p{N}]{2,}/gu)||[]).map(s=>s.toLocaleLowerCase('ru')))].slice(0,12);
      if (!terms.length) return [];
      const match=terms.map(s=>'"'+s.replaceAll('"','""')+'"').join(' OR ');
      const candidates=searchStmt.all(match,limited(limit*12,240)) as Row[];
      const relevant=candidates.map(row=>{
        const data=JSON.parse(row.payload) as MemoryItem | Episode;
        const lexical=overlap(tokens(query),tokens(row.searchable));
        return {kind:row.kind,id:row.id,text:row.searchable,data,score:lexical};
      }).filter(x=>x.score>0 && (x.kind==='episode'||(!expired(x.data as MemoryItem,now) && (!safeOnly|| (x.data as MemoryItem).status==='active'))))
        .sort((a,b)=>b.score-a.score).slice(0,limited(limit,100));
      return relevant;
    }
    function recall(query: string, now=Date.now()) {
      const results=search(query,5,now,true);
      const lines=results.map(x => x.kind==='episode'
        ? 'Исторический эпизод: '+x.text
        : 'Ранее сохранённый факт (архив, проверь актуальность): '+x.text);
      let remaining=1400;
      return lines.filter(line=>{if(line.length>remaining)return false;remaining-=line.length+1;return true;}).join('\n');
    }
    function forget(query: string) {
      const words=tokens(query);
      if(!words.size)return [];
      const matches=(text:string)=>overlap(words,tokens(text))/words.size>=0.6;
      const rows=(coldItemRows.all() as Row[]).map(row=>({row,data:JSON.parse(row.payload) as MemoryItem | Episode}));
      const removedIds=new Set<string>();
      for(const {row,data} of rows) {
        if(matches(row.searchable) || ('evidence' in data && data.evidence?.some(e=>matches(e.quote))))removedIds.add(row.id);
      }
      // A forgotten episode can be the sole provenance of related historical facts.
      let grew=true;
      while(grew){
        grew=false;
        for(const {row,data} of rows) {
          if(removedIds.has(row.id)||row.kind==='episode')continue;
          const fact=data as MemoryItem;
          if((fact.origin && removedIds.has(fact.origin)) || fact.links.some(id=>removedIds.has(id))) {
            removedIds.add(row.id);grew=true;
          }
        }
      }
      const removed:string[]=[];
      transaction(()=>{
        for(const {row,data} of rows)if(removedIds.has(row.id)){
          if(row.kind!=='episode')removed.push((data as MemoryItem).text);
          removeOne.run(row.kind,row.id);
          removeEdges.run(row.id);
        }
      });
      return removed;
    }
    function erase(id:string) {
      transaction(()=>{for(const kind of ['fact','rule','episode'] as const)removeOne.run(kind,id);removeEdges.run(id);});
    }
    function unlink(from:string,to:string) {transaction(()=>{deleteEdgePair.run(from,to,to,from);});}
    function clear() {transaction(()=>{db.exec('DELETE FROM entries');});}
    function close(){if(!closed){closed=true;db.close();}}
    return {compact,stats,page,search,recall,forget,erase,unlink,clear,close};
  } catch (error) { db.close(); throw error; }
}
