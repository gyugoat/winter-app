import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Session } from '../types';
import type { SettingsPageId } from './Chat';
import { useClickFlash } from '../hooks/useClickFlash';
import { useTheme, type ThemeMode } from '../hooks/useTheme';
import { useI18n } from '../i18n';
import '../styles/sidebar.css';

interface ClaudeUsageLimit {
  utilization: number | null;
  resets_at: string | null;
}

interface ClaudeUsage {
  five_hour: ClaudeUsageLimit | null;
  seven_day: ClaudeUsageLimit | null;
  seven_day_opus: ClaudeUsageLimit | null;
}

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
  onSelectSettingsPage: (page: SettingsPageId) => void;
  onReauth: () => void;
  onShowReadme: () => void;
  usage: { input: number; output: number };
  weeklyUsage: { input: number; output: number };
}

/* ── SVG Icons for settings menu ─────────────────── */

const MENU_ICONS = {
  theme: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  shortcuts: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="6" y1="8" x2="6" y2="8.01" />
      <line x1="10" y1="8" x2="10" y2="8.01" />
      <line x1="14" y1="8" x2="14" y2="8.01" />
      <line x1="18" y1="8" x2="18" y2="8.01" />
      <line x1="6" y1="12" x2="6" y2="12.01" />
      <line x1="18" y1="12" x2="18" y2="12.01" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </svg>
  ),
  token: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  language: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  feedback: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  archive: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  personalize: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  ollama: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <circle cx="15" cy="10" r="1.5" />
      <path d="M9 15h6" />
    </svg>
  ),
  howToUse: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
};

const THEME_OPTIONS: { value: ThemeMode; labelKey: 'themeDay' | 'themeNight' | 'themeSystem' }[] = [
  { value: 'light', labelKey: 'themeDay' },
  { value: 'dark', labelKey: 'themeNight' },
  { value: 'system', labelKey: 'themeSystem' },
];

type SubPopup = 'theme' | 'token' | null;

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
  onSelectSettingsPage,
  onReauth,
  onShowReadme,
  usage,
  weeklyUsage,
}: SidebarProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [subPopup, setSubPopup] = useState<SubPopup>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const { mode, setMode } = useTheme();
  const [claudeUsage, setClaudeUsage] = useState<ClaudeUsage | null>(null);
  const [claudeUsageLoading, setClaudeUsageLoading] = useState(false);
  const [claudeUsageError, setClaudeUsageError] = useState(false);
  const [sessionKeyInput, setSessionKeyInput] = useState('');
  const [sessionKeySaved, setSessionKeySaved] = useState(false);

  const fetchClaudeUsage = useCallback(async () => {
    setClaudeUsageLoading(true);
    setClaudeUsageError(false);
    try {
      const data = await invoke<ClaudeUsage>('fetch_claude_usage');
      setClaudeUsage(data);
    } catch {
      setClaudeUsageError(true);
    }
    setClaudeUsageLoading(false);
  }, []);

  const saveSessionKey = useCallback(async () => {
    if (!sessionKeyInput.trim()) return;
    try {
      await invoke('set_session_key', { key: sessionKeyInput.trim() });
      setSessionKeySaved(true);
      setSessionKeyInput('');
      setTimeout(() => setSessionKeySaved(false), 2000);
      fetchClaudeUsage();
    } catch {
      // silent
    }
  }, [sessionKeyInput, fetchClaudeUsage]);

  useEffect(() => {
    if (!open) {
      setMenuId(null);
      setRenamingId(null);
      setSettingsMenuOpen(false);
      setSubPopup(null);
    }
  }, [open]);

  /* Close settings popup on outside click */
  useEffect(() => {
    if (!settingsMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setSettingsMenuOpen(false);
        setSubPopup(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [settingsMenuOpen]);

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

  const SIDEBAR_TRANSITION_MS = 260;

  const handleGearClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    if (!open) {
      onToggle();
      setTimeout(() => {
        setSettingsMenuOpen(true);
        setSubPopup(null);
      }, SIDEBAR_TRANSITION_MS);
    } else {
      setSettingsMenuOpen((v) => !v);
      setSubPopup(null);
    }
  }, [onFlash, open, onToggle]);

  const handleSubPage = useCallback((page: SettingsPageId) => {
    setSettingsMenuOpen(false);
    setSubPopup(null);
    onSelectSettingsPage(page);
  }, [onSelectSettingsPage]);

  return (
    <>
       <aside className={`sidebar${open ? ' open' : ''}`} onClick={() => setMenuId(null)}>
        <div className="sidebar-toolbar">
          <button
            className="sidebar-toggle-btn"
            onClick={(e) => { onFlash(e); onToggle(); }}
            aria-label={open ? t('ariaCollapseSidebar') : t('ariaExpandSidebar')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <button
            className="sidebar-new-icon-btn"
            onClick={(e) => { onFlash(e); onNewSession(); }}
            aria-label={t('ariaNewSession')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            className="sidebar-gear-icon-btn"
            onClick={handleGearClick}
            aria-label={t('ariaSettings')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
        <button
          className="sidebar-new-btn"
          onClick={(e) => { onFlash(e); onNewSession(); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t('newSession')}
        </button>

        <div className="sidebar-label">{t('sessions')}</div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`}
              onClick={() => { onSwitchSession(session.id); }}
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
                onClick={(e) => { onFlash(e); openMenu(e, session.id); }}
              >
                &#x22EE;
              </button>
              {menuId === session.id && (
                <div className="sidebar-menu" onClick={(e) => e.stopPropagation()}>
                  <button className="sidebar-menu-item" onClick={() => startRename(session)}>
                    {t('rename')}
                  </button>
                  <button className="sidebar-menu-item" onClick={() => { onArchiveSession(session.id); setMenuId(null); }}>
                    {t('archive')}
                  </button>
                  <button className="sidebar-menu-item danger" onClick={() => { onDeleteSession(session.id); setMenuId(null); }}>
                    {t('delete')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-footer" ref={settingsMenuRef}>
          {/* Settings Popup Menu (Tier 1) */}
          {settingsMenuOpen && (
            <div className="settings-popup" role="menu" aria-label={t('ariaSettingsMenu')}>
              <button
                className="settings-popup-item"
                onClick={(e) => { onFlash(e); handleSubPage('personalize'); }}
                role="menuitem"
              >
                <span className="settings-popup-icon">{MENU_ICONS.personalize}</span>
                <span className="settings-popup-label">{t('personalize')}</span>
                <span className="settings-popup-chevron">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>

              <div className="settings-popup-item-wrap">
                <button
                  className={`settings-popup-item${subPopup === 'token' ? ' active' : ''}`}
                  onClick={(e) => {
                    onFlash(e);
                    const next = subPopup === 'token' ? null : 'token';
                    setSubPopup(next);
                    if (next === 'token') fetchClaudeUsage();
                  }}
                  role="menuitem"
                >
                  <span className="settings-popup-icon">{MENU_ICONS.token}</span>
                  <span className="settings-popup-label">{t('token')}</span>
                  <span className="settings-popup-arrow">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                </button>
                {subPopup === 'token' && (
                  <div className="settings-sub-popup" role="menu" aria-label={t('ariaToken')}>
                    <div className="settings-sub-popup-item" role="menuitem">
                      <span>{t('tokenSession')}</span>
                      <span className="settings-sub-popup-stat">{(usage.input + usage.output).toLocaleString()}</span>
                    </div>
                    <div className="settings-sub-popup-item" role="menuitem">
                      <span>{t('tokenWeekly')}</span>
                      <span className="settings-sub-popup-stat">{(weeklyUsage.input + weeklyUsage.output).toLocaleString()}</span>
                    </div>
                    <div className="settings-sub-popup-divider" />
                    {claudeUsageLoading ? (
                      <div className="settings-sub-popup-item" role="menuitem">
                        <span>{t('tokenUsageLoading')}</span>
                      </div>
                    ) : claudeUsageError ? (
                      <div className="settings-sub-popup-item" role="menuitem">
                        <span>{t('tokenUsageError')}</span>
                        <button className="settings-sub-popup-refresh" onClick={fetchClaudeUsage}>↻</button>
                      </div>
                    ) : claudeUsage ? (
                      <>
                        {claudeUsage.five_hour && (
                          <div className="settings-sub-popup-item" role="menuitem">
                            <span>{t('tokenUsage5h')}</span>
                            <span className="settings-sub-popup-stat">
                              {claudeUsage.five_hour.utilization != null ? `${Math.round(claudeUsage.five_hour.utilization * 100)}%` : t('tokenUsageNone')}
                            </span>
                          </div>
                        )}
                        {claudeUsage.seven_day && (
                          <div className="settings-sub-popup-item" role="menuitem">
                            <span>{t('tokenUsage7d')}</span>
                            <span className="settings-sub-popup-stat">
                              {claudeUsage.seven_day.utilization != null ? `${Math.round(claudeUsage.seven_day.utilization * 100)}%` : t('tokenUsageNone')}
                            </span>
                          </div>
                        )}
                        {claudeUsage.seven_day_opus && (
                          <div className="settings-sub-popup-item" role="menuitem">
                            <span>{t('tokenUsageOpus')}</span>
                            <span className="settings-sub-popup-stat">
                              {claudeUsage.seven_day_opus.utilization != null ? `${Math.round(claudeUsage.seven_day_opus.utilization * 100)}%` : t('tokenUsageNone')}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="settings-sub-popup-item" role="menuitem">
                        <span>{t('tokenUsageNone')}</span>
                      </div>
                    )}
                    <div className="settings-sub-popup-divider" />
                    <div className="settings-sub-popup-key-row">
                      <input
                        className="settings-sub-popup-key-input"
                        type="password"
                        placeholder={t('tokenSessionKeyPlaceholder')}
                        value={sessionKeyInput}
                        onChange={(e) => setSessionKeyInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveSessionKey(); }}
                      />
                      <button className="settings-sub-popup-key-btn" onClick={saveSessionKey}>
                        {sessionKeySaved ? t('tokenSessionKeySaved') : t('tokenSessionKeySave')}
                      </button>
                    </div>
                    <button
                      className="settings-sub-popup-item settings-sub-popup-auth"
                      onClick={(e) => {
                        onFlash(e);
                        setSettingsMenuOpen(false);
                        setSubPopup(null);
                        onReauth();
                      }}
                      role="menuitem"
                    >
                      <span>{t('tokenAuth')}</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                className="settings-popup-item"
                onClick={(e) => { onFlash(e); handleSubPage('shortcuts'); }}
                role="menuitem"
              >
                <span className="settings-popup-icon">{MENU_ICONS.shortcuts}</span>
                <span className="settings-popup-label">{t('shortcuts')}</span>
                <span className="settings-popup-chevron">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>

              <div className="settings-popup-item-wrap">
                <button
                  className={`settings-popup-item${subPopup === 'theme' ? ' active' : ''}`}
                  onClick={(e) => { onFlash(e); setSubPopup(subPopup === 'theme' ? null : 'theme'); }}
                  role="menuitem"
                >
                  <span className="settings-popup-icon">{MENU_ICONS.theme}</span>
                  <span className="settings-popup-label">{t('theme')}</span>
                  <span className="settings-popup-arrow">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                </button>
                {subPopup === 'theme' && (
                  <div className="settings-sub-popup" role="menu" aria-label={t('ariaThemeOptions')}>
                    {THEME_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={`settings-sub-popup-item${mode === opt.value ? ' active' : ''}`}
                        onClick={(e) => { onFlash(e); setMode(opt.value); }}
                        role="menuitemradio"
                        aria-checked={mode === opt.value}
                      >
                        <span>{t(opt.labelKey)}</span>
                        {mode === opt.value && (
                          <span className="settings-sub-popup-check">{MENU_ICONS.check}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="settings-popup-item"
                onClick={(e) => { onFlash(e); handleSubPage('language'); }}
                role="menuitem"
              >
                <span className="settings-popup-icon">{MENU_ICONS.language}</span>
                <span className="settings-popup-label">{t('language')}</span>
                <span className="settings-popup-chevron">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>

              <button
                className="settings-popup-item"
                onClick={(e) => { onFlash(e); handleSubPage('archive'); }}
                role="menuitem"
              >
                <span className="settings-popup-icon">{MENU_ICONS.archive}</span>
                <span className="settings-popup-label">{t('archive')}</span>
                <span className="settings-popup-chevron">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>

              <button
                className="settings-popup-item"
                onClick={(e) => { onFlash(e); handleSubPage('ollama'); }}
                role="menuitem"
              >
                <span className="settings-popup-icon">{MENU_ICONS.ollama}</span>
                <span className="settings-popup-label">{t('ollamaTitle')}</span>
                <span className="settings-popup-chevron">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>

              <button
                className="settings-popup-item"
                onClick={(e) => {
                  onFlash(e);
                  setSettingsMenuOpen(false);
                  setSubPopup(null);
                  onShowReadme();
                }}
                role="menuitem"
              >
                <span className="settings-popup-icon">{MENU_ICONS.howToUse}</span>
                <span className="settings-popup-label">{t('howToUse')}</span>
                <span className="settings-popup-chevron">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>

              <button
                className="settings-popup-item"
                onClick={(e) => { onFlash(e); handleSubPage('feedback'); }}
                role="menuitem"
              >
                <span className="settings-popup-icon">{MENU_ICONS.feedback}</span>
                <span className="settings-popup-label">{t('sendFeedback')}</span>
                <span className="settings-popup-chevron">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>
            </div>
          )}

          <button
            className="sidebar-settings-btn"
            onClick={handleGearClick}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {t('settings')}
          </button>
        </div>
      </aside>
    </>
  );
}
