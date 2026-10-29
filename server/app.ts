import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { atomicWrite } from '../scripts/runtime.mjs';
import { join } from 'node:path';
import { validateWorkspace, emptyWorkspace } from '../src/model.ts';
import type { Workspace } from '../src/model.ts';

export const CLOUD_RU_URL = 'https://foundation-models.api.cloud.ru/v1';
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const SYSTEM_PROMPT = 'Ты Миюнэя — тёплая и внимательная помощница в личном пространстве заметок и задач. Отвечай по-русски, ясно и по делу, если пользователь не попросил иначе.';
type AssistantConfig = { apiKey: string; model: string };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{8,512}$/.test(value);
const validModel = (value: unknown): value is string => typeof value === 'string' && /^[\w.:@\/-]{1,200}$/.test(value);
const keyHint = (key: string) => key ? '••••' + key.slice(-4) : '';

export async function createApp(root: string, instance: string, preview = false, options: { launchId?: string; onShutdown?: () => void; cloudUrl?: string } = {}) {
  const dataDir = join(root, 'data');
  const dataFile = join(dataDir, 'workspace.json');
  // The cloud.ru key lives apart from workspace.json so it never reaches the browser or a backup.
  const assistantFile = join(dataDir, 'assistant.json');
  const cloudUrl = (options.cloudUrl || CLOUD_RU_URL).replace(/\/+$/, '');
  let assistant: AssistantConfig = { apiKey: '', model: DEFAULT_MODEL };
  try {
    const saved = JSON.parse(await readFile(assistantFile, 'utf8'));
    assistant = { apiKey: validKey(saved.apiKey) ? saved.apiKey : '', model: validModel(saved.model) ? saved.model : DEFAULT_MODEL };
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
  const publicConfig = () => ({ configured: !!assistant.apiKey, keyHint: keyHint(assistant.apiKey), model: assistant.model });
  async function cloud(path: string, init: RequestInit = {}, timeout = 120_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
    upstream.add(controller);
    try {
      const response = await fetch(cloudUrl + path, { ...init, signal: controller.signal, headers: { Authorization: 'Bearer ' + assistant.apiKey, 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers } });
      const text = await response.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch {}
      if (!response.ok) {
        const detail = String(body?.error?.message || body?.message || body?.detail || '').replaceAll(assistant.apiKey, '…').slice(0, 300);
        const reason = response.status === 401 || response.status === 403 ? 'cloud.ru не принял ключ. Проверьте API-ключ в настройках пространства.'
          : response.status === 404 ? 'cloud.ru не нашёл модель или адрес. Выберите другую модель в настройках.'
          : response.status === 429 ? 'Превышен лимит запросов cloud.ru. Попробуйте чуть позже.'
          : `cloud.ru вернул ошибку ${response.status}.`;
        throw Object.assign(new Error(detail ? `${reason} ${detail}` : reason), { status: 502 });
      }
      if (!body) throw Object.assign(new Error('cloud.ru вернул ответ в неизвестном формате.'), { status: 502 });
      return body;
    } catch (e) {
      if ((e as { status?: number }).status) throw e;
      throw Object.assign(new Error(controller.signal.aborted ? (stopping ? 'Сервер завершает работу.' : 'cloud.ru не ответил вовремя. Попробуйте ещё раз.') : 'Нет связи с cloud.ru. Проверьте интернет.'), { status: 504 });
    } finally { clearTimeout(timer); upstream.delete(controller); }
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
          const next = { apiKey: input.apiKey === null ? '' : input.apiKey ?? assistant.apiKey, model: input.model ?? assistant.model };
          const update = queue.then(async () => { await atomicWrite(assistantFile, JSON.stringify(next, null, 2)); assistant = next; });
          queue = update.catch(() => {});
          await update;
          return send(200, publicConfig());
        }
        if (route === '/models' && req.method === 'GET') {
          if (!assistant.apiKey) return send(409, { error: 'Сначала сохраните API-ключ cloud.ru.' });
          try {
            const body = await cloud('/models', {}, 20_000);
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
          try {
            const body = await cloud('/chat/completions', { method: 'POST', body: JSON.stringify({ model: assistant.model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages.map((m: ChatMessage) => ({ role: m.role, content: m.content }))], temperature: 0.7 }) });
            const reply = body?.choices?.[0]?.message?.content;
            if (typeof reply !== 'string' || !reply.trim()) return send(502, { error: 'Модель вернула пустой ответ. Попробуйте переформулировать или выбрать другую модель.' });
            return send(200, { reply: reply.trim(), model: assistant.model });
          } catch (e) { return send((e as { status: number }).status, { error: (e as Error).message }); }
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
