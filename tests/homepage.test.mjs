import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/blank.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function mount(stored = new Map(), disableStorage = false, backend = {theme:'light'}) {
  let document;
  const element = (props = {}) => ({
    hidden: false, checked: false, dataset: {}, ...props, attributes: {},
    listeners: new Map(),
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    fire(name, event = {}) { this.listeners.get(name)?.({ preventDefault() {}, ...event }); },
    focus() { document.activeElement = this; }
  });
  const toggle = element(), dialog = element({ hidden:true }), backdrop = element({ hidden:true });
  const close = element(), themeColor = element(), status = element({ hidden:true });
  const light = element({ value:'light', checked:true }), dark = element({ value:'dark' });
  const entries = {
    'settings-toggle': toggle, 'settings-panel': dialog,
    'settings-backdrop': backdrop, 'settings-close': close, 'theme-status': status
  };
  const listeners = new Map();
  document = {
    documentElement: { dataset:{} }, activeElement:null,
    getElementById(id) { return entries[id]; },
    querySelector(query) { return query === 'meta[name="theme-color"]' ? themeColor : null; },
    querySelectorAll(query) { return query === 'input[name="appearance"]' ? [light,dark] : []; },
    addEventListener(name, handler) { listeners.set(name,handler); },
    fire(name,event={}) { listeners.get(name)?.({ preventDefault() {}, ...event }); }
  };
  const window = { localStorage: {
    getItem(key) { if(disableStorage) throw Error('disabled'); return stored.get(key) ?? null; },
    setItem(key,value) { if(disableStorage) throw Error('disabled'); stored.set(key,value); }
  }};
  const fetch = async (path,init={}) => {
    assert.equal(path,'/api/site/theme');
    if (init.method === 'PUT') {
      if (backend.fail) return {ok:false};
      backend.theme = JSON.parse(init.body).theme;
      return {ok:true,json:async()=>({theme:backend.theme})};
    }
    return {ok:true,json:async()=>({theme:backend.theme})};
  };
  runInNewContext(source,{document,window,fetch});
  return { document,toggle,dialog,backdrop,close,light,dark,themeColor,status,stored,backend };
}

test('Settings icon toggles right-hand panel and Escape closes it',async()=>{
  const app = mount();
  await flush();
  assert.equal(app.document.documentElement.dataset.theme,'light');
  assert.equal(app.dialog.hidden,true);
  app.toggle.fire('click');
  assert.equal(app.dialog.hidden,false);
  assert.equal(app.backdrop.hidden,false);
  assert.equal(app.toggle.attributes['aria-expanded'],'true');
  assert.equal(app.document.activeElement,app.close);
  app.document.fire('keydown',{key:'Escape'});
  assert.equal(app.dialog.hidden,true);
  assert.equal(app.document.activeElement,app.toggle);
  app.toggle.fire('click');
  app.backdrop.fire('click');
  assert.equal(app.dialog.hidden,true);
});

test('Theme persists through the server even when the next page uses a different browser origin',async()=>{
  const serverState={theme:'light'};
  const app=mount(new Map(),false,serverState);
  await flush();
  app.dark.checked=true;
  app.dark.fire('change');
  await flush();
  assert.equal(app.document.documentElement.dataset.theme,'dark');
  assert.equal(app.light.checked,false);
  assert.equal(serverState.theme,'dark');
  assert.equal(app.status.hidden,true);
  assert.equal(app.themeColor.attributes.content,'#12151b');
  const reopened=mount(new Map(),false,serverState); // different origin has no cached theme
  await flush();
  assert.equal(reopened.document.documentElement.dataset.theme,'dark');
  assert.equal(reopened.dark.checked,true);
  reopened.light.checked=true;
  reopened.light.fire('change');
  await flush();
  assert.equal(serverState.theme,'light');
});

test('Theme toggle works without localStorage and reports server save failures',async()=>{
  const backend={theme:'light',fail:true};
  const app=mount(new Map(),true,backend);
  await flush();
  app.dark.checked=true;
  app.dark.fire('change');
  await flush();
  assert.equal(app.document.documentElement.dataset.theme,'dark');
  assert.equal(app.dark.checked,true);
  assert.equal(app.status.dataset.error,'true');
  assert.match(app.status.textContent,/не удалось сохранить/);
});
