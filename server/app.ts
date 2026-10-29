import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { atomicWrite } from '../scripts/runtime.mjs';
import { join } from 'node:path';
import { validateWorkspace, emptyWorkspace } from '../src/model.ts';
import type { Workspace } from '../src/model.ts';

export const CLOUD_RU_URL = 'https://foundation-models.api.cloud.ru/v1';
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const PERSONA = 'Ты Миюнэя — тёплая и внимательная помощница в личном пространстве заметок и задач. Отвечай по-русски, ясно и по делу, если пользователь не попросил иначе.';
// The browser turns these tags into real entries, so the model only uses them on an explicit request.
const ACTIONS = 'Ты умеешь создавать записи в пространстве. Только когда пользователь прямо просит добавить задачу, допиши в конце ответа по строке <task>текст задачи</task> на каждую задачу. Только когда просит сохранить заметку, допиши <note title="Короткий заголовок">текст заметки</note>. В остальных случаях эти теги не используй и не показывай их как пример. Сами теги пользователь не увидит: приложение создаст записи и покажет подтверждение.';
type CustomAvatar = { type: string; version: number };
type AssistantConfig = { apiKey: string; model: string; context: boolean; avatar: CustomAvatar | null };
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
export function workspaceContext(data: Workspace, now = new Date(), budget = 30_000) {
  const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [`Сегодня ${now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`, 'Ниже содержимое пространства пользователя. Опирайся на него, когда вопрос касается его дел и записей; не пересказывай его без просьбы.'];
  const open = data.tasks.filter(t => !t.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = data.tasks.filter(t => t.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  const notes = [...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  let used = lines.join('\n').length, cut = false;
  const add = (line: string) => { if (cut || used + line.length > budget) { cut = true; return; } lines.push(line); used += line.length + 1; };
  add(`\nОткрытые задачи (${open.length}):`); if (!open.length) add('— нет');
  for (const t of open) add(`- ${t.title} (добавлена ${day(t.createdAt)})`);
  add(`\nНедавно выполненные задачи (${done.length}):`); if (!done.length) add('— нет');
  for (const t of done) add(`- ${t.title}`);
  add(`\nЗаметки (${notes.length}, свежие сверху):`); if (!notes.length) add('— нет');
  for (const n of notes) add(`### ${n.title} (изменена ${day(n.updatedAt)})${n.body.trim() ? '\n' + (n.body.length > 800 ? n.body.slice(0, 800) + '…' : n.body) : ''}`);
  if (cut) lines.push('(Показаны не все записи: пространство слишком большое.)');
  return lines.join('\n');
}

export async function createApp(root: string, instance: string, preview = false, options: { launchId?: string; onShutdown?: () => void; cloudUrl?: string } = {}) {
  const dataDir = join(root, 'data');
  const dataFile = join(dataDir, 'workspace.json');
  // The cloud.ru key lives apart from workspace.json so it never reaches the browser or a backup.
  const assistantFile = join(dataDir, 'assistant.json');
  const cloudUrl = (options.cloudUrl || CLOUD_RU_URL).replace(/\/+$/, '');
  let assistant: AssistantConfig = { apiKey: '', model: DEFAULT_MODEL, context: true, avatar: null };
  try {
    const saved = JSON.parse(await readFile(assistantFile, 'utf8'));
    const avatar = imageTypes[saved.avatar?.type] && Number.isSafeInteger(saved.avatar?.version) ? { type: saved.avatar.type, version: saved.avatar.version } : null;
    assistant = { apiKey: validKey(saved.apiKey) ? saved.apiKey : '', model: validModel(saved.model) ? saved.model : DEFAULT_MODEL, context: saved.context !== false, avatar };
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
  let queue = Promise.resolve();
  const files: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
    '/calendar.js': ['calendar.js', 'text/javascript'], '/main.js': ['main.js', 'text/javascript'], '/model.js': ['model.js', 'text/javascript'],
    '/assistant.js': ['assistant.js', 'text/javascript'],
    '/style.css': ['style.css', 'text/css'], '/fox.svg': ['fox.svg', 'image/svg+xml'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
    ...Object.fromEntries([1, 2, 3, 4].map(n => [`/avatars/avatar${n}.png`, [`avatars/avatar${n}.png`, 'image/png']]))
  };
  const publicConfig = () => ({ configured: !!assistant.apiKey, keyHint: keyHint(assistant.apiKey), model: assistant.model, context: assistant.context, customAvatar: assistant.avatar?.version ?? null });
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
  let stopping = false;
  const active = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    const operation = handle(req, res);
    active.add(operation);
    operation.finally(() => active.delete(operation)).catch(() => {});
  });
  server.requestTimeout = 5000;
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
      if (path.startsWith('/api/assistant')) {
        const route = path.slice('/api/assistant'.length);
        if (route === '' && req.method === 'GET') return send(200, publicConfig());
        if (route === '' && req.method === 'PUT') {
          const input = await readJson(req, send, 10_000);
          if (input === undefined) return;
          if (!input || typeof input !== 'object') return send(400, { error: 'Неверный формат настроек.' });
          if (input.apiKey !== undefined && input.apiKey !== null && !validKey(input.apiKey)) return send(400, { error: 'Ключ должен содержать от 8 до 512 видимых символов без пробелов.' });
          if (input.model !== undefined && !validModel(input.model)) return send(400, { error: 'Неверное название модели.' });
          if (input.context !== undefined && typeof input.context !== 'boolean') return send(400, { error: 'Неверный формат настроек.' });
          await saveAssistant({ ...assistant, apiKey: input.apiKey === null ? '' : input.apiKey ?? assistant.apiKey, model: input.model ?? assistant.model, context: input.context ?? assistant.context });
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
          if (!Array.isArray(messages) || !messages.length || messages.length > 60 || !messages.every((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 20_000) || messages.at(-1).role !== 'user')
            return send(400, { error: 'Неверный формат сообщений.' });
          const system = [PERSONA, ACTIONS, assistant.context ? workspaceContext(state.data) : 'Доступ к заметкам и задачам пользователя выключен в настройках. Если спросят о них, мягко скажи об этом.'].join('\n\n');
          let call;
          try {
            call = await cloud('/chat/completions', { method: 'POST', body: JSON.stringify({ model: assistant.model, stream: true, temperature: 0.7, messages: [{ role: 'system', content: system }, ...messages.map((m: ChatMessage) => ({ role: m.role, content: m.content }))] }) });
          } catch (e) { return send((e as { status: number }).status, { error: (e as Error).message }); }
          // Stream the answer to the browser as JSON lines: {delta}, then {done} or {error}.
          const onClose = () => { if (!res.writableEnded) call.controller.abort(new Error('client closed')); };
          res.on('close', onClose);
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
          const write = (value: unknown) => { if (!res.destroyed) res.write(JSON.stringify(value) + '\n'); };
          let received = false;
          try {
            if (!(call.response.headers.get('content-type') || '').includes('text/event-stream')) {
              // Some models ignore stream: true and answer with one JSON body.
              const body = JSON.parse(await call.response.text());
              const text = body?.choices?.[0]?.message?.content;
              if (typeof text === 'string' && text.trim()) { write({ delta: text }); received = true; }
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
                  if (typeof text === 'string' && text) { write({ delta: text }); received = true; }
                }
              }
            }
            if (!received) throw fail('Модель вернула пустой ответ. Попробуйте переформулировать или выбрать другую модель.', 502);
            write({ done: true, model: assistant.model });
          } catch (e) {
            write({ error: (e as { status?: number }).status ? (e as Error).message : call.explain().message });
          } finally {
            call.release();
            res.off('close', onClose);
            res.end();
          }
          return;
        }
        return send(405, { error: 'Метод не поддерживается' });
      }
      if (path === '/api/workspace') {
        if (req.method === 'GET') return send(200, state);
        if (req.method !== 'PUT') return send(405, { error: 'Метод не поддерживается' });
        const input = await readJson(req, send, 2_000_000);
        if (input === undefined) return;
        if (!Number.isSafeInteger(input?.revision) || !validateWorkspace(input?.data)) return send(400, { error: 'Неверный формат данных' });
        const update = queue.then(async () => {
          if (input.revision !== state.revision) return send(409, { error: 'Данные изменены в другой вкладке. Экспортируйте свою копию и обновите страницу.' });
          const next = { revision: state.revision + 1, data: input.data };
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
        await queue;
      })();
      return shutdownPromise;
    }
  });
}
