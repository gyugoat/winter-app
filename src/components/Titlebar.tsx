/**
 * Titlebar — custom native-feeling window chrome.
 *
 * Renders the draggable title bar with minimize / maximize / close controls.
 * Handles window state animations (minimize slide-out, maximize scale)
 * by toggling CSS classes on the root element before calling the native API.
 */
import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window';
import { useClickFlash } from '../hooks/useClickFlash';
import { Diamond } from './Diamond';
import '../styles/titlebar.css';

/** Returns the Tauri window handle, or null when running outside Tauri (e.g. browser dev) */
function getTauriWindow(): TauriWindow | null {
  try { return getCurrentWindow(); } catch { return null; }
}

export function Titlebar() {
  const appWindow = getTauriWindow();
  const onFlash = useClickFlash();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;
    const unlistenResize = appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    });
    const unlistenFocus = appWindow.onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      const root = document.getElementById('root');
      if (!root || !root.dataset.wasMinimized) return;
      delete root.dataset.wasMinimized;
      root.classList.remove('win-minimize');
      root.classList.add('win-restore');
      setTimeout(() => root.classList.remove('win-restore'), 300);
    });
    return () => {
      unlistenResize.then((fn) => fn());
      unlistenFocus.then((fn) => fn());
    };
  }, [appWindow]);

  const handleMinimize = useCallback(async () => {
    if (!appWindow) return;
    const root = document.getElementById('root');
    if (!root) { await appWindow.minimize(); return; }
    root.classList.add('win-minimize');
    root.dataset.wasMinimized = '1';
    await new Promise((r) => setTimeout(r, 250));
    await appWindow.minimize();
  }, [appWindow]);

  const handleMaximize = useCallback(async () => {
    if (!appWindow) return;
    const root = document.getElementById('root');
    if (!root) { await appWindow.toggleMaximize(); return; }
    root.classList.add('win-maximize-out');
    await new Promise((r) => setTimeout(r, 150));
    await appWindow.toggleMaximize();
    root.classList.remove('win-maximize-out');
    root.classList.add('win-maximize-in');
    setTimeout(() => root.classList.remove('win-maximize-in'), 300);
  }, [appWindow]);

  return (
    <div className="titlebar">
      <Diamond size={12} className="titlebar-diamond" />
      <div className="titlebar-drag" data-tauri-drag-region />

      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={(e) => { onFlash(e); handleMinimize(); }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="2" y1="6" x2="10" y2="6" />
          </svg>
        </button>
        <button className="titlebar-btn" onClick={(e) => { onFlash(e); handleMaximize(); }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            {isMaximized ? (
              <>
                <rect x="3" y="1" width="7" height="7" rx="1" fill="none" />
                <rect x="1" y="3" width="7" height="7" rx="1" fill="none" />
              </>
            ) : (
              <rect x="2" y="2" width="8" height="8" rx="1" />
            )}
          </svg>
        </button>
        <button className="titlebar-btn close" onClick={(e) => { onFlash(e); appWindow?.close(); }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="2" y1="2" x2="10" y2="10" />
            <line x1="10" y1="2" x2="2" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
