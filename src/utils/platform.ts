/**
 * Platform detection — determines whether we're running in Tauri or a web browser.
 *
 * Tauri injects `window.__TAURI_INTERNALS__` at startup. If it's missing,
 * we're in a plain browser context and must use HTTP fetch instead of IPC.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

/**
 * Base URL for API calls in web mode.
 * In web mode the proxy serves both static files and proxies API calls,
 * so we use the current origin (same host:port).
 */
export const API_BASE = '';

/**
 * The workspace directory to include in API requests.
 * In web mode we fetch this from /api/config; falls back to '.'.
 */
let _directory = '.';
let _directoryLoaded = false;

export function getDirectory(): string {
  return _directory;
}

export async function loadDirectory(): Promise<string> {
  if (_directoryLoaded) return _directory;
  try {
    const resp = await fetch('/api/config');
    if (resp.ok) {
      const cfg = await resp.json();
      _directory = cfg.winter?.workspace || '.';
    }
  } catch {
    // best-effort
  }
  _directoryLoaded = true;
  return _directory;
}
