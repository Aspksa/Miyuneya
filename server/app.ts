import { openWorkflows } from './workflows.ts';
import { openPersonalVault } from './personal-vault.ts';
import { openSqliteChatArchive } from './chat-sqlite.ts';
import { openChatMaintenance } from './chat-maintenance.ts';
import { createHash } from 'node:crypto';
import { reconcileTasks } from '../src/productivity.ts';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { openDisk } from './disk.ts';
import { readFile, rm } from 'node:fs/promises';
import { atomicWrite } from '../scripts/runtime.mjs';
import { join } from 'node:path';
import { validateWorkspace, emptyWorkspace, defaultAppearance, validAppearance } from '../src/model.ts';
import type { Workspace } from '../src/model.ts';
import { openMemory, parseCommand, parseReminder, validDialogId, validDate, transcript, parseJson, goalTree, COMPACT_PROMPT } from './memory.ts';
import { complexity, exactCalcs, exactLines, readPlan, reasoningBlock, parseGoal, PLAN_PROMPT } from './logic.ts';
import { VERIFY_PROMPT, reviewAnswer, needsGrounding, digest } from './integrity.ts';
import type { Source, Review } from './integrity.ts';
import type { Plan } from './logic.ts';

export const CLOUD_RU_URL = 'https://foundation-models.api.cloud.ru/v1';
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';
// Turns memory records into meaning vectors for search; any embedding model from the cloud.ru list works.
export const DEFAULT_EMBED_MODEL = 'BAAI/bge-m3';
const PERSONA = 'Ты Миюнэя — тёплая и внимательная помощница в личном пространстве заметок и задач. Отвечай по-русски, ясно и по делу, если пользователь не попросил иначе.';
// The browser turns these tags into real entries, so the model only uses them on an explicit request.
const ACTIONS = 'Ты умеешь создавать записи в пространстве. Только когда пользователь прямо просит добавить задачу, допиши в конце ответа по строке <task>текст задачи</task> на каждую задачу. Только когда просит сохранить заметку, допиши <note title="Короткий заголовок">текст заметки</note>. В остальных случаях эти теги не используй и не показывай их как пример. Сами теги пользователь не увидит: приложение создаст записи и покажет подтверждение.';
type CustomAvatar = { type: string; version: number };
// model answers simple questions; smartModel, when chosen, takes complex ones, planning, sleep and thinking.
type AssistantConfig = { apiKey: string; model: string; smartModel: string; embedModel: string; context: boolean; avatar: CustomAvatar | null };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{8,512}$/.test(value);
const validModel = (value: unknown): value is string => typeof value === 'string' && /^[\w.:@\/-]{1,200}$/.test(value);
const keyHint = (key: string) => key ? '••••' + key.slice(-4) : '';
const imageTypes: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const AVATAR_LIMIT = 15_000_000;
// Trust the bytes, not the declared type.
export function sniffImage(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && ascii(0, 4) === 'GIF8') return 'image/gif';
  return null;
}
// Notes and tasks the model may read, newest first, within a fixed character budget.
export function workspaceContext(data: Workspace, now = new Date(), budget = 30_000, query = '') {
  const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [`Сегодня ${now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`, 'Ниже содержимое пространства пользователя. Опирайся на него, когда вопрос касается его дел и записей; не пересказывай его без просьбы.'];
  const open = data.tasks.filter(t => !t.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = data.tasks.filter(t => t.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  const terms=query.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]{3,}/gu) || [];
  const score=n=>terms.reduce((sum,t)=>sum+(n.title.toLocaleLowerCase('ru').includes(t)?5:0)+(n.body.toLocaleLowerCase('ru').includes(t)?1:0),0);
  const notes = [...data.notes].sort((a,b)=>score(b)-score(a) || b.updatedAt.localeCompare(a.updatedAt));
  const excerpt=n=>{if(!terms.length || n.body.length<=800)return n.body.slice(0,800)+(n.body.length>800?'…':'');const lower=n.body.toLocaleLowerCase('ru');const position=terms.map(t=>lower.indexOf(t)).filter(p=>p>=0).sort((a,b)=>b-a)[0];if(position===undefined)return n.body.slice(0,800)+'…';const start=Math.max(0,position-150);return (start?'…':'')+n.body.slice(start,start+4000)+(start+4000<n.body.length?'…':'');};
  let used = lines.join('\n').length, cut = false;
  const add = (line: string) => { if (cut || used + line.length > budget) { cut = true; return; } lines.push(line); used += line.length + 1; };
  add(`\nОткрытые задачи (${open.length}):`); if (!open.length) add('— нет');
  for (const t of open) add(`- ${t.title} (добавлена ${day(t.createdAt)})`);
  add(`\nНедавно выполненные задачи (${done.length}):`); if (!done.length) add('— нет');
  for (const t of done) add(`- ${t.title}`);
  add(`\nЗаметки (${notes.length}, свежие сверху):`); if (!notes.length) add('— нет');
  for (const n of notes) add(`### ${n.title} (изменена ${day(n.updatedAt)})${n.body.trim() ? '\n' + excerpt(n) : ''}`);
  if (cut) lines.push('(Показаны не все записи: пространство слишком большое.)');
  return lines.join('\n');
}

export async function createApp(root: string, instance: string, preview = false, options: { launchId?: string; onShutdown?: () => void; cloudUrl?: string; memoryIdleMs?: number; memoryTickMs?: number; memoryThinkIdleMs?: number } = {}) {
  const dataDir = join(root, 'data');
  const dataFile = join(dataDir, 'workspace.json');
  // The cloud.ru key lives apart from workspace.json so it never reaches the browser or a backup.
  const assistantFile = join(dataDir, 'assistant.json');
  const cloudUrl = (options.cloudUrl || CLOUD_RU_URL).replace(/\/+$/, '');
  let assistant: AssistantConfig = { apiKey: '', model: DEFAULT_MODEL, smartModel: '', embedModel: DEFAULT_EMBED_MODEL, context: true, avatar: null };
  try {
    const saved = JSON.parse(await readFile(assistantFile, 'utf8'));
    const avatar = imageTypes[saved.avatar?.type] && Number.isSafeInteger(saved.avatar?.version) ? { type: saved.avatar.type, version: saved.avatar.version } : null;
    assistant = { apiKey: validKey(saved.apiKey) ? saved.apiKey : '', model: validModel(saved.model) ? saved.model : DEFAULT_MODEL, smartModel: validModel(saved.smartModel) ? saved.smartModel : '', embedModel: saved.embedModel === '' || validModel(saved.embedModel) ? saved.embedModel : DEFAULT_EMBED_MODEL, context: saved.context !== false, avatar };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Настройки cloud.ru не прочитаны: data/assistant.json повреждён.');
  }
  const upstream = new Set<AbortController>();
  let state: { revision: number; data: Workspace } = { revision: 0, data: emptyWorkspace() };
  try {
    const saved = JSON.parse(await readFile(dataFile, 'utf8'));
    if (!Number.isSafeInteger(saved.revision) || saved.revision < 0 || !validateWorkspace(saved.data)) throw new Error('Неверный формат данных');
    state = saved;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Не удалось прочитать data/workspace.json. Сохраните копию и проверьте файл; данные не перезаписаны.', { cause: e });
  }
  const vault = await openPersonalVault(dataDir);
  const chatArchive = await openSqliteChatArchive(dataDir);
  const chatMaintenance = openChatMaintenance(chatArchive, dataDir);
  let queue = Promise.resolve();
  const files: Record<string, [string, string]> = {
    '/': ['blank.html', 'text/html'], '/blank.css': ['blank.css', 'text/css'], '/blank.js': ['blank.js', 'text/javascript'],
    '/avatar.css': ['avatar.css', 'text/css'], '/avatar.js': ['avatar.js', 'text/javascript'], '/avatar-studio.js': ['avatar-studio.js', 'text/javascript'], '/avatars/hayumeri-kitsune.avif': ['avatars/hayumeri-kitsune.avif', 'image/avif'],
    '/workspace': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
    '/workbench.js':['workbench.js','text/javascript'], '/productivity.js':['productivity.js','text/javascript'], '/disk.js': ['disk.js', 'text/javascript'], '/calendar.js': ['calendar.js', 'text/javascript'], '/main.js': ['main.js', 'text/javascript'], '/model.js': ['model.js', 'text/javascript'],
    '/assistant.js': ['assistant.js', 'text/javascript'], '/appearance.js': ['appearance.js', 'text/javascript'], '/memory.js': ['memory.js', 'text/javascript'],
    '/style.css': ['style.css', 'text/css'], '/fox.svg': ['fox.svg', 'image/svg+xml'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
    ...Object.fromEntries([1, 2, 3, 4].map(n => [`/avatars/avatar${n}.png`, [`avatars/avatar${n}.png`, 'image/png']]))
  };
  const publicConfig = () => ({ configured: !!assistant.apiKey, keyHint: keyHint(assistant.apiKey), model: assistant.model, smartModel: assistant.smartModel, embedModel: assistant.embedModel, context: assistant.context, customAvatar: assistant.avatar?.version ?? null });
  const avatarFile = (type: string) => join(dataDir, 'avatar-custom.' + imageTypes[type]);
  function saveAssistant(next: AssistantConfig) {
    const update = queue.then(async () => { await atomicWrite(assistantFile, JSON.stringify(next, null, 2)); assistant = next; });
    queue = update.catch(() => {});
    return update;
  }
  const fail = (message: string, status: number) => Object.assign(new Error(message), { status });
  // Opens a cloud.ru request; the caller reads the body. The controller stays registered until release().
  async function cloud(path: string, init: RequestInit = {}, timeout = 120_000) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
    upstream.add(controller);
    const release = () => { clearTimeout(timer); upstream.delete(controller); };
    const extend = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('timeout')), timeout); };
    const explain = () => fail(controller.signal.aborted ? (stopping ? 'Сервер завершает работу.' : 'cloud.ru не ответил вовремя. Попробуйте ещё раз.') : 'Нет связи с cloud.ru. Проверьте интернет.', 504);
    try {
      const response = await fetch(cloudUrl + path, { ...init, signal: controller.signal, headers: { Authorization: 'Bearer ' + assistant.apiKey, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...init.headers } });
      if (!response.ok) {
        let body: any = null;
        try { body = JSON.parse(await response.text()); } catch {}
        const detail = String(body?.error?.message || body?.message || body?.detail || '').replaceAll(assistant.apiKey, '…').slice(0, 300);
        const reason = response.status === 401 || response.status === 403 ? 'cloud.ru не принял ключ. Проверьте API-ключ в настройках пространства.'
          : response.status === 404 ? 'cloud.ru не нашёл модель или адрес. Выберите другую модель в настройках.'
          : response.status === 429 ? 'Превышен лимит запросов cloud.ru. Попробуйте чуть позже.'
          : `cloud.ru вернул ошибку ${response.status}.`;
        throw fail(detail ? `${reason} ${detail}` : reason, 502);
      }
      return { response, controller, release, extend, explain };
    } catch (e) {
      release();
      if ((e as { status?: number }).status) throw e;
      throw explain();
    }
  }
  async function cloudJson(path: string, timeout: number) {
    const call = await cloud(path, {}, timeout);
    try {
      try { return JSON.parse(await call.response.text()); } catch (e) { if (call.controller.signal.aborted) throw call.explain(); throw fail('cloud.ru вернул ответ в неизвестном формате.', 502); }
    } finally { call.release(); }
  }
  // A one-shot, non-streaming request used by the memory: reflection, sleep and dialog compaction.
  const modelFor = (strong: boolean) => strong && assistant.smartModel ? assistant.smartModel : assistant.model;
  async function ask(system: string, user: string, timeout = 90_000, strong = false) {
    const call = await cloud('/chat/completions', { method: 'POST', body: JSON.stringify({ model: modelFor(strong), stream: false, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) }, timeout);
    try {
      let text;
      try { text = JSON.parse(await call.response.text())?.choices?.[0]?.message?.content; } catch { if (call.controller.signal.aborted) throw call.explain(); throw fail('cloud.ru вернул ответ в неизвестном формате.', 502); }
      if (typeof text !== 'string' || !text.trim()) throw fail('Модель вернула пустой ответ.', 502);
      return text;
    } finally { call.release(); }
  }
  async function embed(input: string[], timeout = 30_000) {
    const call = await cloud('/embeddings', { method: 'POST', body: JSON.stringify({ model: assistant.embedModel, input }) }, timeout);
    try {
      let data;
      try { data = JSON.parse(await call.response.text())?.data; } catch { if (call.controller.signal.aborted) throw call.explain(); throw fail('cloud.ru вернул эмбеддинги в неизвестном формате.', 502); }
      if (!Array.isArray(data) || data.length !== input.length) throw fail('cloud.ru вернул не все эмбеддинги.', 502);
      const vectors = [...data].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0)).map(d => d?.embedding);
      if (!vectors.every(v => Array.isArray(v) && v.length > 0 && v.length <= 8192 && v.every(Number.isFinite))) throw fail('cloud.ru вернул эмбеддинги в неизвестном формате.', 502);
      return vectors as number[][];
    } finally { call.release(); }
  }
  const memory = await openMemory(dataDir, { ask, embed, embedModel: () => assistant.embedModel, available: () => !!assistant.apiKey, workspace: () => assistant.context ? state.data : null, idleMs: options.memoryIdleMs, tickMs: options.memoryTickMs, thinkIdleMs: options.memoryThinkIdleMs });
  let disk; let diskError=false;let workflows;let workflowError='';
  try{disk=await openDisk(dataDir,{onUploaded:async file=>{if(!workflows)throw new Error(workflowError || 'Автоматизации недоступны.');await workflows.uploaded(file);if(workflows.view().jobs.some(j=>j.file===file.id&&j.status==='failed'))throw new Error('Проверьте журнал сценариев в настройках.');}});}catch{diskError=true;}
  try{workflows=await openWorkflows(dataDir,{
    file:id=>disk?.snapshot().files.find(f=>f.id===id&&!f.trashedAt),folders:()=>disk?.snapshot().folders || [],text:id=>disk.text(id),route:(id,folder)=>disk.route(id,folder),
    apply:async(id,note,tasks,group,file)=>{const operation=queue.then(async()=>{
      if(state.data.automationApplied?.includes(id))return;
      const next=structuredClone(state.data);if(next.notes.length+(note?1:0)>5000||next.tasks.length+tasks.length>5000)throw new Error('Достигнут предел записей пространства.');
      const key=createHash('sha256').update(id).digest('hex').slice(0,24),now=new Date().toISOString();
      if(note&&!next.notes.some(n=>n.id==='auto-note-'+key))next.notes.push({id:'auto-note-'+key,...note,updatedAt:now});
      tasks.forEach((title,i)=>{if(!next.tasks.some(t=>t.id==='auto-task-'+key+'-'+i))next.tasks.push({id:'auto-task-'+key+'-'+i,title,details:'Создано правилом для документа на диске.',done:false,createdAt:now,group,attachments:[{kind:'file' as const,id:file},...(note?[{kind:'note' as const,id:'auto-note-'+key}]:[])]});});
      next.automationApplied=[...(next.automationApplied || []),id].slice(-20000);
      if(!validateWorkspace(next))throw new Error('Результат сценария не прошёл проверку.');
      const saved={data:next,revision:state.revision+1};if(Buffer.byteLength(JSON.stringify(saved))>1900000)throw new Error('Пространство заполнено: экспортируйте записи и освободите место перед повтором.');await atomicWrite(dataFile,JSON.stringify(saved,null,2));state=saved;
    });queue=operation.catch(()=>{});await operation;}
  });void workflows.resume().catch(e=>{workflowError='Не удалось продолжить сценарии: '+e.message;});}catch(e){workflowError=e.message;}

  let stopping = false;
  const active = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    const operation = handle(req, res);
    active.add(operation);
    operation.finally(() => active.delete(operation)).catch(() => {});
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 5000;
  async function handle(req, res) {
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const port = (res.socket?.address() as { port?: number })?.port;
    const origin = `http://127.0.0.1:${port}`;
    if (!preview && req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: 'Недопустимый адрес' });
    if (!preview && req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Недопустимый источник запроса' });
    try {
      const path = new URL(req.url || '/', origin).pathname;
      if (req.method === 'GET' && path === '/__miyuneya/health') return send(stopping ? 503 : 200, { app: 'Miyuneya', instance, launchId: options.launchId, ready: !stopping });
      if (path === '/__miyuneya/shutdown' && req.method === 'POST') {
        if (!options.launchId || req.headers['x-miyuneya-session'] !== options.launchId) return send(403, { error: 'Недопустимый сеанс' });
        send(200, { stopping: true });
        setImmediate(() => options.onShutdown?.());
        return;
      }
      if (stopping) return send(503, { error: 'Сервер завершает работу' });
      if (path === '/api/site/appearance') {
        if (req.method === 'GET') return send(200, { appearance: { theme: state.data.settings.theme, ...defaultAppearance(), ...state.data.settings.appearance } });
        if (req.method !== 'PUT') return send(405, { error: 'Метод не поддерживается' });
        const input = await readJson(req, send, 6000);
        if (input === undefined) return;
        if (!validAppearance(input?.appearance)) return send(400, { error: 'Неверные параметры оформления.' });
        const update = queue.then(async () => {
          const current = { theme: state.data.settings.theme, ...defaultAppearance(), ...state.data.settings.appearance };
          if (JSON.stringify(current) !== JSON.stringify(input.appearance)) {
            const next = { revision: state.revision + 1, data: structuredClone(state.data) };
            next.data.settings.theme = input.appearance.theme;
            const { theme, ...appearance } = input.appearance;
            next.data.settings.appearance = appearance;
            if (!validateWorkspace(next.data)) throw new Error('Неверные настройки.');
            await atomicWrite(dataFile, JSON.stringify(next, null, 2));
            state = next;
          }
          send(200, { appearance: { theme: state.data.settings.theme, ...defaultAppearance(), ...state.data.settings.appearance } });
        });
        queue = update.catch(() => {});
        await update;
        return;
      }
      if (path === '/api/site/theme') {
        if (req.method === 'GET') return send(200, { theme: state.data.settings.theme === 'dark' ? 'dark' : 'light' });
        if (req.method !== 'PUT') return send(405, { error: 'Метод не поддерживается' });
        const input = await readJson(req, send, 1000);
        if (input === undefined) return;
        if (!input || (input.theme !== 'light' && input.theme !== 'dark')) return send(400, { error: 'Выберите светлую или тёмную тему.' });
        const update = queue.then(async () => {
          if (state.data.settings.theme !== input.theme) {
            const next = { revision: state.revision + 1, data: structuredClone(state.data) };
            next.data.settings.theme = input.theme;
            await atomicWrite(dataFile, JSON.stringify(next, null, 2));
            state = next;
          }
          send(200, { theme: input.theme });
        });
        queue = update.catch(() => {});
        await update;
        return;
      }
      if(path==='/api/disk' || path.startsWith('/api/disk/')) {memory.touch();if(diskError)return send(503,{error:'Индекс диска повреждён. Документы сохранены; восстановите data/disk/index.json из копии.'});return await disk.handle(req,res,new URL(req.url,origin));}
      if(path==='/api/workflows'){
        if(!workflows)return send(503,{error:workflowError || 'Автоматизации недоступны.'});
        if(req.method==='GET')return send(200,{...workflows.view(),warning:workflowError});
        const input=await readJson(req,send,100000);if(!input)return;
        try{if(req.method==='PUT')return send(200,await workflows.configure(input.revision,input.rules));if(req.method==='POST')return send(200,await workflows.retry(input.id));return send(405,{error:'Метод не поддерживается'});}catch(e){return send(409,{error:e.message});}
      }

      // Complete chat archive: paged metadata, individual durable messages and
      // streaming backups. No destructive automatic pruning of old conversations.
      const chatRoot = '/api/assistant/conversations';
      const chatFailure = (e: unknown) => send((e as { status?: number }).status || 500,
        { error: (e as Error).message || 'Не удалось сохранить историю.' });
      if (path === chatRoot) {
        if (req.method === 'GET') {
          const query = new URL(req.url || '/', origin).searchParams;
          try { return send(200, await chatArchive.search({ query: query.get('q') || '',
            archived: query.get('archived') === '1',
            offset: Number(query.get('offset') || 0), limit: Number(query.get('limit') || 60) })); }
          catch (e) { return chatFailure(e); }
        }
        if (req.method === 'POST') {
          const data = await readJson(req, send, 2000);
          if (data === undefined) return;
          try { return send(201, await chatArchive.create(data)); } catch (e) { return chatFailure(e); }
        }
        // Old browser tabs used PUT with a complete legacy backup. Merge it
        // without clearing later messages, rather than silently dropping it.
        if (req.method === 'PUT') {
          const data = await readJson(req, send, 32_000_000);
          if (data === undefined) return;
          try { return send(200, await chatArchive.importLegacy(data)); } catch (e) { return chatFailure(e); }
        }
        return send(405, { error: 'Метод не поддерживается' });
      }
      if (path === chatRoot + '/selection') {
        if (req.method !== 'PATCH') return send(405, { error: 'Метод не поддерживается' });
        const data = await readJson(req, send, 1000);
        if (data === undefined) return;
        try { return send(200, await chatArchive.select(data?.id)); } catch (e) { return chatFailure(e); }
      }
      if (path === chatRoot + '/export' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition': 'attachment; filename="miyuneya-chat-archive.jsonl"',
          'Cache-Control': 'no-store' });
        try {
          for await (const line of chatArchive.exportLines()) {
            if (res.destroyed) return;
            if (!res.write(line)) {
              await new Promise<void>((resolve, reject) => {
                const drain = () => { res.off('close', closed); resolve(); };
                const closed = () => { res.off('drain', drain); reject(Error('download cancelled')); };
                res.once('drain', drain); res.once('close', closed);
              });
            }
          }
          res.end();
        } catch { res.destroy(); }
        return;
      }
      if (path === chatRoot + '/import') {
        if (req.method !== 'POST') return send(405, { error: 'Метод не поддерживается' });
        try { return send(200, await chatArchive.importStream(req, String(req.headers['content-type'] || ''))); }
        catch (e) { return chatFailure(e); }
      }
      // Archive maintenance stays in existing chat settings; no new site section.
      if (path === '/api/assistant/archive/status') {
        if (req.method !== 'GET') return send(405,{error:'Метод не поддерживается'});
        try { return send(200, await chatMaintenance.statistics()); } catch(e) { return chatFailure(e); }
      }
      if (path === '/api/assistant/archive/check' || path === '/api/assistant/archive/rebuild'
        || path === '/api/assistant/archive/backup') {
        if (req.method !== 'POST') return send(405,{error:'Метод не поддерживается'});
        try {
          if(path.endsWith('/check'))return send(200,await chatMaintenance.check());
          if(path.endsWith('/rebuild'))return send(200,chatMaintenance.reindex());
          const result=await chatMaintenance.backupNow();
          return send(result.ok?200:503,result);
        } catch(e){return chatFailure(e);}
      }
      const chatAttachments = /^\/api\/assistant\/conversations\/([a-zA-Z0-9_-]{1,80})\/attachments(?:\/([a-zA-Z0-9_-]{1,80}))?$/.exec(path);
      if(chatAttachments) {
        const id=chatAttachments[1],attachmentId=chatAttachments[2];
        if(attachmentId) {
          if(req.method!=='GET' && req.method!=='HEAD')return send(405,{error:'Метод не поддерживается'});
          try {
            const blob=await chatMaintenance.attachment(id,attachmentId);
            if(!blob)return send(404,{error:'Вложение не найдено'});
            const fileName=encodeURIComponent(blob.meta.name);
            res.writeHead(200,{'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff',
              'Content-Disposition':"attachment; filename*=UTF-8''"+fileName,
              'Content-Length':blob.bytes.length,'Cache-Control':'no-store'});
            return void res.end(req.method==='HEAD'?undefined:blob.bytes);
          }catch(e){return chatFailure(e);}
        }
        if(req.method==='GET') {
          try {return send(200,{attachments:chatMaintenance.listAttachments(id)});}
          catch(e){return chatFailure(e);}
        }
        if(req.method!=='POST')return send(405,{error:'Метод не поддерживается'});
        let length=0;const chunks:Buffer[]=[];
        for await(const chunk of req) {
          length+=chunk.length;
          if(length>15_000_000)return send(413,{error:'Вложение больше 15 МБ'});
          chunks.push(chunk);
        }
        let fileName='Файл';
        try {fileName=decodeURIComponent(String(req.headers['x-file-name']||'Файл').slice(0,600));}
        catch{return send(400,{error:'Неверное имя файла'});}
        const contentType=String(req.headers['content-type']||'application/octet-stream');
        const messageId=typeof req.headers['x-message-id']==='string'?req.headers['x-message-id']:undefined;
        try{return send(201,await chatMaintenance.saveAttachment(id,Buffer.concat(chunks),contentType,fileName,messageId));}
        catch(e){return chatFailure(e);}
      }
      const chatMatch = /^\/api\/assistant\/conversations\/([a-zA-Z0-9_-]{1,80})(\/messages)?$/.exec(path);
      if (chatMatch) {
        const id = chatMatch[1];
        if (chatMatch[2]) {
          if (req.method === 'GET') {
            const query = new URL(req.url || '/', origin).searchParams;
            const before = query.has('before') ? Number(query.get('before')) : undefined;
            try { return send(200, await chatArchive.page(id, before, Number(query.get('limit') || 100))); }
            catch (e) { return chatFailure(e); }
          }
          if (req.method !== 'POST') return send(405, { error: 'Метод не поддерживается' });
          const data = await readJson(req, send, 12_000_000);
          if (data === undefined) return;
          try { return send(200, await chatArchive.saveMessage(id, data?.message, data?.expectedCount)); }
          catch (e) { return chatFailure(e); }
        }
        if (req.method !== 'PATCH') return send(405, { error: 'Метод не поддерживается' });
        const data = await readJson(req, send, 2000);
        if (data === undefined) return;
        try { return send(200, await chatArchive.modify(id, data)); }
        catch (e) { return chatFailure(e); }
      }
      if (path === '/api/assistant/preferences') {
        if (req.method === 'GET') return send(200, vault.preferences());
        if (req.method !== 'PATCH') return send(405, { error: 'Метод не поддерживается' });
        const input = await readJson(req, send, 6000);
        if (input === undefined) return;
        try { return send(200, await vault.patchPreferences(input)); }
        catch (e) { return send((e as { status?: number }).status || 500, { error: (e as Error).message }); }
      }
      if (path === '/api/assistant/avatars') {
        if (req.method === 'GET') return send(200, { avatars: vault.avatars() });
        if (req.method !== 'POST') return send(405, { error: 'Метод не поддерживается' });
        const header = req.headers['x-avatar-name'];
        const rawName = typeof header === 'string' ? header.slice(0, 400) : 'Аватар';
        let name = 'Аватар';
        try { name = decodeURIComponent(rawName).slice(0, 100); } catch { return send(400, { error: 'Неверное имя аватара.' }); }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > AVATAR_LIMIT) return send(413, { error: 'Изображение больше 15 МБ.' });
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        const type = sniffImage(bytes);
        if (!type) return send(415, { error: 'Поддерживаются PNG, JPEG, WebP и GIF.' });
        const id = req.headers['x-avatar-id'];
        try { return send(201, { avatar: await vault.addAvatar(bytes, type, name, typeof id === 'string' ? id : undefined) }); }
        catch (e) { return send((e as { status?: number }).status || 500, { error: (e as Error).message }); }
      }
      const libraryId = /^\/api\/assistant\/avatars\/([a-zA-Z0-9_-]{1,80})$/.exec(path)?.[1];
      if (libraryId) {
        if (req.method === 'DELETE') {
          try { return send(await vault.removeAvatar(libraryId) ? 200 : 404, { ok: true }); }
          catch (e) { return send(500, { error: 'Не удалось удалить аватар.' }); }
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'Метод не поддерживается' });
        const item = await vault.avatar(libraryId);
        if (!item) return send(404, { error: 'Образ не найден.' });
        res.writeHead(200, { 'Content-Type': item.entry.type, 'Cache-Control': 'no-store' });
        return void res.end(req.method === 'HEAD' ? undefined : item.bytes);
      }
      if (path.startsWith('/api/assistant')) {
        const route = path.slice('/api/assistant'.length);
        if (route === '' && req.method === 'GET') return send(200, publicConfig());
        if (route === '' && req.method === 'PUT') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          if (!input || typeof input !== 'object') return send(400, { error: 'Неверный формат настроек.' });
          if (input.apiKey !== undefined && input.apiKey !== null && !validKey(input.apiKey)) return send(400, { error: 'Ключ должен содержать от 8 до 512 видимых символов без пробелов.' });
          if (input.model !== undefined && !validModel(input.model)) return send(400, { error: 'Неверное название модели.' });
          if (input.embedModel !== undefined && input.embedModel !== '' && !validModel(input.embedModel)) return send(400, { error: 'Неверное название модели для поиска.' });
          if (input.smartModel !== undefined && input.smartModel !== '' && !validModel(input.smartModel)) return send(400, { error: 'Неверное название модели для сложных вопросов.' });
          if (input.context !== undefined && typeof input.context !== 'boolean') return send(400, { error: 'Неверный формат настроек.' });
          await saveAssistant({ ...assistant, apiKey: input.apiKey === null ? '' : input.apiKey ?? assistant.apiKey, model: input.model ?? assistant.model, smartModel: input.smartModel ?? assistant.smartModel, embedModel: input.embedModel ?? assistant.embedModel, context: input.context ?? assistant.context });
          return send(200, publicConfig());
        }
        if (route === '/avatar') {
          if (req.method === 'GET' || req.method === 'HEAD') {
            if (!assistant.avatar) return send(404, { error: 'Свой образ не загружен' });
            const content = await readFile(avatarFile(assistant.avatar.type));
            res.writeHead(200, { 'Content-Type': assistant.avatar.type });
            return void res.end(req.method === 'HEAD' ? undefined : content);
          }
          if (req.method === 'PUT') {
            if (!String(req.headers['content-type']).startsWith('image/')) return send(415, { error: 'Выберите изображение PNG, JPEG, WebP или GIF.' });
            const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > AVATAR_LIMIT) return send(413, { error: 'Изображение больше 15 МБ.' });
              chunks.push(chunk);
            }
            const bytes = Buffer.concat(chunks);
            const type = sniffImage(bytes);
            if (!type) return send(415, { error: 'Поддерживаются PNG, JPEG, WebP и GIF.' });
            const previous = assistant.avatar;
            const update = queue.then(async () => {
              // The original bytes are stored untouched to keep full quality.
              await atomicWrite(avatarFile(type), bytes);
              const next = { ...assistant, avatar: { type, version: Date.now() } };
              await atomicWrite(assistantFile, JSON.stringify(next, null, 2));
              assistant = next;
              if (previous && previous.type !== type) await rm(avatarFile(previous.type), { force: true });
            });
            queue = update.catch(() => {});
            await update;
            return send(200, publicConfig());
          }
          if (req.method === 'DELETE') {
            const previous = assistant.avatar;
            await saveAssistant({ ...assistant, avatar: null });
            if (previous) await rm(avatarFile(previous.type), { force: true });
            return send(200, publicConfig());
          }
          return send(405, { error: 'Метод не поддерживается' });
        }
        // A saved key is NOT proof of connectivity. Verify actual access to the
        // configured model using Cloud.ru's read-only model catalogue.
        if (route === '/verify' && req.method === 'POST') {
          if (!assistant.apiKey) return send(200, { status: 'not-configured', message: 'Сначала сохраните API-ключ Cloud.ru.', model: assistant.model });
          try {
            const body = await cloudJson('/models', 12_000);
            const models = (Array.isArray(body?.data) ? body.data : []).map((m: { id?: unknown }) => m?.id).filter(validModel);
            if (!models.length) return send(200, { status: 'error', message: 'Cloud.ru не вернул список моделей. Подключение не подтверждено.', model: assistant.model });
            if (!models.includes(assistant.model)) return send(200, { status: 'model-unavailable', message: 'Ключ принят, но выбранная модель отсутствует в доступном списке.', model: assistant.model });
            return send(200, { status: 'connected', message: 'API-ключ принят, модель доступна в списке Cloud.ru. Генерация ответа не проверялась.', model: assistant.model });
          } catch (e) {
            // Do not echo arbitrary upstream payloads: they may contain secrets.
            const status = (e as { status?: number }).status;
            const reason = (e as Error).message || '';
            const message = /не принял ключ/.test(reason) ? 'Cloud.ru отклонил API-ключ.'
              : status === 504 ? 'Cloud.ru не ответил. Проверьте интернет и повторите.'
              : 'Не удалось проверить подключение к Cloud.ru.';
            return send(200, { status: 'error', message, model: assistant.model });
          }
        }
        // A deliberate, potentially billable test: unlike /verify it actually
        // sends a short completion request to the selected chat model.
        if (route === '/test' && req.method === 'POST') {
          if (!assistant.apiKey) return send(200, { status: 'not-configured', message: 'Сначала сохраните API-ключ Cloud.ru.' });
          let call: Awaited<ReturnType<typeof cloud>> | undefined;
          try {
            call = await cloud('/chat/completions', {
              method: 'POST',
              body: JSON.stringify({
                model: assistant.model, stream: false, max_completion_tokens: 96,
                messages: [{ role: 'user', content: 'Ответь одним словом: готово' }]
              })
            }, 30_000);
            const answer = await call.response.json();
            const content = answer?.choices?.[0]?.message?.content;
            if (typeof content !== 'string' || !content.trim()) {
              return send(200, { status: 'error', message: 'Cloud.ru ответил, но модель не вернула текст. Проверьте, что выбрана LLM-модель.' });
            }
            return send(200, { status: 'working', message: 'Модель успешно ответила. Подключение и генерация работают.' });
          } catch (e) {
            const reason = (e as Error).message || '';
            const message = /не принял ключ/.test(reason) ? 'Cloud.ru отклонил API-ключ.'
              : /не нашёл модель/.test(reason) ? 'Выбранная модель не найдена или не поддерживает этот запрос.'
              : (e as { status?: number }).status === 504 ? 'Cloud.ru не ответил вовремя. Проверьте интернет и повторите.'
              : 'Не удалось получить ответ модели. Проверьте модель, доступ и лимиты Cloud.ru.';
            return send(200, { status: 'error', message });
          } finally { call?.release(); }
        }
        if (route === '/models' && req.method === 'GET') {
          if (!assistant.apiKey) return send(409, { error: 'Сначала сохраните API-ключ cloud.ru.' });
          try {
            const body = await cloudJson('/models', 20_000);
            const models = (Array.isArray(body?.data) ? body.data : []).map((m: { id?: unknown }) => m?.id).filter(validModel);
            return send(200, { models: [...new Set<string>(models)].sort((a, b) => a.localeCompare(b)) });
          } catch (e) { return send((e as { status: number }).status, { error: (e as Error).message }); }
        }
        if (route === '/chat' && req.method === 'POST') {
          if (!assistant.apiKey) return send(409, { error: 'Подключите cloud.ru в настройках пространства: сохраните API-ключ и выберите модель.' });
          const input = await readJson(req, send, 400_000);
          if (input === undefined) return;
          const messages = input?.messages;
          const dialog = validDialogId(input?.dialog) ? input.dialog : null;
          const summary = typeof input?.summary === 'string' ? input.summary.slice(0, 6000).trim() : '';
          if (!Array.isArray(messages) || !messages.length || messages.length > 60 || !messages.every((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 20_000) || messages.at(-1).role !== 'user')
            return send(400, { error: 'Неверный формат сообщений.' });
          const recordingGeneration=memory.generation;
          memory.touch();
          const last = messages.at(-1).content;
          // «Запомни …» and «забудь …» change the memory before the answer, so the model can confirm it.
          const notes: string[] = []; const events: string[] = [];
          const command = memory.data.settings.enabled ? parseCommand(last) : null;
          if (command?.kind === 'remember') {
            const item = await memory.remember(command.text);
            if (item) { notes.push(`Ты только что сохранила в долговременную память: «${item.text}». Коротко подтверди.`); events.push('Запомнила: ' + item.text); }
          }
          // «Напомни, когда заговорим о …» is kept until the talk turns to that topic.
          const reminder = memory.data.settings.enabled ? parseReminder(last) : null;
          if (reminder) {
            const added = await memory.remind(reminder.about, reminder.text, last);
            notes.push(added ? `Ты только что поставила напоминание: когда речь зайдёт о «${added.about}», напомнишь «${added.text}». Коротко подтверди.` : 'Такое напоминание уже стоит. Коротко скажи, что помнишь о нём.');
            if (added) events.push(`Напомню, когда речь зайдёт о «${added.about}»`);
          }
          if (command?.kind === 'forget') {
            const removed = await memory.forget(command.text);
            notes.push(removed.length ? `Ты только что удалила из памяти: ${removed.map(t => `«${t}»`).join(', ')}. Коротко подтверди.` : 'Пользователь просит забыть, но в памяти нет ничего похожего. Скажи об этом и предложи открыть меню «Память» (значок мозга вверху справа).');
            if (removed.length) events.push(`Забыла записей: ${removed.length}`);
          }
          // «Разложи цель …» builds a tree of steps before the answer, so the answer can show it.
          const goalTitle = memory.data.settings.enabled ? parseGoal(last) : null;
          if (goalTitle) {
            try {
              const goal = await memory.plan(goalTitle);
              notes.push(`Ты только что разложила цель «${goal.title}» на подзадачи и сохранила её в памяти («Дела»):\n${goalTree(goal)}\nПокажи это дерево коротко, списком с отступами, и скажи, с какого шага начать.`);
              events.push(`Цель разложена на шаги: ${goal.title}`);
            } catch { notes.push('Сохранить цель с подзадачами не получилось. Разложи её сама в ответе: дерево подзадач с зависимостями.'); }
          }
          const recall = await memory.context(messages.filter((m: ChatMessage) => m.role === 'user').slice(-3).map((m: ChatMessage) => m.content).join('\n'), last);
          // Strong logic: a complex question gets a hidden reasoning plan and the stronger model; numbers are counted by code.
          const hard = complexity(last).complex || !!goalTitle;
          const calcs = exactCalcs(last);
          let plan: Plan | null = null;
          if (hard && !goalTitle) {
            try {
              const asked = messages.filter((m: ChatMessage) => m.role === 'user').slice(-3).map((m: ChatMessage) => m.content.slice(0, 3000));
              plan = readPlan(parseJson(await ask(PLAN_PROMPT, [`Сегодня ${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`, recall.slice(0, 4000), 'Последние сообщения пользователя:\n' + asked.join('\n---\n')].filter(Boolean).join('\n\n'), 30_000, true)));
            } catch {}
          }
          const reasoning = reasoningBlock(hard, plan, calcs);
          const model = modelFor(hard);
          const verifying=exactLines(plan,calcs).length>0 || needsGrounding(last) || (hard && /(?:у меня|мне|мой|моя|мои|моё|(?:^|\s)я(?:\s|$))/i.test(last));
          const proofSources:Source[]=[...memory.sources(),...messages.filter((m:ChatMessage)=>m.role==='user').slice(-3).map((m:ChatMessage,i:number)=>({source:'current-'+i,version:digest(m.content),text:m.content,quote:'',at:new Date().toISOString(),role:'user' as const})),
            ...(assistant.context?state.data.notes.filter(n=>n.title.toLocaleLowerCase('ru').includes(last.toLocaleLowerCase('ru')) || last.toLocaleLowerCase('ru').split(/\s+/).some((w:string)=>w.length>=4&&(n.title+' '+n.body).toLocaleLowerCase('ru').includes(w))).slice(0,8).map(n=>{const terms=last.toLocaleLowerCase('ru').split(/\s+/).filter((w:string)=>w.length>=4);const hit=terms.map((w:string)=>n.body.toLocaleLowerCase('ru').indexOf(w)).find((i:number)=>i>=0) ?? 0;return {source:'note-'+n.id,version:digest(n.updatedAt+'\n'+n.body),text:n.title+'\n'+n.body.slice(Math.max(0,hit-500),hit+4500),quote:'',at:n.updatedAt,role:'note' as const};}):[]),
            ...exactLines(plan,calcs).map((text,i)=>({source:'calculation-'+i,version:digest(text),text,quote:'',at:new Date().toISOString(),role:'note' as const}))].slice(-120);
          let reviewed:Review|undefined;
          const system = [PERSONA, ACTIONS, assistant.context ? workspaceContext(state.data,new Date(),30_000,last) : 'Доступ к заметкам и задачам пользователя выключен в настройках. Если спросят о них, мягко скажи об этом.',
            recall, summary ? 'Краткое содержание более ранней части этого разговора:\n' + summary : '', reasoning, ...notes].filter(Boolean).join('\n\n');
          let call;
          try {
            call = await cloud('/chat/completions', { method: 'POST', body: JSON.stringify({ model, stream: true, temperature: 0.7, messages: [{ role: 'system', content: system }, ...messages.map((m: ChatMessage) => ({ role: m.role, content: m.content }))] }) });
          } catch (e) { return send((e as { status: number }).status, { error: (e as Error).message }); }
          // Stream the answer to the browser as JSON lines: {delta}, then {done} or {error}.
          const onClose = () => { if (!res.writableEnded) call.controller.abort(new Error('client closed')); };
          res.on('close', onClose);
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
          const write = (value: any) => { if (!res.destroyed && !(verifying && value.delta)) res.write(JSON.stringify(value) + '\n'); };
          let received = false, answer = '';
          for (const text of events) write({ memory: text });
          try {
            if (!(call.response.headers.get('content-type') || '').includes('text/event-stream')) {
              // Some models ignore stream: true and answer with one JSON body.
              const body = JSON.parse(await call.response.text());
              const text = body?.choices?.[0]?.message?.content;
              if (typeof text === 'string' && text.trim()) { write({ delta: text }); answer = text; received = true; }
            } else {
              const decoder = new TextDecoder();
              let buffer = '';
              read: for await (const chunk of call.response.body as unknown as AsyncIterable<Uint8Array>) {
                call.extend();
                buffer += decoder.decode(chunk, { stream: true });
                for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
                  const line = buffer.slice(0, end).trim();
                  buffer = buffer.slice(end + 1);
                  if (!line.startsWith('data:')) continue;
                  const payload = line.slice(5).trim();
                  if (payload === '[DONE]') break read;
                  let event;
                  try { event = JSON.parse(payload); } catch { continue; }
                  if (event?.error) throw fail(String(event.error.message || 'cloud.ru прервал ответ.').replaceAll(assistant.apiKey, '…').slice(0, 300), 502);
                  const text = event?.choices?.[0]?.delta?.content ?? event?.choices?.[0]?.message?.content;
                  if (typeof text === 'string' && text) { write({ delta: text }); answer += text; received = true; }
                }
              }
            }
            if (!received) throw fail('Модель вернула пустой ответ. Попробуйте переформулировать или выбрать другую модель.', 502);
            if(verifying) {
              try { reviewed=reviewAnswer(answer,parseJson(await ask(VERIFY_PROMPT,JSON.stringify({question:last,draft:answer,sources:proofSources}),30000,true)),proofSources,true); }
              catch { reviewed={status:'uncertain',reasons:['Проверка источников сейчас недоступна.'],checked:0}; }
              if(reviewed.status!=='supported')answer='Не могу подтвердить этот ответ по доступным источникам. Уточните сведения или укажите нужную заметку.'+(exactLines(plan,calcs).length?'\n\nРасчёты, выполненные кодом:\n'+exactLines(plan,calcs).join('\n'):'');
              if(!res.destroyed)res.write(JSON.stringify({delta:answer})+'\n');
            }
            const exact = exactLines(plan, calcs).length;
            write({ done: true, model, ...(reviewed?{verification:reviewed.status}:{}), ...(hard ? { reasoning: true } : {}), ...(plan ? { planned: true } : {}), ...(exact ? { exact } : {}) });
            // A reminder counts as given only once the answer that carries it has arrived.
            await memory.delivered(recall,answer).catch(() => {});
            if (dialog) await memory.record(dialog, [...messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })), { role: 'assistant', content: answer }], summary,recordingGeneration).catch(() => {});
          } catch (e) {
            write({ error: (e as { status?: number }).status ? (e as Error).message : call.explain().message });
          } finally {
            call.release();
            res.off('close', onClose);
            res.end();
          }
          return;
        }
        if (route === '/compact' && req.method === 'POST') {
          if (!assistant.apiKey) return send(409, { error: 'Сначала подключите cloud.ru.' });
          const input = await readJson(req, send, 400_000);
          if (input === undefined) return;
          const messages = input?.messages;
          if (!Array.isArray(messages) || !messages.length || messages.length > 60 || !messages.every((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 20_000)) return send(400, { error: 'Неверный формат сообщений.' });
          const previous = typeof input.summary === 'string' ? input.summary.slice(0, 6000) : '';
          try {
            const text = await ask(COMPACT_PROMPT, (previous ? 'Прежнее резюме:\n' + previous + '\n\nПродолжение разговора:\n' : '') + transcript(messages, 40_000));
            return send(200, { summary: text.trim().slice(0, 4000) });
          } catch (e) { return send((e as { status: number }).status, { error: (e as Error).message }); }
        }
        return send(405, { error: 'Метод не поддерживается' });
      }
      if (path === '/api/memory' || path.startsWith('/api/memory/')) {
        const route = path.slice('/api/memory'.length);
        const ok = () => send(200, memory.view());
        const background = (e: unknown) => send((e as { status?: number }).status || 500, { error: (e as Error).message || 'Не удалось обработать память.' });
        if (route === '' && req.method === 'GET') return ok();
        if (route === '' && req.method === 'PUT') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          const flag = (v: unknown) => v === undefined || typeof v === 'boolean';
          if (!input || typeof input !== 'object' || !flag(input.enabled) || !flag(input.private) || !flag(input.thinking) || (input.intensity !== undefined && !['low', 'normal', 'high'].includes(input.intensity))) return send(400, { error: 'Неверный формат настроек памяти.' });
          await memory.settings({ ...(input.enabled !== undefined && { enabled: input.enabled }), ...(input.private !== undefined && { private: input.private }), ...(input.thinking !== undefined && { thinking: input.thinking }), ...(input.intensity !== undefined && { intensity: input.intensity }) });
          return ok();
        }
        if (route === '' && req.method === 'DELETE') { await memory.reset(); return ok(); }
        if (route === '/export' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="Miyuneya-memory-${new Date().toISOString().slice(0, 10)}.json"` });
          return void res.end(JSON.stringify(memory.exportData(), null, 2));
        }
        if (route === '/items' && req.method === 'POST') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          if ((input?.kind !== 'fact' && input?.kind !== 'rule') || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 400) return send(400, { error: 'Запись должна быть от 1 до 400 символов.' });
          await memory.add(input.kind, input.text, { category: input.category, until: input.until });
          return ok();
        }
        const item = /^\/items\/([\w-]{1,100})$/.exec(route)?.[1];
        if (item && req.method === 'PATCH') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          const textual = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);
          if (!input || typeof input !== 'object' || !textual(input.text, 2000) || !textual(input.topic, 200) || !textual(input.outcome, 600) || !textual(input.name, 80) || !textual(input.about, 300) || !textual(input.category, 20) || !textual(input.type, 20) || !textual(input.title, 80) || !textual(input.summary, 600)
            || (input.until !== undefined && input.until !== null && !validDate(input.until)) || (input.pinned !== undefined && typeof input.pinned !== 'boolean') || (input.done !== undefined && typeof input.done !== 'boolean')
            || !textual(input.step, 100) || !textual(input.note, 300) || (input.result !== undefined && input.result !== 'right' && input.result !== 'wrong')) return send(400, { error: 'Неверный формат записи.' });
          return await memory.edit(item, input) ? ok() : send(404, { error: 'Запись не найдена.' });
        }
        if (item && req.method === 'DELETE') return await memory.remove(item) ? ok() : send(404, { error: 'Запись не найдена.' });
        if (route === '/reminders' && req.method === 'POST') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          if (typeof input?.about !== 'string' || typeof input.text !== 'string' || !input.about.trim() || !input.text.trim() || input.about.length > 120 || input.text.length > 300) return send(400, { error: 'Нужны тема до 120 символов и текст до 300.' });
          await memory.remind(input.about, input.text);
          return ok();
        }
        if (route === '/goals' && req.method === 'POST') {
          if (!assistant.apiKey) return send(409, { error: 'Чтобы разложить цель, Миюнэе нужен ключ cloud.ru.' });
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          if (typeof input?.title !== 'string' || !input.title.trim() || input.title.length > 200) return send(400, { error: 'Цель должна быть от 1 до 200 символов.' });
          try { await memory.plan(input.title); return ok(); } catch (e) { return background(e); }
        }
        if (route === '/answer' && req.method === 'POST') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          if (typeof input?.id !== 'string' || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 400) return send(400, { error: 'Ответ должен быть от 1 до 400 символов.' });
          return await memory.answer(input.id, input.text) ? ok() : send(404, { error: 'Вопрос не найден.' });
        }
        if ((route === '/signal' || route === '/unlink') && req.method === 'POST') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          if (route === '/unlink') {
            if (typeof input?.from !== 'string' || typeof input.to !== 'string') return send(400, { error: 'Неверная связь.' });
            return await memory.unlink(input.from, input.to) ? ok() : send(404, { error: 'Связь не найдена.' });
          }
          const signals: Record<string, (text: string) => string> = { undo: t => `Отменил созданную тобой запись «${t}»`, copy: () => 'Скопировал твой ответ', save: () => 'Сохранил твой ответ в заметку', stop: () => 'Остановил твой ответ, не дослушав' };
          if (!validDialogId(input?.dialog) || !Object.hasOwn(signals, input.kind) || (input.text !== undefined && typeof input.text !== 'string')) return send(400, { error: 'Неверный сигнал.' });
          await memory.signal(input.dialog, signals[input.kind](String(input.text || '').slice(0, 120)));
          return send(200, { ok: true });
        }
        if (route === '/think' && req.method === 'POST') {
          if (!assistant.apiKey) return send(409, { error: 'Чтобы размышлять, Миюнэе нужен ключ cloud.ru.' });
          try { await memory.thinkNow(); return ok(); } catch (e) { return background(e); }
        }
        if (route === '/thoughts/seen' && req.method === 'POST') { await memory.seen(); return ok(); }
        if (route === '/sleep' && req.method === 'POST') {
          if (!assistant.apiKey) return send(409, { error: 'Для сна памяти нужен ключ cloud.ru.' });
          try { await memory.sleepNow(); return ok(); } catch (e) { return background(e); }
        }
        if (route === '/close' && req.method === 'POST') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          if (!validDialogId(input?.dialog)) return send(400, { error: 'Неверный диалог.' });
          if (!assistant.apiKey) return ok();
          try { await memory.close(input.dialog); return ok(); } catch (e) { return background(e); }
        }
        return send(405, { error: 'Метод не поддерживается' });
      }
      if (path === '/api/workspace') {
        if (req.method === 'GET') return send(200, state);
        if (req.method !== 'PUT') return send(405, { error: 'Метод не поддерживается' });
        const input = await readJson(req, send, 2_000_000);
        if (input === undefined) return;
        if (!Number.isSafeInteger(input?.revision) || !validateWorkspace(input?.data)) return send(400, { error: 'Неверный формат данных' });
        // Editing notes and tasks counts as being at work, so Miyuneya does not start thinking meanwhile.
        memory.touch();
        const update = queue.then(async () => {
          if (input.revision !== state.revision) return send(409, { error: 'Данные изменены в другой вкладке. Экспортируйте свою копию и обновите страницу.' });
          try{reconcileTasks(state.data,input.data,()=>randomUUID().replaceAll('-',''));}catch(e){return send(409,{error:e.message});}
          const next = { revision: state.revision + 1, data: input.data };
          if(Buffer.byteLength(JSON.stringify(next))>2_000_000)return send(413,{error:'Повторение превышает размер пространства 2 МБ. Изменения не сохранены: экспортируйте записи и освободите место.'});
          await atomicWrite(dataFile, JSON.stringify(next, null, 2));
          state = next;
          send(200, state);
        });
        queue = update.catch(() => {});
        await update;
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'Метод не поддерживается' });
      const asset = Object.hasOwn(files, path) ? files[path] : null;
      if (!asset) return send(404, { error: 'Страница не найдена' });
      const content = await readFile(join(root, 'dist', asset[0]));
      const image = asset[1] === 'image/png';
      // Large avatar images may be cached briefly; everything else stays no-store.
      res.writeHead(200, image ? { 'Content-Type': asset[1], 'Cache-Control': 'max-age=3600' } : { 'Content-Type': asset[1] + '; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (e) {
      console.error('Ошибка запроса:', (e as NodeJS.ErrnoException).code || 'REQUEST_FAILED');
      if (!res.headersSent) send(500, { error: 'Ошибка чтения или записи. Проверьте доступ к папке проекта.' });
      else res.end();
    }
  }
  // Resolves to undefined after it has already answered with an error.
  async function readJson(req, send: (status: number, value: unknown) => void, limit: number) {
    if (!req.headers['content-type']?.startsWith('application/json')) return void send(415, { error: 'Ожидается JSON' });
    let body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > limit) return void send(413, { error: limit >= 1_000_000 ? `Размер данных превышает ${limit / 1_000_000} МБ` : 'Слишком большой запрос' });
    }
    try { return JSON.parse(body) ?? null; } catch { return void send(400, { error: 'Неверный JSON' }); }
  }
  let shutdownPromise: Promise<void> | undefined;
  return Object.assign(server, {
    shutdown() {
      if (!shutdownPromise) shutdownPromise = (async () => {
        stopping = true;
        for (const controller of upstream) controller.abort(new Error('shutdown'));
        if (server.listening) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
        await Promise.all([...active]);
        await memory.shutdown();
        await workflows?.shutdown();
        await disk?.shutdown();
        await queue;
        await vault.shutdown();
        await chatMaintenance.shutdown();
        await chatArchive.shutdown();
      })();
      return shutdownPromise;
    }
  });
}
