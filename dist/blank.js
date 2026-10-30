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
      applyTheme(option.value);
      try {
        window.localStorage.setItem(storageKey, option.value);
      } catch {
        // The selected theme remains active for the current page.
      }
    });
  }
})();
