import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('web/blank.html', root), 'utf8');
const css = await readFile(new URL('web/avatar.css', root), 'utf8');
const layoutCss = await readFile(new URL('web/avatar-layout.css', root), 'utf8');
const js = await readFile(new URL('web/avatar.js', root), 'utf8');
const app = await readFile(new URL('server/app.ts', root), 'utf8');
const build = await readFile(new URL('scripts/build.mjs', root), 'utf8');
const portrait = await readFile(new URL('web/avatars/hayumeri-kitsune.avif', root));
const hires = await readFile(new URL('web/avatars/avatar1.png',root));

test('Full-resolution existing kitsune is displayed, legacy AVIF remains available as fallback', () => {
  assert.ok(portrait.length > 1000);
  assert.equal(portrait.toString('ascii', 4, 12), 'ftypavif');
  assert.match(html, /id="kitsune-avatar"/);
  assert.equal(hires.readUInt32BE(16),1254);
  assert.equal(hires.readUInt32BE(20),1254);
  assert.match(html,/src="\/avatars\/avatar1\.png"/);
  assert.match(html,/width="1254" height="1254"/);
  assert.match(app, /'\/avatars\/hayumeri-kitsune\.avif': \['avatars\/hayumeri-kitsune\.avif', 'image\/avif'\]/);
  assert.ok(build.includes("'avatars/hayumeri-kitsune.avif'"));
});

test('New avatar/chat UX offers size, mobile, dock, full, quiet, preset and one Cloud.ru entrypoint',async()=>{
  const studio=await readFile(new URL('web/avatar-studio.js',root),'utf8');
  assert.match(js,/kitsune-snap/);
  assert.match(js,/kitsune-quiet/);
  assert.match(js,/positionKey\(/);
  assert.match(js,/pointerType==='touch'/);
  assert.match(js,/kitsune-live-preview/);
  assert.match(js,/chatModeSelect/);
  assert.match(js,/mode-dock/);
  assert.match(js,/mode-full/);
  assert.match(js,/\.\/\?settings=cloud|\/?settings=cloud/);
  assert.match(studio,/previewLibraryImage/);
  assert.match(studio,/miyuneya-avatar-effect-preset/);
  assert.match(layoutCss,/mode-dock/);
  assert.match(layoutCss,/mode-full/);
  assert.match(layoutCss,/max-width:72px/);
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


test('One visible avatar is mounted on /workspace and disk drafts use its chat', async () => {
  const legacy = await readFile(new URL('web/index.html', root), 'utf8');
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const compiled = await readFile(new URL('dist/main.js', root), 'utf8');
  for (const page of [html,legacy]) {
    const matches = [...page.matchAll(/id="kitsune-avatar"/g)];
    assert.equal(matches.length, 1, 'Shared avatar must be unique in the markup');
  }
  assert.doesNotMatch(main, /assistant\s*=\s*mountAssistant\s*\(/, 'Legacy assistant must not create duplicate floating widgets');
  assert.doesNotMatch(compiled, /assistant\s*=\s*mountAssistant\s*\(/, 'Built JS must use shared widget');
  assert.match(main, /getElementById\('kitsune-avatar'\)/, 'Keep workspace drafting into new chat');
  assert.match(main, /field\.value=text\.slice\(0,20000\)/);
  assert.match(compiled, /getElementById\('kitsune-chat'\)/);
});

test('All standalone avatar and chat controls carry matching inline SVG glyphs', async () => {
  const legacy = await readFile(new URL('web/index.html', root), 'utf8');
  const controls = [
    'kitsune-avatar-size','kitsune-avatar-opacity','kitsune-framing',
    'kitsune-vertical','kitsune-chat-width','kitsune-chat-height',
    'kitsune-chat-font','kitsune-auto-trim','kitsune-glow',
    'kitsune-animations','kitsune-gold-glow','kitsune-drag-ease'
  ];
  for(const page of [html, legacy]) {
    for(const id of controls) {
      const inputAt = page.indexOf('id="'+id+'"');
      assert.ok(inputAt >= 0,'Missing '+id);
      const labelStart = page.lastIndexOf('<label', inputAt);
      const labelEnd = page.indexOf('</label>', inputAt);
      assert.ok(labelStart >= 0 && labelEnd >= 0, 'Malformed label: '+id);
      const label = page.slice(labelStart,labelEnd);
      assert.match(label, /<svg class="kitsune-ui-icon"/, 'Control has no vector icon: '+id);
      assert.match(label, /href="#kitsune-glyph-[^"]+"/, 'Missing SVG symbol ref: '+id);
    }
    assert.match(page,/id="kitsune-image-restore"[\s\S]*?<svg class="kitsune-ui-icon"/);
    assert.match(page,/id="kitsune-settings-reset"[\s\S]*?<svg class="kitsune-ui-icon"/);
    const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,'Duplicate page IDs');
  }
});

test('The shared-chat bridge in dist/main.js matches TypeScript stripping exactly',async()=>{
  const { stripTypeScriptTypes }=await import('node:module');
  const source=await readFile(new URL('src/main.ts',root),'utf8');
  const built=await readFile(new URL('dist/main.js',root),'utf8');
  let expected='// Generated from src/main.ts by npm run build.\n'+stripTypeScriptTypes(source,{mode:'strip'});
  expected=expected.replace(/[ \t]+$/gm,'');
  expected=expected.replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g,'$1.js$2');
  assert.equal(built,expected,'Regenerate dist/main.js using npm run build; never ship stale JS');
});


test('Audit: distinct HiDPI variants, safe thumbnail cleanup and complete appearance reset',async()=>{
  const studio=await readFile(new URL('web/avatar-studio.js',root),'utf8');
  const script=await readFile(new URL('web/avatar.js',root),'utf8');
  const styles=await readFile(new URL('web/avatar.css',root),'utf8');
  assert.match(studio,/const seenSizes=new Set\(\)/);
  assert.match(studio,/seenSizes\.has\(dimensions\)/);
  assert.match(studio,/const candidates=new Map\(\)/);
  assert.match(studio,/thumbnail\.onerror=releaseThumb/);
  assert.match(studio,/releaseThumbnails\(\)/);
  assert.match(studio,/config=\{\.\.\.defaults\}/);
  assert.match(studio,/kitsune-settings-reset/);
  assert.match(script,/const changedWidth=\/\^\[0-9\]/);
  assert.match(script,/if\(!changedWidth && !changedHeight\)return/);
  assert.match(styles,/max-height:\s*400px/);
  assert.match(styles,/calc\(100dvh - 20px\)/);
});
