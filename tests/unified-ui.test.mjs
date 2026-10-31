import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [home,workspace,client,css,shared,experience,state,attachments,build,server,updater,avatar]=
  await Promise.all([
    'web/blank.html','web/index.html','src/main.ts','web/blank.css',
    'web/unified-ui.css','web/avatar-experience.css','web/avatar-state.js',
    'web/chat-attachments.js','scripts/build.mjs','server/app.ts',
    'scripts/update.mjs','web/avatar.js'
  ].map(read));
test('Unified pages expose navigation and identical token stylesheet',async()=>{
  assert.match(home,/class="miyu-portal-nav"/);
  assert.match(home,/href="\/workspace#notes"/);
  assert.match(home,/href="\/workspace#disk"/);
  assert.match(client,/href="\/#brains"/);
  assert.match(client,/href="\/"/);
  assert.match(client,/data-collapse-nav/);
  assert.match(client,/sidebarCollapsed/);
  const workbench=await read('src/workbench.ts');
  assert.match(workbench,/Miyuneya\.workbench\./);
  assert.match(workbench,/legacyKey/);
  assert.match(workbench,/toggleSidebar/);
  assert.match(shared,/miyu-nav-compact/);
  assert.match(shared,/max-width:620px/);
  for(const file of [home,workspace]){
    assert.match(file,/\/unified-ui\.css/);
    assert.match(file,/\/avatar-experience\.css/);
    assert.match(file,/\/avatar-state\.js/);
    assert.match(file,/\/chat-attachments\.js/);
  }
  assert.match(css,/--page:/);
});
test('All new assets are allowed by offline build, HTTP server and safe updater',()=>{
  for(const path of ['unified-ui.css','avatar-experience.css','chat-attachments.js','avatar-state.js']){
    assert.ok(build.includes("'"+path+"'"),'Build must package '+path);
    assert.ok(server.includes("'/"+path+"'"),'Server must serve '+path);
  }
  for(const expression of ['unified-ui','avatar-experience','avatar-state','chat-attachments'])
    assert.ok(updater.includes(expression),'Update allowlist must cover '+expression);
});
test('Attachment composer is browser-local and never posts bytes directly to Cloud.ru',()=>{
  assert.doesNotThrow(()=>new Function(attachments));
  assert.match(attachments,/MAX_BYTES=15_000_000/);
  assert.match(attachments,/MAX_FILES=4/);
  assert.match(attachments,/X-Message-Id/);
  assert.match(attachments,/X-File-Name/);
  assert.match(attachments,/include\.checked/);
  assert.match(attachments,/file\.size>MAX_TEXT_BYTES/);
  assert.doesNotMatch(attachments,/https?:\/\//);
  assert.match(avatar,/attachments\.prepare\(raw\)/);
  assert.match(avatar,/attachments\.upload\(conversation\.id,user\.id,current\.signal\)/);
  assert.match(server,/saveAttachment\(/);
});
test('Avatar state machine is separated and bounds animations and collisions',()=>{
  assert.doesNotThrow(()=>new Function(state));
  assert.match(state,/avatar\.dataset\.activity/);
  assert.match(state,/window\.addEventListener\('offline'/);
  assert.match(state,/visibilitychange/);
  assert.match(state,/saveData/);
  assert.match(state,/avoidAvatar/);
  assert.match(avatar,/presence\.avoidAvatar/);
  assert.match(avatar,/presence\?\.remember/);
  assert.match(avatar,/recoveryButton/);
  assert.match(avatar,/last\.complete!==false/);
  assert.match(experience,/prefers-reduced-motion/);
  assert.match(experience,/data-activity="answering"/);
});
