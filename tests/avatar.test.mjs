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

test('Studio provides a complete local library with preview, alpha cropping and HiDPI variants',async()=>{
  const studio=await readFile(new URL('web/avatar-studio.js',root),'utf8');
  const legacy=await readFile(new URL('web/index.html',root),'utf8');
  assert.doesNotThrow(()=>new Function(studio));
  assert.match(studio,/indexedDB\.open\('miyuneya-avatar-library'/);
  assert.match(studio,/function bounds\(/);
  assert.match(studio,/getImageData\(/);
  assert.match(studio,/\[192,384,768,1536\]/);
  assert.match(studio,/imageSmoothingQuality='high'/);
  assert.match(studio,/srcset/);
  assert.match(studio,/showPreview\(/);
  assert.match(studio,/crypto\.randomUUID/);
  assert.match(studio,/const erase=/);
  for(const htmlFile of [html,legacy]){
    for(const id of ['kitsune-settings-tabs','kitsune-library-grid','kitsune-framing','kitsune-vertical','kitsune-gold-glow','kitsune-drag-ease','kitsune-minimize','kitsune-expand']) {
      if(id==='kitsune-settings-tabs')assert.match(htmlFile,/class="kitsune-settings-tabs"/);
      else assert.ok(htmlFile.includes('id="'+id+'"'),id);
    }
    assert.ok(htmlFile.includes('/avatar-studio.js'), 'Studio script missing in page');
    assert.ok(htmlFile.includes('/avatar.css'), 'Avatar styles missing in page');
    assert.ok(htmlFile.includes('id="kitsune-avatar"'), 'Avatar missing in page');
  }
});

test('Streaming code formatter uses DOM text nodes instead of untrusted HTML',()=>{
  assert.match(js,/function formatMessage\(/);
  assert.match(js,/document\.createTextNode/);
  assert.match(js,/kitsune-token-keyword/);
  assert.match(js,/kitsune-bubble/);
  assert.doesNotMatch(js,/innerHTML\s*=/);
  assert.match(js,/ResizeObserver/);
  assert.match(js,/classList\.add\('mini'\)/);
  assert.match(js,/classList\.remove\('mini'\)/);
});

test('Avatar icon symbols never shadow the chat element IDs',async()=>{
  for(const page of [html,await readFile(new URL('web/index.html',root),'utf8')]){
    const ids=[...page.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,'No duplicate id allowed');
    assert.equal(ids.filter(id=>id==='kitsune-chat').length,1);
    assert.ok(ids.includes('kitsune-glyph-chat'));
  }
});
