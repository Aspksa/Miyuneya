// Settings for the empty homepage. All choices are validated and persisted by the local API.
(() => {
  'use strict';
  const defaults = {
    theme: 'light', accent: '#7775d7', railWidth: 'regular',
    iconSize: 'regular', railOpacity: 100, font: 'system',
    fontSize: 'regular', radius: 'regular', density: 'comfortable',
    motion: true, background: 'default', scale: 100, contrast: false
  };
  const key = 'miyuneya.home.appearance';
  const page = document.documentElement;
  const toggle = document.getElementById('settings-toggle');
  const dialog = document.getElementById('settings-panel');
  const backdrop = document.getElementById('settings-backdrop');
  const closeButton = document.getElementById('settings-close');
  const resetButton = document.getElementById('appearance-reset');
  const status = document.getElementById('theme-status');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const controls = Array.from(document.querySelectorAll('[data-setting]'));
  const swatches = Array.from(document.querySelectorAll('[data-accent]'));
  const defaultBackground = document.getElementById('default-background');
  const opacityOutput = document.getElementById('opacity-value');
  const systemDark = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  let settings = { ...defaults };
  let changedByUser = false;
  let pendingSave = Promise.resolve();

  function valid(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.keys(defaults).every(k => Object.hasOwn(value, k))
      && Object.keys(value).length === Object.keys(defaults).length
      && ['light', 'dark', 'auto'].includes(value.theme)
      && /^#[0-9a-f]{6}$/i.test(value.accent)
      && ['narrow', 'regular', 'wide'].includes(value.railWidth)
      && ['small', 'regular', 'large'].includes(value.iconSize)
      && Number.isInteger(value.railOpacity) && value.railOpacity >= 75 && value.railOpacity <= 100
      && ['system', 'segoe', 'arial', 'georgia'].includes(value.font)
      && ['small', 'regular', 'large'].includes(value.fontSize)
      && ['small', 'regular', 'large'].includes(value.radius)
      && ['compact', 'comfortable'].includes(value.density)
      && typeof value.motion === 'boolean'
      && (value.background === 'default' || /^#[0-9a-f]{6}$/i.test(value.background))
      && [90, 100, 110, 120].includes(value.scale)
      && typeof value.contrast === 'boolean';
  }

  function updateControls() {
    for (const control of controls) {
      const field = control.dataset.setting;
      const value = settings[field];
      if (control.type === 'radio') control.checked = control.value === value;
      else if (control.type === 'checkbox') control.checked = value;
      else if (field === 'background') control.value = value === 'default' ? (page.dataset.theme === 'dark' ? '#12151b' : '#f8f9fc') : value;
      else control.value = String(value);
      if (field === 'background') control.disabled = value === 'default';
    }
    defaultBackground.checked = settings.background === 'default';
    opacityOutput.textContent = settings.railOpacity + '%';
    for (const button of swatches) button.setAttribute('aria-pressed', String(button.dataset.accent === settings.accent));
  }

  function apply() {
    const effectiveTheme = settings.theme === 'auto' ? (systemDark?.matches ? 'dark' : 'light') : settings.theme;
    page.dataset.theme = effectiveTheme;
    page.dataset.motion = settings.motion ? 'on' : 'off';
    page.dataset.contrast = String(settings.contrast);
    page.style.setProperty('--accent', settings.accent);
    page.style.setProperty('--rail-width', { narrow:'58px', regular:'76px', wide:'96px' }[settings.railWidth]);
    page.style.setProperty('--icon-box', { small:'42px', regular:'50px', large:'58px' }[settings.iconSize]);
    page.style.setProperty('--icon-art', { small:'20px', regular:'25px', large:'29px' }[settings.iconSize]);
    page.style.setProperty('--rail-opacity', settings.railOpacity + '%');
    page.style.setProperty('--ui-font', {
      system:'system-ui, -apple-system, "Segoe UI", sans-serif',
      segoe:'"Segoe UI", sans-serif', arial:'Arial, sans-serif', georgia:'Georgia, serif'
    }[settings.font]);
    page.style.setProperty('--ui-font-size', { small:'13px', regular:'15px', large:'18px' }[settings.fontSize]);
    page.style.setProperty('--ui-radius', { small:'9px', regular:'16px', large:'24px' }[settings.radius]);
    page.style.setProperty('--density-gap', settings.density === 'compact' ? '12px' : '24px');
    page.style.setProperty('--ui-scale', String(settings.scale / 100));
    if (settings.background === 'default') page.style.removeProperty('--custom-page');
    else page.style.setProperty('--custom-page', settings.background);
    if (themeColor) themeColor.setAttribute('content',
      settings.background === 'default' ? (effectiveTheme === 'dark' ? '#12151b' : '#f8f9fc') : settings.background);
    updateControls();
  }

  function showStatus(message, error = false) {
    status.hidden = !message;
    status.textContent = message;
    status.dataset.error = String(error);
  }

  try {
    const cached = window.localStorage.getItem(key);
    if (cached === 'dark' || cached === 'light') settings.theme = cached; // legacy preference
    else if (cached) {
      const data = JSON.parse(cached);
      if (valid(data)) settings = data;
    }
  } catch {
    // Disabled storage must not block this page.
  }
  apply();

  // The server persists preferences independently of the browser port.
  void (async () => {
    try {
      const response = await fetch('/api/site/appearance', { cache:'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      if (!changedByUser && valid(result.appearance)) {
        settings = result.appearance;
        apply();
      }
    } catch { /* Keep the temporary local preference. */ }
  })();

  function persist() {
    changedByUser = true;
    apply();
    const snapshot = { ...settings };
    try { window.localStorage.setItem(key, JSON.stringify(snapshot)); } catch {}
    showStatus('Сохранение оформления…');
    // Serial writes preserve the user's last choice if a previous write is slow.
    pendingSave = pendingSave.catch(() => {}).then(async () => {
      try {
        const response = await fetch('/api/site/appearance', {
          method:'PUT', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ appearance:snapshot })
        });
        if (!response.ok) throw new Error('save failed');
        if (JSON.stringify(snapshot) === JSON.stringify(settings)) showStatus('');
      } catch {
        if (JSON.stringify(snapshot) === JSON.stringify(settings))
          showStatus('Не удалось сохранить оформление. Проверьте доступ к папке проекта.', true);
      }
    });
  }

  function setOpen(open) {
    dialog.hidden = !open;
    backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) closeButton.focus();
    else toggle.focus();
  }
  toggle.addEventListener('click', () => setOpen(dialog.hidden));
  // The avatar's settings link opens this single authoritative Cloud.ru panel.
  // Never put a secret or draft model into a URL.
  try{
    const url=new URL(window.location.href);
    if(url.searchParams.get('settings')==='cloud'){
      setOpen(true);
      requestAnimationFrame(()=>{
        document.getElementById('cloud-panel')?.scrollIntoView({block:'start',behavior:'instant'});
        document.getElementById('cloud-model')?.focus({preventScroll:true});
      });
      url.searchParams.delete('settings');
      window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    }
  }catch{}

  closeButton.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (dialog.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    else if (event.key === 'Tab') {
      if (event.shiftKey && document.activeElement === closeButton) {
        event.preventDefault(); resetButton.focus();
      } else if (!event.shiftKey && document.activeElement === resetButton) {
        event.preventDefault(); closeButton.focus();
      }
    }
  });

  for (const control of controls) control.addEventListener('change', () => {
    if (control.type === 'radio' && !control.checked) return;
    const field = control.dataset.setting;
    settings[field] = control.type === 'checkbox' ? control.checked
      : ['railOpacity','scale'].includes(field) ? Number(control.value) : control.value;
    if (field === 'background') defaultBackground.checked = false;
    persist();
  });
  for (const button of swatches) button.addEventListener('click', () => {
    settings.accent = button.dataset.accent;
    persist();
  });
  defaultBackground.addEventListener('change', () => {
    // The first custom background should match the currently visible theme.
    const selected = controls.find(c => c.dataset.setting === 'background');
    settings.background = defaultBackground.checked ? 'default' : selected.value;
    persist();
  });
  resetButton.addEventListener('click', () => {
    settings = { ...defaults };
    persist();
  });
  systemDark?.addEventListener?.('change', () => {
    if (settings.theme === 'auto') apply();
  });
})();


// Cloud.ru uses the SAME /api/assistant key and model as the existing workspace.
// Never persist a secret in localStorage, HTML, URLs or logs.
(() => {
  'use strict';
  const panel = document.getElementById('cloud-panel');
  if (!panel) return; // Legacy UI tests do not mount the new settings pane.

  const validModelId = {
    test(value) {
      return typeof value === 'string' && value.length > 0 && value.length <= 200
        && [...value].every(char => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:@/-'.includes(char));
    }
  };
  const key = document.getElementById('cloud-key');
  const model = document.getElementById('cloud-model');
  const modelList = document.getElementById('cloud-model-list');
  const form = document.getElementById('cloud-form');
  const state = document.getElementById('cloud-status');
  const stateText = document.getElementById('cloud-state-text');
  const stateInfo = document.getElementById('cloud-status-info');
  const keyHint = document.getElementById('cloud-key-hint');
  const save = document.getElementById('cloud-save');
  const verifyButton = document.getElementById('cloud-verify');
  const testButton = document.getElementById('cloud-test');
  const refresh = document.getElementById('cloud-refresh');
  const remove = document.getElementById('cloud-remove');
  let configured = false, busy = false, savedModel = '', draftEdited = false;
  let requestId = 0;

  function status(code, title, description) {
    state.dataset.state = code;
    stateText.textContent = title;
    stateInfo.textContent = description;
  }
  function setBusy(value) {
    busy = value;
    for (const button of [save, verifyButton, testButton, refresh, remove]) button.disabled = value;
    key.disabled = value;
    model.disabled = value;
  }
  function updateConfig(data) {
    configured = data?.configured === true;
    savedModel = typeof data?.model === 'string' ? data.model : '';
    model.value = savedModel || 'openai/gpt-oss-120b';
    remove.hidden = !configured;
    key.value = ''; // Never echo or persist the original secret in the browser.
    keyHint.textContent = configured
      ? 'Сохранённый ключ: ' + (data.keyHint || '••••') + '. Оставьте поле пустым, чтобы сохранить текущий ключ.'
      : 'Ключ не сохранён. После сохранения он останется только на локальном сервере.';
    status(configured ? 'unchecked' : 'not-configured', configured ? 'Ключ сохранён · не проверено' : 'Не подключено',
      configured ? 'Нажмите «Проверить подключение», чтобы проверить доступ к API и выбранной модели.' : 'Введите API-ключ и сохраните настройки.');
  }
  async function request(path, options) {
    const response = await fetch(path, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Запрос не выполнен.');
    return data;
  }
  async function load() {
    const current = ++requestId;
    try {
      const data = await request('/api/assistant');
      if (current === requestId) {
        if (draftEdited) {
          // The user may type before the initial GET finishes. Read the saved
          // state without destroying their unsaved key or model selection.
          const typedKey = key.value, typedModel = model.value;
          updateConfig(data);
          key.value = typedKey;
          model.value = typedModel;
          status('unchecked', 'Несохранённые изменения', 'Нажмите «Сохранить», чтобы применить введённые данные.');
        } else updateConfig(data);
      }
    } catch {
      if (current === requestId) status('error', 'Ошибка', 'Не удалось прочитать настройки локального сервера.');
    }
  }
  async function loadModels() {
    if (!configured) {
      status('not-configured','Нет сохранённого ключа','Сначала сохраните API-ключ, чтобы запросить модели.');
      return;
    }
    setBusy(true);
    try {
      const data = await request('/api/assistant/models');
      const valid = Array.isArray(data.models) ? data.models.filter(name => typeof name === 'string' && validModelId.test(name)) : [];
      modelList.replaceChildren();
      for (const name of [...new Set(valid)].slice(0, 250)) {
        const option = document.createElement('option');
        option.value = name;
        modelList.append(option);
      }
      status('unchecked', 'Модели загружены', 'Доступно моделей: ' + valid.length + '. Выберите модель и нажмите «Сохранить».');
    } catch {
      status('error', 'Ошибка списка моделей', 'Не удалось загрузить список моделей. Проверьте ключ и интернет.');
    } finally { setBusy(false); }
  }
  async function verify() {
    if (!configured) {
      status('not-configured', 'Не подключено', 'Сначала сохраните API-ключ Cloud.ru.');
      return;
    }
    if (model.value.trim() !== savedModel) {
      status('unchecked', 'Модель не сохранена', 'Сначала сохраните выбранную модель.');
      return;
    }
    setBusy(true);
    status('checking', 'Проверяем Cloud.ru…', 'Выполняется запрос к списку моделей с сохранённым ключом.');
    try {
      const result = await request('/api/assistant/verify', { method: 'POST' });
      if (result.status === 'connected') {
        status('connected', 'Доступ к API подтверждён', result.message || 'Ключ принят и модель доступна в каталоге. Ответ модели ещё не проверялся.');
      } else if (result.status === 'model-unavailable') {
        status('model-unavailable', 'Модель недоступна', result.message || 'Выберите модель из доступного списка.');
      } else if (result.status === 'not-configured') {
        status('not-configured', 'Не подключено', result.message || 'Ключ не сохранён.');
      } else {
        status('error', 'Ошибка подключения', result.message || 'Cloud.ru не подтвердил доступ.');
      }
    } catch {
      status('error', 'Ошибка проверки', 'Не удалось обратиться к локальному серверу. Попробуйте снова.');
    } finally { setBusy(false); }
  }
  async function testGeneration() {
    if (!configured) {
      status('not-configured', 'Не подключено', 'Сначала сохраните API-ключ Cloud.ru.');
      return;
    }
    if (model.value.trim() !== savedModel) {
      status('unchecked', 'Несохранённая модель', 'Сначала сохраните выбранную модель.');
      return;
    }
    setBusy(true);
    status('checking', 'Проверяем ответ модели…', 'Отправлен короткий запрос к Cloud.ru. Он может расходовать платные токены.');
    try {
      const result = await request('/api/assistant/test', { method: 'POST' });
      if (result.status === 'working') {
        status('working', 'Модель отвечает · работает', result.message || 'Подключение проверено реальным запросом.');
      } else if (result.status === 'not-configured') {
        status('not-configured', 'Не подключено', result.message || 'Ключ не сохранён.');
      } else {
        status('error', 'Модель не ответила', result.message || 'Проверьте тип модели и доступ к Cloud.ru.');
      }
    } catch {
      status('error', 'Не удалось проверить модель', 'Не удалось связаться с локальным сервером.');
    } finally { setBusy(false); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const selectedModel = model.value.trim();
    if (!validModelId.test(selectedModel)) {
      status('error', 'Неверная модель', 'Введите корректный идентификатор модели.');
      return;
    }
    const input = { model: selectedModel };
    // Sending an empty password would delete or replace an existing key: never do so.
    if (key.value !== '') input.apiKey = key.value;
    if (!configured && !input.apiKey) {
      status('not-configured', 'Не подключено', 'Введите API-ключ Cloud.ru.');
      return;
    }
    ++requestId; // Prevent a late initial GET from replacing a newly saved key.
    setBusy(true);
    status('checking', 'Сохраняем настройки…', 'Ключ отправляется только на локальный сервер.');
    try {
      const data = await request('/api/assistant', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      updateConfig(data);
      draftEdited = false;
      await verifyAfterSave();
    } catch {
      status('error', 'Не удалось сохранить', 'Проверьте формат ключа и права записи в папку проекта.');
    } finally { setBusy(false); }
  });
  async function verifyAfterSave() {
    // A successful local save alone must not show a green "Connected" indicator.
    status('unchecked', 'Ключ сохранён · проверка не выполнена',
      'Проверить действительность ключа можно кнопкой «Проверить подключение».');
  }
  verifyButton.addEventListener('click', () => { if (!busy) void verify(); });
  testButton.addEventListener('click', () => { if (!busy) void testGeneration(); });
  refresh.addEventListener('click', () => { if (!busy) void loadModels(); });
  model.addEventListener('input', () => {
    draftEdited = true;
    if (!busy && configured) status('unchecked', 'Несохранённый выбор модели', 'Нажмите «Сохранить» перед проверкой.');
  });
  key.addEventListener('input', () => {
    draftEdited = true;
    if (!busy) status('unchecked', 'Несохранённый API-ключ', 'Нажмите «Сохранить». Проверка применяется только к сохранённому ключу.');
  });
  remove.addEventListener('click', async () => {
    if (busy || !configured) return;
    ++requestId;
    setBusy(true);
    try {
      const data = await request('/api/assistant', {
        method: 'PUT', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ apiKey: null })
      });
      modelList.replaceChildren();
      updateConfig(data);
      draftEdited = false;
    } catch {
      status('error', 'Не удалось удалить ключ', 'Проверьте доступ к папке проекта.');
    } finally { setBusy(false); }
  });

  void load();
})();

// Hayumeri brain hub: a local, empty section that opens from the top-right
// animated SVG. Hash routing works without external services or new dependencies.
(() => {
  'use strict';
  const link = document.getElementById('brain-nav-link');
  const hub = document.getElementById('brain-workspace');
  const area = document.getElementById('work-area');
  if (!link || !hub || !area || !window.location || typeof window.addEventListener !== 'function') return;
  let brainStatusVersion=0;
  async function refreshBrainCognitive(){
    const version=++brainStatusVersion;
    const node=document.getElementById('brain-cognitive-stats');
    if(!node)return;
    try{
      const res=await fetch('/api/memory',{cache:'no-store'});
      if(!res.ok)throw Error('Недоступно');
      const data=await res.json();
      if(version!==brainStatusVersion||window.location.hash!=='#brains')return;
      if(!data.enabled){node.textContent='Память выключена. Включите её в настройках рабочего пространства.';return;}
      const c=data.cognitive?.summary;
      node.textContent=c
        ?'Фактов: '+c.active+' · Связей: '+c.associations+' · Требуют проверки: '+(c.inferred+c.contested)
        :'Модуль ещё не загружен в локальном сервере.';
    }catch{
      if(version===brainStatusVersion)node.textContent='Локальный сервер памяти недоступен.';
    }
  }
  function renderBrainLocation() {
    const active = window.location.hash === '#brains';
    hub.hidden = !active;
    link.setAttribute('aria-current', active ? 'page' : 'false');
    area.setAttribute('aria-label', active ? 'Мозги Hayumeri' : 'Главная Miyuneya');
    const home=document.getElementById('miyu-portal-home');if(home)home.setAttribute('aria-current',active?'false':'page');
    document.title = active ? 'Мозги Hayumeri' : '';
    if(active)void refreshBrainCognitive();
  }
  window.addEventListener('hashchange', renderBrainLocation);
  renderBrainLocation();
})();


// GitHub project updates are independent of Cloud.ru, notes and avatar options.
// All downloads and integrity checks happen on the loopback server.
(() => {
  'use strict';
  const field = document.getElementById('project-updates');
  if (!field) return;
  const version = document.getElementById('update-version');
  const status = document.getElementById('update-state');
  const notes = document.getElementById('update-notes');
  const checkButton = document.getElementById('update-check');
  const downloadButton = document.getElementById('update-download');
  const restartButton = document.getElementById('update-restart');
  const checkAuto = document.getElementById('update-auto-check');
  const downloadAuto = document.getElementById('update-auto-download');
  let active = false;
  let current = null;
  const isNewer = (a,b) => {
    if (!a || !b) return false;
    const x=a.split('.').map(Number),y=b.split('.').map(Number);
    for (let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}
    return false;
  };
  function draw(data) {
    current = data;
    version.textContent = 'Текущая версия: ' + data.current +
      (data.available ? ' · GitHub: ' + data.available : '');
    checkAuto.checked = !!data.autoCheck;
    downloadAuto.checked = !!data.autoDownload;
    downloadAuto.disabled = active || !checkAuto.checked;
    notes.textContent = data.notes || 'Описание изменений пока не опубликовано.';
    const newer=isNewer(data.available,data.current);
    downloadButton.hidden = !newer || !!data.pending;
    restartButton.hidden = !data.pending;
    if(data.pending)status.textContent='Пакет '+data.pending+' проверен и подготовлен. Можно устанавливать.';
    else if(data.lastError)status.textContent=data.lastError;
    else if(newer)status.textContent='Доступна новая версия. Просмотрите изменения и подтвердите загрузку.';
    else if(data.noRelease)status.textContent='В репозитории пока нет опубликованного стабильного релиза GitHub.';
    else if(data.checkedAt)status.textContent='Обновлений нет. Последняя проверка: '+new Date(data.checkedAt).toLocaleString('ru-RU');
    else status.textContent='Можно проверить наличие новой версии в GitHub.';
  }
  async function request(method='GET',body) {
    const response=await fetch('/api/updates',{method,headers:body?{'Content-Type':'application/json'}:{},
      body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Сервис обновлений недоступен.');
    return data;
  }
  async function task(action,working) {
    if(active)return;
    active=true;
    for(const button of [checkButton,downloadButton,restartButton])button.disabled=true;
    status.textContent=working;
    try{
      const result=await request('POST',{action});
      if(action==='restart'){
        status.textContent='Перезапуск Miyuneya. Проверяем новую версию…';
        const expected=current?.pending;
        const started=Date.now();
        const poll=async()=>{
          if(Date.now()-started>90_000){status.textContent='Не удалось связаться с перезапущенным сервером. Проверьте окно Miyuneya.bat.';return;}
          try{
            const next=await request();
            if(next.current===expected&&!next.pending){window.location.reload();return;}
            if(next.pending===null&&next.current!==expected){
              status.textContent='Обновление откатилось. Запущена предыдущая версия.';
              draw(next);return;
            }
          }catch{}
          setTimeout(poll,1400);
        };
        setTimeout(poll,1500);
        return;
      }
      draw(result);
    }catch(e){status.textContent=e.message||'Не удалось завершить обновление.';}
    finally{active=false;for(const button of [checkButton,downloadButton,restartButton])button.disabled=false;downloadAuto.disabled=!checkAuto.checked;}
  }
  checkButton.addEventListener('click',()=>void task('check','Проверяем GitHub…'));
  downloadButton.addEventListener('click',()=>void task('download','Скачиваем пакет и сверяем SHA-256…'));
  restartButton.addEventListener('click',()=>{
    if(window.confirm('Установить проверенное обновление? Miyuneya перезапустится, несохранённые изменения в открытых формах могут быть потеряны.'))void task('restart','Готовим перезапуск…');
  });
  async function saveSettings(){
    if(active)return;
    const autoCheck=checkAuto.checked,autoDownload=autoCheck&&downloadAuto.checked;
    if(!autoCheck)downloadAuto.checked=false;
    downloadAuto.disabled=!autoCheck;
    try{draw(await request('PUT',{autoCheck,autoDownload}));}
    catch{status.textContent='Не удалось сохранить параметры обновлений.';}
  }
  checkAuto.addEventListener('change',()=>void saveSettings());
  downloadAuto.addEventListener('change',()=>void saveSettings());
  void request().then(draw).catch(()=>{status.textContent='Не удалось прочитать версию локального проекта.';});
})();
