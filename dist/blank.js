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
