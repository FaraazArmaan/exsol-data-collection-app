// Theme toggle: manual override wins over OS preference, persists in
// localStorage. The pre-paint inline <script> in each page's <head>
// applies the saved value to <html data-theme=...> before first paint
// to avoid flash-of-wrong-theme. This module wires the toggle button.

const KEY = 'exsol-theme';

export function readTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return null;
}

export function setTheme(value) {
  const root = document.documentElement;
  if (value === 'light' || value === 'dark') {
    root.setAttribute('data-theme', value);
    try { localStorage.setItem(KEY, value); } catch {}
  } else {
    root.removeAttribute('data-theme');
    try { localStorage.removeItem(KEY); } catch {}
  }
}

export function effectiveTheme() {
  const manual = readTheme();
  if (manual) return manual;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

// Wire a button so clicking it toggles between light/dark.
// The button's text content is updated to the icon for the OPPOSITE
// theme (so users see what they'll switch TO).
export function wireToggle(button) {
  if (!button) return;
  const sync = () => {
    const t = effectiveTheme();
    button.textContent = t === 'dark' ? '☀' : '☾';
    button.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    button.setAttribute('aria-label', button.title);
  };
  sync();
  button.addEventListener('click', () => {
    setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
    sync();
  });
}

// Auto-wire any element with id="theme-toggle" on import. Module scripts
// run after DOM parse, so the button is guaranteed to exist if it's in
// the markup. Pages that need custom behavior can call wireToggle directly.
wireToggle(document.getElementById('theme-toggle'));
