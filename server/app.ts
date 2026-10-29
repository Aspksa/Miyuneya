import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { atomicWrite } from '../scripts/runtime.mjs';
import { join } from 'node:path';
import { validateWorkspace, emptyWorkspace } from '../src/model.ts';
import type { Workspace } from '../src/model.ts';

export async function createApp(root: string, instance: string, preview = false, options: { launchId?: string; onShutdown?: () => void } = {}) {
  const dataDir = join(root, 'data');
  const dataFile = join(dataDir, 'workspace.json');
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
    '/style.css': ['style.css', 'text/css'], '/fox.svg': ['fox.svg', 'image/svg+xml'], '/favicon.svg': ['favicon.svg', 'image/svg+xml']
  };
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
      if (path === '/api/workspace') {
        if (req.method === 'GET') return send(200, state);
        if (req.method !== 'PUT') return send(405, { error: 'Метод не поддерживается' });
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Ожидается JSON' });
        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 2_000_000) return send(413, { error: 'Размер данных превышает 2 МБ' });
        }
        let input;
        try { input = JSON.parse(body); } catch { return send(400, { error: 'Неверный JSON' }); }
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
      res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (e) {
      console.error('Ошибка запроса:', (e as NodeJS.ErrnoException).code || 'REQUEST_FAILED');
      if (!res.headersSent) send(500, { error: 'Ошибка чтения или записи. Проверьте доступ к папке проекта.' });
      else res.end();
    }
  }
  let shutdownPromise: Promise<void> | undefined;
  return Object.assign(server, {
    shutdown() {
      if (!shutdownPromise) shutdownPromise = (async () => {
        stopping = true;
        if (server.listening) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
        await Promise.all([...active]);
        await queue;
      })();
      return shutdownPromise;
    }
  });
}
