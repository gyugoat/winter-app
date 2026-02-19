/**
 * useTheme — manages app-level light/dark/system theme.
 *
 * Persists the chosen mode to `localStorage`. Resolves "system" by listening
 * to the `prefers-color-scheme` media query, updating automatically when
 * the OS preference changes. Applies the theme by setting the
 * `data-theme` attribute on `document.documentElement`.
 */
import { useState, useEffect, useCallback } from 'react';

/** The three user-selectable theme modes */
export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'winter-theme';

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', resolved);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'dark';
  });

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
    applyTheme(resolveTheme(m));
  }, []);

  useEffect(() => {
    applyTheme(resolveTheme(mode));
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(resolveTheme('system'));
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [mode]);

  return { mode, setMode };
}
