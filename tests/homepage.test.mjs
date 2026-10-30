import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/blank.js', import.meta.url), 'utf8');
function mount(stored = new Map(), disableStorage = false) {
  let document;
  const element = (props = {}) => ({
    hidden: false,
    checked: false,
    ...props,
    attributes: {},
    listeners: new Map(),
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    fire(name, event = {}) { this.listeners.get(name)?.({ preventDefault() {}, ...event }); },
    focus() { document.activeElement = this; }
  });
  const toggle = element();
  const dialog = element({ hidden: true });
  const backdrop = element({ hidden: true });
  const close = element();
  const themeColor = element();
  const light = element({ value: 'light', checked: true });
  const dark = element({ value: 'dark' });
  const entries = {
    'settings-toggle': toggle,
    'settings-panel': dialog,
    'settings-backdrop': backdrop,
    'settings-close': close
  };
  const listeners = new Map();
  document = {
    documentElement: { dataset: {} },
    activeElement: null,
    getElementById(id) { return entries[id]; },
    querySelector(query) { return query === 'meta[name="theme-color"]' ? themeColor : null; },
    querySelectorAll(query) { return query === 'input[name="appearance"]' ? [light, dark] : []; },
    addEventListener(name, handler) { listeners.set(name, handler); },
    fire(name, event = {}) { listeners.get(name)?.({ preventDefault() {}, ...event }); }
  };
  const window = {
    localStorage: {
      getItem(key) { if (disableStorage) throw Error('disabled'); return stored.get(key) ?? null; },
      setItem(key, value) { if (disableStorage) throw Error('disabled'); stored.set(key, value); }
    }
  };
  runInNewContext(source, { document, window });
  return { document, toggle, dialog, backdrop, close, light, dark, themeColor, stored };
}

test('Settings icon toggles right-hand panel and Escape closes it', () => {
  const app = mount();
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  assert.equal(app.dialog.hidden, true);
  app.toggle.fire('click');
  assert.equal(app.dialog.hidden, false);
  assert.equal(app.backdrop.hidden, false);
  assert.equal(app.toggle.attributes['aria-expanded'], 'true');
  assert.equal(app.document.activeElement, app.close);
  app.document.fire('keydown', { key: 'Escape' });
  assert.equal(app.dialog.hidden, true);
  assert.equal(app.document.activeElement, app.toggle);
  app.toggle.fire('click');
  app.backdrop.fire('click');
  assert.equal(app.dialog.hidden, true);
});

test('Light/dark theme can be saved and restored on the next page load', () => {
  const stored = new Map();
  const app = mount(stored);
  app.dark.checked = true;
  app.dark.fire('change');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.light.checked, false);
  assert.equal(stored.get('miyuneya.home.appearance'), 'dark');
  assert.equal(app.themeColor.attributes.content, '#12151b');
  const reopened = mount(stored);
  assert.equal(reopened.document.documentElement.dataset.theme, 'dark');
  assert.equal(reopened.dark.checked, true);
  reopened.light.checked = true;
  reopened.light.fire('change');
  assert.equal(stored.get('miyuneya.home.appearance'), 'light');
});

test('Theme toggle still works when browser storage is unavailable', () => {
  const app = mount(new Map(), true);
  app.dark.checked = true;
  app.dark.fire('change');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.dark.checked, true);
});
