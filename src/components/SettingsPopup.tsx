/**
 * SettingsPopup — floating menu that opens from the settings gear button.
 *
 * Contains theme selection, token usage display, and navigation links to
 * all full settings pages. Rendered outside <aside> so it stays visible
 * even when the sidebar is collapsed.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { SettingsPageId } from './Chat';
import { useClickFlash } from '../hooks/useClickFlash';
import { useTheme, type ThemeMode } from '../hooks/useTheme';
import { useI18n } from '../i18n';
import {
  IconPersonalize,
  IconToken,
  IconShortcuts,
  IconTheme,
  IconLanguage,
  IconArchive,
  IconOllama,
  IconHowToUse,
  IconFeedback,
  IconCheck,
  IconChevronRight,
} from './icons';

interface ClaudeUsageLimit {
  utilization: number | null;
  resets_at: string | null;
}

interface ClaudeUsage {
  five_hour: ClaudeUsageLimit | null;
  seven_day: ClaudeUsageLimit | null;
  seven_day_opus: ClaudeUsageLimit | null;
}

interface SettingsPopupProps {
  open: boolean;
  onClose: () => void;
  onSelectSettingsPage: (page: SettingsPageId) => void;
  onReauth: () => void;
  onShowReadme: () => void;
}

const THEME_OPTIONS: { value: ThemeMode; labelKey: 'themeDay' | 'themeNight' | 'themeSystem' }[] = [
  { value: 'light', labelKey: 'themeDay' },
  { value: 'dark', labelKey: 'themeNight' },
  { value: 'system', labelKey: 'themeSystem' },
];

type SubPopup = 'theme' | 'token' | null;

/**
 * Floating settings menu panel with sub-popups for theme and token usage.
 * Closed on click-outside or Escape key.
 */
export function SettingsPopup({ open, onClose, onSelectSettingsPage, onReauth, onShowReadme }: SettingsPopupProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();
  const [subPopup, setSubPopup] = useState<SubPopup>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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
      setSubPopup(null);
      return;
    }
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.sidebar-gear-icon-btn, .sidebar-settings-btn')) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const handleSubPage = useCallback((page: SettingsPageId) => {
    onClose();
    onSelectSettingsPage(page);
  }, [onClose, onSelectSettingsPage]);

  if (!open) return null;

  return (
    <div ref={menuRef}>
      <div className="settings-popup" role="menu" aria-label={t('ariaSettingsMenu')}>
        <button
          className="settings-popup-item"
          onClick={(e) => { onFlash(e); handleSubPage('personalize'); }}
          role="menuitem"
        >
          <span className="settings-popup-icon"><IconPersonalize /></span>
          <span className="settings-popup-label">{t('personalize')}</span>
          <span className="settings-popup-chevron"><IconChevronRight /></span>
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
            <span className="settings-popup-icon"><IconToken /></span>
            <span className="settings-popup-label">{t('token')}</span>
            <span className="settings-popup-arrow"><IconChevronRight strokeWidth={2.5} /></span>
          </button>
          {subPopup === 'token' && (
            <div className="settings-sub-popup" role="menu" aria-label={t('ariaToken')}>
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
                  <div className="settings-sub-popup-item" role="menuitem">
                    <span>{t('tokenSession')}</span>
                    <span className="settings-sub-popup-stat">
                      {claudeUsage.five_hour?.utilization != null ? `${Math.round(claudeUsage.five_hour.utilization)}%` : '—'}
                    </span>
                  </div>
                  <div className="settings-sub-popup-item" role="menuitem">
                    <span>{t('tokenWeekly')}</span>
                    <span className="settings-sub-popup-stat">
                      {claudeUsage.seven_day?.utilization != null ? `${Math.round(claudeUsage.seven_day.utilization)}%` : '—'}
                    </span>
                  </div>
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
                  onClose();
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
          <span className="settings-popup-icon"><IconShortcuts /></span>
          <span className="settings-popup-label">{t('shortcuts')}</span>
          <span className="settings-popup-chevron"><IconChevronRight /></span>
        </button>

        <div className="settings-popup-item-wrap">
          <button
            className={`settings-popup-item${subPopup === 'theme' ? ' active' : ''}`}
            onClick={(e) => { onFlash(e); setSubPopup(subPopup === 'theme' ? null : 'theme'); }}
            role="menuitem"
          >
            <span className="settings-popup-icon"><IconTheme /></span>
            <span className="settings-popup-label">{t('theme')}</span>
            <span className="settings-popup-arrow"><IconChevronRight strokeWidth={2.5} /></span>
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
                    <span className="settings-sub-popup-check"><IconCheck /></span>
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
          <span className="settings-popup-icon"><IconLanguage /></span>
          <span className="settings-popup-label">{t('language')}</span>
          <span className="settings-popup-chevron"><IconChevronRight /></span>
        </button>

        <button
          className="settings-popup-item"
          onClick={(e) => { onFlash(e); handleSubPage('archive'); }}
          role="menuitem"
        >
          <span className="settings-popup-icon"><IconArchive /></span>
          <span className="settings-popup-label">{t('archive')}</span>
          <span className="settings-popup-chevron"><IconChevronRight /></span>
        </button>

        <button
          className="settings-popup-item"
          onClick={(e) => { onFlash(e); handleSubPage('ollama'); }}
          role="menuitem"
        >
          <span className="settings-popup-icon"><IconOllama /></span>
          <span className="settings-popup-label">{t('ollamaTitle')}</span>
          <span className="settings-popup-chevron"><IconChevronRight /></span>
        </button>

        <button
          className="settings-popup-item"
          onClick={(e) => {
            onFlash(e);
            onClose();
            onShowReadme();
          }}
          role="menuitem"
        >
          <span className="settings-popup-icon"><IconHowToUse /></span>
          <span className="settings-popup-label">{t('howToUse')}</span>
          <span className="settings-popup-chevron"><IconChevronRight /></span>
        </button>

        <button
          className="settings-popup-item"
          onClick={(e) => { onFlash(e); handleSubPage('feedback'); }}
          role="menuitem"
        >
          <span className="settings-popup-icon"><IconFeedback /></span>
          <span className="settings-popup-label">{t('sendFeedback')}</span>
          <span className="settings-popup-chevron"><IconChevronRight /></span>
        </button>
      </div>
    </div>
  );
}
