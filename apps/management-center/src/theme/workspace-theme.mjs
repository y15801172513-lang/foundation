export const THEME_STORAGE_KEY = 'ai-product-foundation-theme';

const isWorkspaceTheme = (value) => value === 'light' || value === 'dark';

export function readWorkspaceTheme({storage = globalThis.window?.localStorage, matchMedia = globalThis.window?.matchMedia?.bind(globalThis.window)} = {}) {
  try {
    const stored = storage?.getItem?.(THEME_STORAGE_KEY);
    if (isWorkspaceTheme(stored)) return stored;
  } catch {}
  try {
    if (matchMedia?.('(prefers-color-scheme: dark)')?.matches) return 'dark';
  } catch {}
  return 'light';
}

export function applyWorkspaceTheme(theme, {root = globalThis.document?.documentElement, storage = globalThis.window?.localStorage} = {}) {
  const next = isWorkspaceTheme(theme) ? theme : 'light';
  root?.classList.toggle('dark', next === 'dark');
  if (root) {
    root.dataset.theme = next;
    root.style.colorScheme = next;
  }
  try { storage?.setItem?.(THEME_STORAGE_KEY, next); } catch {}
  return next;
}
