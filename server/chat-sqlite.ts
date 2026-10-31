import { DatabaseSync, backup } from 'node:sqlite';
import { acquireDatabaseWriter, ensureSpace } from './chat-db-safety.ts';
import { searchInWorker } from './chat-search.ts';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { openChatArchive as openLegacyArchive } from './chat-archive.ts';

export type ChatMessage={id:string;role:'user'|'assistant';content:string;createdAt:string;version:number;complete:boolean;parentMessageId?:string|null};
export type ChatQuery={query?:string;offset?:number;limit?:number;archived?:boolean;mode?:'morphology'|'exact'|'phrase';typos?:boolean;sort?:'relevance'|'date'};
export type ChatMeta={id:string;title:string;createdAt:string;updatedAt:string;messageCount:number;archived:boolean;parentId?:string;forkMessageId?:string};
type Row=Record<string,any>;
const idOK=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
const dateOK=(x:unknown):x is string=>typeof x==='string'&&x.length<=35&&Number.isFinite(Date.parse(x));
const error=(m:string,status=400)=>Object.assign(new Error(m),{status});
const safeId=(x:unknown)=>{if(!idOK(x))throw error('Неверный идентификатор.');return x;};
const now=()=>new Date().toISOString();
const integer=(value:unknown,fallback:number,max=1_000_000_000)=>
  Number.isSafeInteger(value)&&Number(value)>=0?Math.min(Number(value),max):fallback;
const messageOK=(m:unknown):m is ChatMessage=>{
  const x=m as ChatMessage;
  return !!x&&idOK(x.id)&&(x.role==='user'||x.role==='assistant')
    &&typeof x.content==='string'&&x.content.length<=10_000_000
    &&dateOK(x.createdAt)&&Number.isSafeInteger(x.version)&&x.version>=1
    &&typeof x.complete==='boolean'
    &&(x.parentMessageId===undefined||x.parentMessageId===null||idOK(x.parentMessageId));
};
// Legacy v1/v2 ids can repeat between dialogs. Hash them deterministically to
// preserve idempotency and enforce a global UNIQUE constraint in SQLite.
const normalizedId=(conversation:string,id:string)=>
  id.startsWith('legacy-')?'m_'+createHash('sha256').update(conversation+'\0'+id).digest('hex').slice(0,46):id;

export async function openSqliteChatArchive(dataDir:string){
  const home=join(dataDir,'chats'),path=join(home,'archive.sqlite');
  await mkdir(home,{recursive:true});
  const previousSize=await stat(path).then(v=>v.size).catch(e=>{
    if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;
    throw e;
  });
  const releaseLock=await acquireDatabaseWriter(path);
  let db:DatabaseSync;
  try{db=new DatabaseSync(path,{timeout:5000});}
  catch(e){await releaseLock();throw e;}
  try{
  const timings=new Map<string,{count:number;sum:number;max:number}>();
  const warnings:string[]=[];
  let readOnly=false,closed=false;
  let busyMs=5000;
  const pageCache=new Map<string,{size:number;result:ReturnType<typeof makePage>}>();
  let cachedBytes=0;
  function makePage(c:Row,records:Row[],start:number,count:number){
    return {conversation:formatConversation(c),messages:records.map(formatMessage),
      total:count,nextBefore:start?start:null};
  }
  const clearPageCache=()=>{pageCache.clear();cachedBytes=0;};

  const timed=<T>(key:string,run:()=>T):T=>{
    const start=performance.now();
    try{return run();}
    finally{const ms=performance.now()-start;const s=timings.get(key)||{count:0,sum:0,max:0};
      s.count++;s.sum+=ms;s.max=Math.max(ms,s.max);timings.set(key,s);}
  };
  const write=<T>(key:string,run:()=>T):T=>{
    if(readOnly)throw error('Хранилище повреждено. Режим только чтения: запись запрещена.',503);
    return timed(key,()=>{
      db.exec('BEGIN IMMEDIATE');
      try{
        const value=run();db.exec('COMMIT');
        if(['save','create','modify'].includes(key))clearPageCache();
        return value;
      }catch(e){
        try{db.exec('ROLLBACK');}catch{}
        const message=(e as Error).message||'';
        if(/SQLITE_BUSY|database is locked/i.test(message)){
          busyMs=Math.min(12000,busyMs+1000);
          db.exec('PRAGMA busy_timeout='+busyMs);
          warnings.push('Блокировка SQLite: тайм-аут увеличен до '+busyMs+' мс.');
        }
        if(/SQLITE_FULL|disk I\/O|database disk image is malformed/i.test(message))
          warnings.push('Ошибка диска: запись не подтверждена.');
        throw e;
      }
    });
  };
  const schema=[
    'CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,message_count INTEGER NOT NULL DEFAULT 0,parent_id TEXT REFERENCES conversations(id),fork_message_id TEXT,inherited_count INTEGER NOT NULL DEFAULT 0);',
    'CREATE INDEX IF NOT EXISTS conversations_updated ON conversations(archived,updated_at DESC);',
    'CREATE INDEX IF NOT EXISTS conversations_parent ON conversations(parent_id,inherited_count);',
    'CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),sequence INTEGER NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,version INTEGER NOT NULL,complete INTEGER NOT NULL,parent_message_id TEXT,UNIQUE(conversation_id,sequence));',
    'CREATE INDEX IF NOT EXISTS messages_paging ON messages(conversation_id,sequence DESC);',
    'CREATE INDEX IF NOT EXISTS messages_created ON messages(created_at);',
    'CREATE INDEX IF NOT EXISTS messages_parent ON messages(parent_message_id);',
    'CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages(conversation_id,created_at DESC,id);',
    "CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(content,content='messages',content_rowid='rowid',tokenize='unicode61');",
    "CREATE TRIGGER IF NOT EXISTS fts_ins AFTER INSERT ON messages BEGIN INSERT INTO message_fts(rowid,content) VALUES(new.rowid,new.content); END;",
    "CREATE TRIGGER IF NOT EXISTS fts_del AFTER DELETE ON messages BEGIN INSERT INTO message_fts(message_fts,rowid,content) VALUES('delete',old.rowid,old.content); END;",
    "CREATE TRIGGER IF NOT EXISTS fts_upd AFTER UPDATE OF content ON messages BEGIN INSERT INTO message_fts(message_fts,rowid,content) VALUES('delete',old.rowid,old.content); INSERT INTO message_fts(rowid,content) VALUES(new.rowid,new.content); END;",
    'CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),message_id TEXT,file_name TEXT NOT NULL,media_type TEXT NOT NULL,byte_size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL);',
    'CREATE INDEX IF NOT EXISTS attachments_conversation ON attachments(conversation_id,created_at);'
  ];
  try{
    // A previously initialized DB with missing core tables must NOT be
    // silently recreated with empty tables: preserve it for recovery.
    const formerVersion=Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
    const present=new Set((db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Row[]).map(x=>String(x.name)));
    if(previousSize>0 && formerVersion>=3
      && ['settings','conversations','messages','attachments'].some(name=>!present.has(name)))
      throw Error('Не найдена таблица пользовательской базы. Автоматическая перезапись запрещена.');
    const missingSearch=previousSize>0 && formerVersion>=3 && !present.has('message_fts');
    if(formerVersion>4)throw Error('База создана более новой версией. Обновите Miyuneya.');
    const configured=Number(process.env.MIYUNEYA_SQLITE_BUSY_MS||5000);
    busyMs=Number.isSafeInteger(configured)?Math.max(1000,Math.min(12000,configured)):5000;
    db.exec('PRAGMA busy_timeout='+busyMs+'; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    const mode=(db.prepare('PRAGMA journal_mode=WAL').get() as Row).journal_mode;
    if(mode!=='wal')throw Error('Режим SQLite WAL недоступен: нужен локальный диск.');
    if(previousSize>0&&formerVersion===3){
      await ensureSpace(home,previousSize*1.25,'резервирование перед миграцией SQLite');
      const snapshots=join(home,'migrations');
      await mkdir(snapshots,{recursive:true});
      const file=join(snapshots,'before-v4-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
      await backup(db,file,{rate:64});
      const safe=new DatabaseSync(file,{readOnly:true});
      try{
        if((safe.prepare('PRAGMA quick_check(1)').get() as Row).quick_check!=='ok'
          ||safe.prepare('PRAGMA foreign_key_check').all().length)
          throw Error('Проверка копии перед миграцией SQLite не пройдена. Миграция остановлена.');
      }finally{safe.close();}
    }
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec(schema.join('\n'));
      if(missingSearch)db.prepare("INSERT INTO message_fts(message_fts) VALUES('rebuild')").run();
      db.exec('PRAGMA user_version=4');
      db.exec('COMMIT');
    }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
  }catch(e){throw e;}
  const getSetting=(key:string)=>(db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row|undefined)?.value||'';
  const setSetting=(key:string,val:string)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,val);
  const conversationStmt=db.prepare('SELECT * FROM conversations WHERE id=?');
  const messageStmt=db.prepare('SELECT * FROM messages WHERE id=?');
  const sequenceStmt=db.prepare('SELECT * FROM messages WHERE conversation_id=? AND sequence>? AND sequence<=? ORDER BY sequence');
  const insertStmt=db.prepare('INSERT INTO messages(id,conversation_id,sequence,role,content,created_at,version,complete,parent_message_id) VALUES(?,?,?,?,?,?,?,?,?)');
  const updateMessageStmt=db.prepare('UPDATE messages SET content=?,version=?,complete=? WHERE id=?');
  const getConversation=(id:string):Row=>{
    const c=conversationStmt.get(safeId(id)) as Row|undefined;
    if(!c)throw error('Разговор не найден.',404);return c;
  };
  const formatConversation=(c:Row):ChatMeta=>({
    id:c.id,title:c.title,createdAt:c.created_at,updatedAt:c.updated_at,
    archived:!!c.archived,messageCount:Number(c.message_count),
    ...(c.parent_id?{parentId:c.parent_id,forkMessageId:c.fork_message_id}:{})
  });
  const formatMessage=(m:Row):ChatMessage=>({
    id:m.id,role:m.role,content:m.content,createdAt:m.created_at,
    version:Number(m.version),complete:!!m.complete,parentMessageId:m.parent_message_id||null
  });
  const scan=(id:string,start:number,end:number,depth=0):Row[]=>{
    if(start>=end)return [];
    if(depth>32)throw error('Превышена глубина ответвлений.',409);
    const c=getConversation(id),split=Number(c.inherited_count);
    const inherited=start<split?scan(c.parent_id,start,Math.min(end,split),depth+1):[];
    const lower=Math.max(start,split);
    const own=lower<end?sequenceStmt.all(id,lower,end) as Row[]:[];
    return inherited.concat(own);
  };
  const visible=(conversationId:string,id:string,depth=0):Row|undefined=>{
    if(depth>32)throw error('Превышена глубина ветвления.');
    const c=getConversation(conversationId);
    const m=messageStmt.get(safeId(id)) as Row|undefined;
    if(m&&m.conversation_id===conversationId)return m;
    if(c.parent_id){
      const parent=visible(c.parent_id,id,depth+1);
      if(parent&&Number(parent.sequence)<=Number(c.inherited_count))return parent;
    }
    return undefined;
  };
  const list=(input:ChatQuery={})=>timed('list',()=>{
    const q=(input.query||'').trim().slice(0,180),archive=input.archived?1:0;
    const offset=integer(input.offset,0),limit=Math.min(100,Math.max(1,integer(input.limit,60)));
    const filter=q?" AND (c.title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM message_fts JOIN messages m ON m.rowid=message_fts.rowid WHERE m.conversation_id=c.id AND message_fts MATCH ?))":'';
    const match='"'+q.replace(/"/g,'""')+'"';
    const escaped=q.replace(/[\\%_]/g,c=>'\\'+c);
    const args=q?[archive,'%'+escaped+'%',match]:[archive];
    try{
      const total=Number((db.prepare('SELECT COUNT(*) n FROM conversations c WHERE c.archived=?'+filter).get(...args) as Row).n);
      const results=db.prepare('SELECT c.* FROM conversations c WHERE c.archived=?'+filter+' ORDER BY c.updated_at DESC LIMIT ? OFFSET ?')
        .all(...args,limit,offset) as Row[];
      return {schema:3,revision:Number(getSetting('revision')||0),
        selectedId:getSetting('selectedId')||null,total,conversations:results.map(formatConversation)};
    }catch(e){
      warnings.push('Индекс поиска FTS5 требует проверки или восстановления.');
      throw error('Поиск не выполнен. Проверьте поисковый индекс.',503);
    }
  });
  const create=(input:{id?:string;title?:string;parentId?:string;forkMessageId?:string}={})=>write('create',()=>{
    if(input.id!==undefined)safeId(input.id);
    if(input.title!==undefined&&(typeof input.title!=='string'||input.title.length>140))throw error('Неверный заголовок.');
    const id=input.id||randomUUID(),prior=conversationStmt.get(id) as Row|undefined;
    if(prior)return {conversation:formatConversation(prior),selectedId:getSetting('selectedId')||null};
    let parent:string|null=null,fork:string|null=null,count=0;
    if(input.parentId!==undefined||input.forkMessageId!==undefined){
      parent=safeId(input.parentId);fork=safeId(input.forkMessageId);
      const source=getConversation(parent);
      if(source.archived)throw error('Сначала восстановите разговор из архива.',409);
      const m=visible(parent,fork);if(!m)throw error('Сообщение для ветвления не найдено.',404);
      count=Number(m.sequence);
    }
    const timestamp=now();
    db.prepare('INSERT INTO conversations(id,title,created_at,updated_at,archived,message_count,parent_id,fork_message_id,inherited_count) VALUES(?,?,?,?,0,?,?,?,?)')
      .run(id,input.title?.trim()||'Новый разговор',timestamp,timestamp,count,parent,fork,count);
    setSetting('selectedId',id);setSetting('revision',String(Number(getSetting('revision')||0)+1));
    return {conversation:formatConversation(getConversation(id)),selectedId:id};
  });
  const modify=(id:string,input:{title?:string;archived?:boolean})=>write('modify',()=>{
    if(!input||typeof input!=='object'||Array.isArray(input)
      ||Object.keys(input).some(k=>!['title','archived'].includes(k))
      ||(input.title!==undefined&&(typeof input.title!=='string'||input.title.length>140))
      ||(input.archived!==undefined&&typeof input.archived!=='boolean'))throw error('Неверные настройки разговора.');
    getConversation(id);
    if(input.title!==undefined)db.prepare('UPDATE conversations SET title=? WHERE id=?').run(input.title.trim()||'Без названия',id);
    if(input.archived!==undefined){
      db.prepare('UPDATE conversations SET archived=? WHERE id=?').run(input.archived?1:0,id);
      if(input.archived&&getSetting('selectedId')===id)setSetting('selectedId','');
    }
    setSetting('revision',String(Number(getSetting('revision')||0)+1));
    return {conversation:formatConversation(getConversation(id)),selectedId:getSetting('selectedId')||null};
  });
  const select=(id:string|null)=>write('select',()=>{
    if(id!==null&&getConversation(id).archived)throw error('Разговор в архиве.');
    setSetting('selectedId',id||'');return {selectedId:id};
  });
  function saveMessage(conversationId:string,input:unknown,expectedCount?:number,importOnly=false){
    return write('save',()=>{
      const c=getConversation(conversationId);
      if(c.archived)throw error('Разговор находится в архиве.',409);
      if(!messageOK(input))throw error('Некорректное сообщение.');
      const msg=input as ChatMessage,id=normalizedId(conversationId,msg.id);
      const previous=messageStmt.get(id) as Row|undefined;
      if(previous){
        if(previous.conversation_id!==conversationId||previous.role!==msg.role||previous.created_at!==msg.createdAt)
          throw error('Идентификатор уже занят другой записью.',409);
        if(importOnly&&previous.version>msg.version)return {message:formatMessage(previous),conversation:formatConversation(c)};
        if(importOnly&&(previous.version!==msg.version||previous.content!==msg.content||!!previous.complete!==msg.complete))
          throw error('Импорт не должен перезаписывать другие сообщения.',409);
        if(msg.version<previous.version||(msg.version===previous.version&&previous.content===msg.content&&!!previous.complete===msg.complete))
          return {message:formatMessage(previous),conversation:formatConversation(c)};
        if(msg.version===previous.version||(previous.complete&&!msg.complete))throw error('Конфликт версии сообщения.',409);
        updateMessageStmt.run(msg.content,msg.version,msg.complete?1:0,id);
      }else{
        const count=Number(c.message_count);
        if(expectedCount!==undefined&&expectedCount!==count)throw error('Другая вкладка изменила разговор.',409);
        let parent:string|null=null;
        if(msg.parentMessageId){
          const found=visible(conversationId,msg.parentMessageId);
          if(!found)throw error('Связанное сообщение не найдено.',409);
          parent=found.id;
        }else if(count)parent=scan(conversationId,count-1,count)[0]?.id||null;
        insertStmt.run(id,conversationId,count+1,msg.role,msg.content,msg.createdAt,msg.version,msg.complete?1:0,parent);
        db.prepare('UPDATE conversations SET message_count=message_count+1 WHERE id=?').run(conversationId);
      }
      db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now(),conversationId);
      setSetting('revision',String(Number(getSetting('revision')||0)+1));
      return {message:formatMessage(messageStmt.get(id) as Row),conversation:formatConversation(getConversation(conversationId))};
    });
  }
  function page(id:string,before?:number,limit=100){
    return timed('page',()=>{
      const c=getConversation(id),count=Number(c.message_count);
      const end=before===undefined?count:Math.min(count,integer(before,0));
      const take=Math.max(1,Math.min(150,integer(limit,100)));
      const start=Math.max(0,end-take);
      const key=id+':'+start+':'+end;
      const hit=pageCache.get(key);
      if(hit){
        pageCache.delete(key);pageCache.set(key,hit);
        return structuredClone(hit.result);
      }
      const result=makePage(c,scan(id,start,end),start,count);
      const bytes=Buffer.byteLength(JSON.stringify(result));
      if(bytes<=2*1024*1024){
        pageCache.set(key,{size:bytes,result:structuredClone(result)});
        cachedBytes+=bytes;
        while((pageCache.size>12||cachedBytes>8*1024*1024)&&pageCache.size){
          const oldest=pageCache.keys().next().value!;
          cachedBytes-=pageCache.get(oldest)!.size;pageCache.delete(oldest);
        }
      }
      return result;
    });
  }
  async function* exportLines(){
    const h=createHash('sha256');let conversations=0,messages=0;
    const header=JSON.stringify({format:'miyuneya-chats',schema:2,exportedAt:now()})+'\n';
    h.update(header);yield header;
    // Parents precede child branches. Each branch exports only its own
    // messages; the shared inherited prefix stays in the parent's records.
    const order="WITH RECURSIVE tree(id,depth) AS (SELECT id,0 FROM conversations WHERE parent_id IS NULL UNION ALL SELECT c.id,t.depth+1 FROM conversations c JOIN tree t ON t.id=c.parent_id) SELECT c.* FROM tree t JOIN conversations c ON c.id=t.id ORDER BY t.depth,c.created_at,c.id";
    for(const c of db.prepare(order).iterate() as Iterable<Row>){
      const line=JSON.stringify({kind:'conversation',conversation:formatConversation(c)})+'\n';
      h.update(line);yield line;conversations++;
      const messagesStmt=db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY sequence');
      for(const m of messagesStmt.iterate(c.id) as Iterable<Row>){
        const msg=JSON.stringify({kind:'message',conversationId:c.id,message:formatMessage(m)})+'\n';
        h.update(msg);yield msg;messages++;
      }
    }
    yield JSON.stringify({kind:'end',conversations,messages,sha256:h.digest('hex')})+'\n';
  }
  function importLegacy(data:unknown){
    const archive=data as Row;
    if(!archive||!Array.isArray(archive.conversations))throw error('Повреждённая старая копия.');
    let count=0;
    for(const c of archive.conversations){
      if(!idOK(c.id)||!dateOK(c.createdAt)||!Array.isArray(c.messages))throw error('Неверная запись копии.');
      create({id:c.id,title:String(c.title||'').slice(0,140)});
      for(let i=0;i<c.messages.length;i++){
        const m=c.messages[i];
        if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string')throw error('Некорректное сообщение.');
        saveMessage(c.id,{id:'legacy-'+String(i+1).padStart(12,'0'),role:m.role,
          content:m.content,createdAt:c.createdAt,version:1,complete:true},undefined,true);
        count++;
      }
    }
    return {imported:count,conversations:archive.conversations.length};
  }
  // Import JSONL atomically only after SHA-256 verification; do not change
  // an existing message, even if the backup repeats an old identifier.
  async function importStream(body:AsyncIterable<Uint8Array>,contentType:string){
    if(contentType.startsWith('application/json')){
      let raw='';const decode=new TextDecoder();
      for await(const chunk of body){raw+=decode.decode(chunk,{stream:true});
        if(Buffer.byteLength(raw)>32_000_000)throw error('Слишком большая старая JSON-копия.',413);}
      raw+=decode.decode();let json;
      try{json=JSON.parse(raw);}catch{throw error('Повреждён JSON.');}
      return importLegacy(json);
    }
    if(!contentType.startsWith('application/x-ndjson'))throw error('Нужен JSONL или JSON.',415);
    // A temporary spool avoids loading the backup into RAM. First pass
    // checks the checksum, second pass imports in one SQLite transaction.
    const {open,rm}=await import('node:fs/promises');
    const temp=join(home,'incoming-'+randomUUID()+'.jsonl');
    try{
      const file=await open(temp,'wx',0o600);
      try{
        let size=0;
        for await(const part of body){
          size+=part.length;if(size>8_000_000_000)throw error('Архив превышает безопасный предел импорта 8 ГБ.',413);
          await file.write(part);
        }
        await file.sync();
      }finally{await file.close();}
      let records=0,conversations=0,ended=false,header=false;
      const hash=createHash('sha256');
      for await(const line of createInterface({input:createReadStream(temp),crlfDelay:Infinity})){
        if(!line.trim())continue;
        const row=JSON.parse(line) as Row;
        if(ended)throw error('Лишние данные после контрольной записи.');
        if(!header){
          if(row.format!=='miyuneya-chats'||row.schema!==2)throw error('Неверный формат JSONL.');
          hash.update(line+'\n');header=true;continue;
        }
        if(row.kind==='end'){
          if(row.conversations!==conversations||row.messages!==records||row.sha256!==hash.digest('hex'))
            throw error('Контрольная сумма архива не совпадает.',400);
          ended=true;continue;
        }
        if(row.kind==='message')records++;
        else if(row.kind==='conversation')conversations++;
        else throw error('Неизвестная запись резервной копии.');
        hash.update(line+'\n');
      }
      if(!ended)throw error('Резервная копия оборвана.');
      db.exec('BEGIN IMMEDIATE');
      try{
        for await(const line of createInterface({input:createReadStream(temp),crlfDelay:Infinity})){
          if(!line.trim())continue;
          const row=JSON.parse(line) as Row;
          if(row.kind==='conversation'){
            const c=row.conversation;
            if(!idOK(c.id)||!dateOK(c.createdAt))throw error('Некорректный диалог в резервной копии.');
            const old=conversationStmt.get(c.id);
            if(!old){
              let parent:string|null=null,fork:string|null=null,inherited=0;
              if(c.parentId!==undefined||c.forkMessageId!==undefined){
                parent=safeId(c.parentId);fork=safeId(c.forkMessageId);
                const source=visible(parent,fork);
                if(!source)throw error('Точка ветвления отсутствует в импортируемом архиве.',409);
                inherited=Number(source.sequence);
              }
              db.prepare('INSERT INTO conversations(id,title,created_at,updated_at,archived,message_count,parent_id,fork_message_id,inherited_count) VALUES(?,?,?,?,?,?,?,?,?)')
                .run(c.id,String(c.title).slice(0,140),c.createdAt,c.updatedAt,c.archived?1:0,inherited,parent,fork,inherited);
            }
          }else if(row.kind==='message'){
            const msg=row.message;
            if(!messageOK(msg))throw error('Некорректное сообщение резервной копии.');
            const id=normalizedId(row.conversationId,msg.id),old=messageStmt.get(id) as Row|undefined;
            if(old){
              if(old.conversation_id!==row.conversationId||old.content!==msg.content||old.version!==msg.version)
                throw error('В архиве уже есть другое сообщение с этим ID.',409);
              continue;
            }
            const c=getConversation(row.conversationId);
            const seq=Number(c.message_count)+1;
            const reference=msg.parentMessageId?visible(row.conversationId,msg.parentMessageId):undefined;
            const parent=reference?.id||(
              seq>1?scan(row.conversationId,seq-2,seq-1)[0]?.id||null:null);
            db.prepare('INSERT INTO messages(id,conversation_id,sequence,role,content,created_at,version,complete,parent_message_id) VALUES(?,?,?,?,?,?,?,?,?)')
              .run(id,row.conversationId,seq,msg.role,msg.content,msg.createdAt,msg.version,msg.complete?1:0,parent);
            db.prepare('UPDATE conversations SET message_count=message_count+1 WHERE id=?').run(row.conversationId);
          }
        }
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      return {imported:records,conversations};
    }finally{await rm(temp,{force:true}).catch(()=>{});}
  }
  async function searchAdvanced(input:ChatQuery={}){
    if(!(input.query||'').trim())return list(input);
    const result=await searchInWorker(path,input);
    const latency=result.elapsedMs;
    const metric=timings.get('indexed-search')||{count:0,sum:0,max:0};
    metric.count++;metric.sum+=latency;metric.max=Math.max(metric.max,latency);
    timings.set('indexed-search',metric);
    return {...result,revision:Number(getSetting('revision')||0),
      selectedId:getSetting('selectedId')||null};
  }
  const rebuildSearch=()=>write('fts-rebuild',()=>{
    db.prepare("INSERT INTO message_fts(message_fts) VALUES('rebuild')").run();
    setSetting('ftsRebuilt',now());return {ok:true};
  });
  const quickCheck=()=>timed('integrity',()=>{
    const result=String((db.prepare('PRAGMA quick_check(1)').get() as Row).quick_check);
    if(result!=='ok'){readOnly=true;warnings.push('Повреждение SQLite: архив открыт только для чтения.');}
    let searchable=true;
    // FTS5 external-content COUNT(*) mirrors the source table even when
    // the index is empty. Rank=1 compares every posting with source rows.
    try{db.prepare("INSERT INTO message_fts(message_fts,rank) VALUES('integrity-check',1)").run();}
    catch{searchable=false;}
    if(!searchable)warnings.push('Поисковый индекс требуется восстановить.');
    return {ok:result==='ok',ftsHealthy:searchable,details:result};
  });
  // All SQLite migration changes are in one transaction; old JSON sources
  // are never deleted and remain a recoverable fallback after a crash.
  if(getSetting('jsonMigrated')!=='yes'){
    const available=await Promise.all(['manifest.json','index.json'].map(async name=>
      stat(join(home,name)).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;})));
    if(available.some(Boolean)){
      const legacy=await openLegacyArchive(dataDir);
      db.exec('BEGIN IMMEDIATE');
      try{
        let current='';
        for await(const line of legacy.exportLines()){
          const row=JSON.parse(line);
          if(row.kind==='conversation'){
            const c=row.conversation;current=c.id;
            db.prepare('INSERT OR IGNORE INTO conversations(id,title,created_at,updated_at,archived,message_count) VALUES(?,?,?,?,?,0)')
              .run(c.id,c.title,c.createdAt,c.updatedAt,c.archived?1:0);
          }else if(row.kind==='message'){
            const m=row.message,id=normalizedId(current,m.id);
            const count=Number(getConversation(current).message_count);
            db.prepare('INSERT INTO messages(id,conversation_id,sequence,role,content,created_at,version,complete,parent_message_id) VALUES(?,?,?,?,?,?,?,?,?)')
              .run(id,current,count+1,m.role,m.content,m.createdAt,m.version,m.complete?1:0,null);
            db.prepare('UPDATE conversations SET message_count=message_count+1 WHERE id=?').run(current);
          }
        }
        setSetting('selectedId',legacy.list().selectedId||'');
        setSetting('jsonMigrated','yes');db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      await legacy.shutdown();
    }else setSetting('jsonMigrated','yes');
  }
  return {
    path,db,home,readOnly:()=>readOnly,lockWrites:(reason:string)=>{readOnly=true;warnings.push(reason);},
    warnings,timings,timed,getSetting,setSetting,write,
    getConversation,formatConversation,visible,list,search:list,searchAdvanced,create,modify,select,
    saveMessage,page,exportLines,importLegacy,importStream,rebuildSearch,quickCheck,
    shutdown:async()=>{if(!closed){closed=true;db.close();await releaseLock();}}
  };
  }catch(e){
    try{db.close();}catch{}
    await releaseLock();
    throw e;
  }
}
