// Minimal UI for the otherwise empty project homepage; no external packages.
(() => {
  'use strict';
  const storageKey = 'miyuneya.home.appearance';
  const page = document.documentElement;
  const toggle = document.getElementById('settings-toggle');
  const dialog = document.getElementById('settings-panel');
  const backdrop = document.getElementById('settings-backdrop');
  const closeButton = document.getElementById('settings-close');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const status = document.getElementById('theme-status');
  const options = Array.from(document.querySelectorAll('input[name="appearance"]'));

  function applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') return;
    page.dataset.theme = theme;
    for (const option of options) option.checked = option.value === theme;
    if (themeColor) themeColor.setAttribute('content', theme === 'dark' ? '#12151b' : '#f8f9fc');
  }

  let saved = 'light';
  try {
    const previous = window.localStorage.getItem(storageKey);
    if (previous === 'dark' || previous === 'light') saved = previous;
  } catch {
    // Storage may be disabled in private browsing; theme still works this session.
  }
  applyTheme(saved);

  // The server is authoritative: the local port may differ at each BAT launch.
  let changedByUser = false;
  let pendingSave = Promise.resolve();
  async function loadServerTheme() {
    try {
      const response = await fetch('/api/site/theme', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (!changedByUser) applyTheme(data.theme);
    } catch {
      // Local storage is a temporary fallback if the settings API is unavailable.
    }
  }
  void loadServerTheme();

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
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') {
      // Keep keyboard focus within this modal settings panel.
      const selected = options.find(option => option.checked) || options[0];
      const first = closeButton;
      const last = selected;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  for (const option of options) {
    option.addEventListener('change', () => {
      if (!option.checked) return;
      changedByUser = true;
      const selected = option.value;
      applyTheme(selected);
      try {
        window.localStorage.setItem(storageKey, selected);
      } catch {
        // Browser storage is optional; the server stores the project preference.
      }
      status.hidden = false;
      status.dataset.error = 'false';
      status.textContent = 'Сохранение оформления…';
      // Serialize saves to prevent an older request overwriting a newer choice.
      pendingSave = pendingSave.catch(() => {}).then(async () => {
        try {
          const response = await fetch('/api/site/theme', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: selected })
          });
          if (!response.ok) throw new Error('Save failed');
          if (page.dataset.theme === selected) status.hidden = true;
        } catch {
          if (page.dataset.theme === selected) {
            status.hidden = false;
            status.dataset.error = 'true';
            status.textContent = 'Тему не удалось сохранить. Проверьте доступ к папке проекта.';
          }
        }
      });
    });
  }
})();
