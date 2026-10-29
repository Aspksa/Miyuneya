import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) { console.error('Нужен Node.js 22.18 или новее.'); process.exit(1); }
const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const instance = createHash('sha256').update(root).digest('hex').slice(0, 24);
const runtime = join(root, '.runtime');
const pointer = join(runtime, 'server.json');
const open = process.argv.includes('--open');
const preview = process.argv.includes('--preview');
function openBrowser(url) {
  if (!open) return;
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => console.log('Откройте адрес выше в браузере.'));
  child.unref();
}
try {
  const saved = JSON.parse(await readFile(pointer, 'utf8'));
  if (Number.isInteger(saved.port) && saved.port > 0 && saved.port < 65536) {
    const url = `http://127.0.0.1:${saved.port}`;
    const response = await fetch(url + '/__miyuneya/health', { signal: AbortSignal.timeout(1000) });
    const health = await response.json();
    if (health.app === 'Miyuneya' && health.instance === instance) {
      console.log(`Miyuneya уже запущена: ${url}`); openBrowser(url); process.exit(0);
    }
  }
} catch { /* Stale or absent server pointer: start normally. */ }
try {
  await readFile(join(root, 'dist', 'main.js'));
  const { createApp } = await import('../server/app.ts');
  await mkdir(runtime, { recursive: true });
  // A project lock prevents two simultaneous BAT launches from starting two writers.
  const lock = join(runtime, 'start.lock');
  let ownsLock = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await writeFile(lock, String(process.pid), { flag: 'wx' }); ownsLock = true; break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const pid = Number(await readFile(lock, 'utf8'));
        if (!Number.isInteger(pid) || pid <= 0) throw new Error('Некорректный файл блокировки');
        try { process.kill(pid, 0); } catch (probe) { if (probe.code === 'ESRCH') { await unlink(lock); continue; } }
        const saved = JSON.parse(await readFile(pointer, 'utf8'));
        if (Number.isInteger(saved.port) && saved.port > 0 && saved.port < 65536) {
          const url = `http://127.0.0.1:${saved.port}`;
          const health = await (await fetch(url + '/__miyuneya/health', { signal: AbortSignal.timeout(500) })).json();
          if (health.instance === instance) { console.log(`Miyuneya уже запущена: ${url}`); openBrowser(url); process.exit(0); }
        }
      } catch { /* Another launch may be writing its pointer. */ }
      await new Promise(r => setTimeout(r, 100));
    }
  }
  if (!ownsLock) throw new Error('Другой запуск ещё готовится. Повторите через несколько секунд.');
  let app;
  try {
    // Read after acquiring the lock so a competing launch cannot leave stale state.
    app = await createApp(root, instance, preview);
    const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index+1]; };
    const requested = preview ? Number(option('--port') || process.env.PORT || 5173) : 0;
    const host = preview ? (option('--host') || '127.0.0.1') : '127.0.0.1';
    if (!Number.isInteger(requested) || requested < 0 || requested > 65535) throw new Error('Неверный порт предпросмотра.');
    await new Promise((resolve, reject) => { app.once('error', reject); app.listen(requested, host, resolve); });
    const url = `http://127.0.0.1:${app.address().port}`;
    await writeFile(pointer, JSON.stringify({ port: app.address().port, pid: process.pid }), { mode: 0o600 });
    console.log(`\n✦ Miyuneya · v0.1.0\n${url}\n\nДанные: папка data рядом с проектом.\nДля остановки нажмите Ctrl+C или закройте это окно.\n`);
    openBrowser(url);
    let closing = false;
    const stop = async () => {
      if (closing) return; closing = true;
      app.closeAllConnections();
      app.close();
      await Promise.allSettled([unlink(pointer), unlink(lock)]);
      process.exit(0);
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    app.on('error', async e => { console.error(e.message); await stop(); });
  } catch (e) { app?.closeAllConnections(); app?.close(); await unlink(lock).catch(() => {}); throw e; }
} catch (e) { console.error(`Ошибка запуска: ${e.message}`); process.exitCode = 1; }
