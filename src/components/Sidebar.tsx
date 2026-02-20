/**
 * Sidebar — collapsible session history panel on the left.
 *
 * Shows active sessions as a scrollable list with drag-to-reorder support.
 * Collapsed state shows only the icon toolbar (50px wide).
 * The settings gear opens a floating SettingsPopup panel.
 *
 * Width is user-resizable via a drag handle on the right edge.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Session } from '../types';
import type { SettingsPageId } from './Chat';
import { useClickFlash } from '../hooks/useClickFlash';
import { useI18n } from '../i18n';
import { SettingsPopup } from './SettingsPopup';
import { IconMenu, IconPlus, IconGear } from './icons';
import '../styles/sidebar.css';

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  sessions: Session[];
  activeSessionId: string;
  onNewSession: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onArchiveSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onReorderSessions: (fromIdx: number, toIdx: number) => void;
  onSelectSettingsPage: (page: SettingsPageId) => void;
  onReauth: () => void;
  onShowReadme: () => void;
}

/**
 * Main sidebar component — session list, toolbar, and settings popup trigger.
 */
export function Sidebar({
  open,
  onToggle,
  sessions,
  activeSessionId,
  onNewSession,
  onSwitchSession,
  onDeleteSession,
  onArchiveSession,
  onRenameSession,
  onReorderSessions,
  onSelectSettingsPage,
  onReauth,
  onShowReadme,
}: SidebarProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setMenuId(null);
      setRenamingId(null);
    }
  }, [open]);

  const openMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setMenuId(menuId === id ? null : id);
  }, [menuId]);

  const startRename = useCallback((session: Session) => {
    setRenamingId(session.id);
    setRenameValue(session.name);
    setMenuId(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRenameSession(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRenameSession]);

  const handleGearClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    setSettingsMenuOpen((v) => !v);
  }, [onFlash]);

  const [sidebarWidth, setSidebarWidth] = useState(300);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const newW = Math.max(200, Math.min(500, r.startW + (e.clientX - r.startX)));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, []);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    if (!open) return;
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: sidebarWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [open, sidebarWidth]);

  useEffect(() => {
    if (open) {
      document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
    } else {
      document.documentElement.style.setProperty('--sidebar-width', '50px');
    }
  }, [open, sidebarWidth]);

  const sessionPointerRef = useRef<{
    fromIdx: number;
    currentIdx: number;
  } | null>(null);
  const [sessionDragIdx, setSessionDragIdx] = useState<number | null>(null);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const d = sessionPointerRef.current;
      if (!d) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      const sessionEl = el.closest<HTMLElement>('[data-session-idx]');
      if (!sessionEl) return;
      const toIdx = parseInt(sessionEl.dataset.sessionIdx ?? '', 10);
      if (isNaN(toIdx) || toIdx === d.currentIdx) return;
      onReorderSessions(d.currentIdx, toIdx);
      d.currentIdx = toIdx;
      setSessionDragIdx(toIdx);
    };
    const handlePointerUp = () => {
      if (!sessionPointerRef.current) return;
      sessionPointerRef.current = null;
      setSessionDragIdx(null);
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onReorderSessions]);

  const handleSessionPointerDown = useCallback((e: React.PointerEvent, sIdx: number) => {
    if (!open || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.sidebar-kebab, .sidebar-menu')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
    sessionPointerRef.current = { fromIdx: sIdx, currentIdx: sIdx };
    setSessionDragIdx(sIdx);
  }, [open]);

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`} style={open ? { width: `${sidebarWidth}px` } : undefined} onClick={(e) => { if (!(e.target as HTMLElement).closest('.sidebar-menu, .sidebar-kebab')) setMenuId(null); }}>
        {open && <div className="sidebar-resize-handle" onPointerDown={handleResizeStart} />}
        <div className="sidebar-toolbar">
          <button
            className="sidebar-toggle-btn"
            onClick={(e) => { onFlash(e); onToggle(); }}
            aria-label={open ? t('ariaCollapseSidebar') : t('ariaExpandSidebar')}
          >
            <IconMenu />
          </button>
          <button
            className="sidebar-new-icon-btn"
            onClick={(e) => { onFlash(e); onNewSession(); }}
            aria-label={t('ariaNewSession')}
          >
            <IconPlus />
          </button>
          <button
            className="sidebar-gear-icon-btn"
            onClick={handleGearClick}
            aria-label={t('ariaSettings')}
          >
            <IconGear />
          </button>
        </div>
        <div className="sidebar-blocks">
          {(['newSession', 'sessions'] as const).map((blockId) => (
            <div
              key={blockId}
              className={`sidebar-block${blockId === 'sessions' ? ' sidebar-block--grow' : ''}`}
            >
              {blockId === 'newSession' && (
                <button className="sidebar-new-btn" onClick={(e) => { onFlash(e); onNewSession(); }}>
                  <IconPlus size={14} />
                  {t('newSession')}
                </button>
              )}
              {blockId === 'sessions' && (
                <>
                  <div className="sidebar-label">{t('sessions')}</div>
                  <div className="sidebar-sessions">
                    {sessions.map((session, sIdx) => (
                      <div
                        key={session.id}
                        data-session-idx={sIdx}
                        className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}${sessionDragIdx === sIdx ? ' is-dragging' : ''}`}
                        onPointerDown={(e) => handleSessionPointerDown(e, sIdx)}
                        onClick={(e) => { if ((e.target as HTMLElement).closest('.sidebar-menu, .sidebar-kebab')) return; if (session.id !== activeSessionId) onSwitchSession(session.id); }}
                      >
                        {renamingId === session.id ? (
                          <input
                            className="sidebar-rename-input"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                        ) : (
                          <span className="sidebar-session-name">{session.name}</span>
                        )}
                        <button
                          className="sidebar-kebab"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); onFlash(e); openMenu(e, session.id); }}
                        >
                          &#x22EE;
                        </button>
                        {menuId === session.id && (
                          <div className="sidebar-menu" onClick={(e) => e.stopPropagation()}>
                            <button className="sidebar-menu-item" onClick={(e) => { e.stopPropagation(); startRename(session); }}>{t('rename')}</button>
                            <button className="sidebar-menu-item" onClick={(e) => { e.stopPropagation(); onArchiveSession(session.id); setMenuId(null); }}>{t('archive')}</button>
                            <button className="sidebar-menu-item danger" onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); setMenuId(null); }}>{t('delete')}</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            className="sidebar-settings-btn"
            onClick={handleGearClick}
          >
            <IconGear />
            {t('settings')}
          </button>
        </div>
      </aside>

      <SettingsPopup
        open={settingsMenuOpen}
        onClose={() => setSettingsMenuOpen(false)}
        onSelectSettingsPage={onSelectSettingsPage}
        onReauth={onReauth}
        onShowReadme={onShowReadme}
      />
    </>
  );
}
