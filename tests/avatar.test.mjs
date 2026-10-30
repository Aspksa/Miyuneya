import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('web/blank.html', root), 'utf8');
const css = await readFile(new URL('web/avatar.css', root), 'utf8');
const js = await readFile(new URL('web/avatar.js', root), 'utf8');
const app = await readFile(new URL('server/app.ts', root), 'utf8');
const build = await readFile(new URL('scripts/build.mjs', root), 'utf8');
const portrait = await readFile(new URL('web/avatars/hayumeri-kitsune.avif', root));

test('Uploaded user-supplied kitsune is a bundled AVIF with alpha, not an external URL', () => {
  assert.ok(portrait.length > 1000);
  assert.equal(portrait.toString('ascii', 4, 12), 'ftypavif');
  assert.match(html, /id="kitsune-avatar"/);
  assert.match(html, /src="\/avatars\/hayumeri-kitsune\.avif"/);
  assert.match(app, /'\/avatars\/hayumeri-kitsune\.avif': \['avatars\/hayumeri-kitsune\.avif', 'image\/avif'\]/);
  assert.ok(build.includes("'avatars/hayumeri-kitsune.avif'"));
});

test('All avatar and chat controls exist, script parses, and modal is centered', () => {
  assert.doesNotThrow(() => new Function(js));
  for (const id of [
    'kitsune-avatar', 'kitsune-chat', 'kitsune-chat-form', 'kitsune-message',
    'kitsune-chat-header', 'kitsune-settings', 'kitsune-settings-backdrop',
    'kitsune-settings-close', 'kitsune-avatar-size', 'kitsune-avatar-opacity',
    'kitsune-glow', 'kitsune-animations', 'kitsune-chat-font',
    'kitsune-chat-width', 'kitsune-chat-height', 'kitsune-image-upload',
    'kitsune-image-restore', 'kitsune-settings-message'
  ]) assert.ok(html.includes('id="'+id+'"'), 'Missing '+id);
  assert.match(css, /\.kitsune-settings\s*\{[\s\S]*?top:\s*50%/);
  assert.match(css, /transform:\s*translate\(-50%,-50%\)/);
  assert.match(js, /'contextmenu'/);
  assert.match(js, /'pointermove'/);
  assert.match(js, /'\/api\/assistant\/chat'/);
  assert.match(js, /'\/api\/assistant\/avatar'/);
});

test('No external client dependency and no key is copied into the avatar browser settings', () => {
  assert.doesNotMatch(js, /https?:\/\//);
  assert.doesNotMatch(js, /apiKey\s*[:=]/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//);
});
