import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import type { SettingsPageId } from './Chat';
import type { Session } from '../types';
import { Diamond } from './Diamond';
import { MBTI_PERSONALITIES } from '../data/mbti-personalities';
import { useClickFlash } from '../hooks/useClickFlash';
import { useI18n, type Locale, type TranslationKey } from '../i18n';
import '../styles/settings.css';
import '../styles/archive.css';

interface SettingsPageProps {
  page: SettingsPageId;
  onClose: () => void;
  sessions?: Session[];
  onSwitchSession?: (id: string) => void;
}

const SUPPORTED_LANGUAGES: { locale: Locale; code: string; name: string }[] = [
  { locale: 'en', code: 'EN', name: 'English' },
  { locale: 'ko', code: 'KO', name: 'Korean' },
  { locale: 'ja', code: 'JP', name: 'Japanese' },
  { locale: 'zh', code: 'CN', name: 'Chinese' },
];

const SHORTCUT_KEYS = [
  { labelKey: 'shortcutNewSession' as const, keys: 'Ctrl + N' },
  { labelKey: 'shortcutArchive' as const, keys: 'Ctrl + Q' },
  { labelKey: 'shortcutFocusChat' as const, keys: 'Ctrl + Enter' },
  { labelKey: 'shortcutPrevSession' as const, keys: 'Ctrl + [' },
  { labelKey: 'shortcutNextSession' as const, keys: 'Ctrl + ]' },
  { labelKey: 'shortcutDeleteSession' as const, keys: 'Ctrl + ⌫' },
  { labelKey: 'shortcutAttachFile' as const, keys: 'Ctrl + K' },
  { labelKey: 'shortcutAlwaysOnTop' as const, keys: 'Ctrl + P' },
  { labelKey: 'shortcutPrevMessage' as const, keys: 'Ctrl + ↑' },
  { labelKey: 'shortcutStopResponse' as const, keys: 'Esc' },
];

const MBTI_PAIRS: [string, string][] = [['I', 'E'], ['N', 'S'], ['T', 'F'], ['J', 'P']];

const PAGE_TITLE_KEYS: Record<SettingsPageId, TranslationKey> = {
  shortcuts: 'shortcuts',
  personalize: 'personalize',
  language: 'language',
  feedback: 'feedbackTitle',
  archive: 'archiveTitle',
  ollama: 'ollamaTitle',
};

function ShortcutsContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  const { t } = useI18n();
  return (
    <div className="settings-shortcuts-grid">
      {SHORTCUT_KEYS.map((shortcut) => (
        <button key={shortcut.labelKey} className="settings-shortcut-card" onClick={onFlash}>
          <span className="settings-shortcut-label">{t(shortcut.labelKey)}</span>
          <span className="settings-shortcut-keys">{shortcut.keys}</span>
        </button>
      ))}
    </div>
  );
}

function PersonalizeContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  const { t } = useI18n();
  const [mbtiLetters, setMbtiLetters] = useState<string[]>(['I', 'N', 'T', 'J']);
  const [animatingIdx, setAnimatingIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const store = await load('settings.json');
        const saved = await store.get<string>('mbti_type');
        if (saved && typeof saved === 'string' && saved.length === 4) {
          setMbtiLetters(saved.split(''));
        }
      } catch {}
    })();
  }, []);

  const randomizeMbti = async (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    const newLetters = MBTI_PAIRS.map(pair => pair[Math.random() < 0.5 ? 0 : 1]);

    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        setAnimatingIdx(i);
        setMbtiLetters(prev => {
          const next = [...prev];
          next[i] = newLetters[i];
          return next;
        });
      }, i * 120);
    }

    setTimeout(() => setAnimatingIdx(null), 4 * 120 + 300);

    try {
      const mbtiType = newLetters.join('');
      const personality = MBTI_PERSONALITIES[mbtiType];
      const store = await load('settings.json');
      await store.set('mbti_type', mbtiType);
      if (personality) {
        await store.set('mbti_prompt_modifier', personality.promptModifier);
      }
      await store.save();
    } catch {}
  };

  return (
    <div className="settings-personalize-cards">
      <button className="settings-card" onClick={onFlash}>
        <span className="settings-card-title">{t('personalizeApps')}</span>
        <span className="settings-card-subtitle">{t('personalizeAppsSubtitle')}</span>
      </button>
      <button className="settings-card" onClick={onFlash}>
        <span className="settings-card-title settings-card-title-italic">{t('personalizeAutomation')}</span>
        <span className="settings-card-subtitle">{t('personalizeAutomationSubtitle')}</span>
      </button>
      <div className="settings-card">
        <div className="settings-card-row">
          <span className="settings-card-title">{t('personalizeWinterIs')}</span>
          <div className="settings-badges">
            {mbtiLetters.map((letter, i) => (
              <span
                key={i}
                className={`settings-badge${animatingIdx !== null && i <= animatingIdx ? ' settings-badge-pop' : ''}`}
              >
                {letter}
              </span>
            ))}
            <button className="settings-mbti-diamond-btn" onClick={randomizeMbti}>
              <Diamond size={16} glow={true} className="settings-mbti-diamond" />
            </button>
          </div>
        </div>
        <span className="settings-card-subtitle">
          {t('personalizeFeelingLucky') + ' \u00b7 '}
          <span className="settings-card-link">{t('personalizeSomethingFun')}</span>
        </span>
      </div>
    </div>
  );
}

function LanguageContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  const { locale, setLocale } = useI18n();

  return (
    <div className="settings-language-list">
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          className={`settings-language-item${locale === lang.locale ? ' active' : ''}`}
          onClick={(e) => { onFlash(e); setLocale(lang.locale); }}
        >
          <span className="settings-language-code">{lang.code}</span>
          <span className="settings-language-name">{lang.name}</span>
        </button>
      ))}
    </div>
  );
}

function FeedbackContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  const { t } = useI18n();
  const [feedbackText, setFeedbackText] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpLoaded, setSmtpLoaded] = useState(false);
  const [smtpSaved, setSmtpSaved] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const smtpSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const store = await load('settings.json');
        const saved = await store.get<string>('smtp_app_password');
        if (saved && typeof saved === 'string') setSmtpPass(saved);
      } catch {}
      setSmtpLoaded(true);
    })();
    return () => {
      if (smtpSaveTimer.current) clearTimeout(smtpSaveTimer.current);
    };
  }, []);

  const saveSmtpPass = (value: string) => {
    setSmtpPass(value);
    setSmtpSaved(false);
    if (smtpSaveTimer.current) clearTimeout(smtpSaveTimer.current);
    smtpSaveTimer.current = setTimeout(async () => {
      try {
        const store = await load('settings.json');
        await store.set('smtp_app_password', value);
        await store.save();
        if (value.trim()) {
          setSmtpSaved(true);
          setTimeout(() => setSmtpSaved(false), 2000);
        }
      } catch {}
    }, 500);
  };

  const handleSend = async (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    if (!feedbackText.trim() || sending) return;
    setSending(true);
    setStatus('idle');
    try {
      await invoke('send_feedback', { text: feedbackText.trim() });
      setStatus('sent');
      setFeedbackText('');
    } catch {
      setStatus('error');
    }
    setSending(false);
  };

  const hasSmtp = smtpPass.trim().length > 0;

  return (
    <div className="settings-feedback">
      <div className="settings-smtp-row">
        <label className="settings-smtp-label">{t('smtpPassword')}</label>
        <div className="settings-smtp-input-wrap">
          <input
            className="settings-smtp-input"
            type={showPass ? 'text' : 'password'}
            value={smtpLoaded ? smtpPass : ''}
            placeholder={t('smtpPasswordPlaceholder')}
            onChange={(e) => saveSmtpPass(e.target.value)}
          />
          <button
            className="settings-smtp-toggle"
            onClick={(e) => { onFlash(e); setShowPass(!showPass); }}
          >
            {showPass ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        {smtpSaved && <span className="settings-feedback-status sent">{t('smtpSaved')}</span>}
      </div>
      {!hasSmtp && (
        <span className="settings-smtp-hint">{t('smtpRequired')}</span>
      )}
      <textarea
        className="settings-textarea"
        placeholder={t('feedbackPlaceholder')}
        value={feedbackText}
        onChange={(e) => setFeedbackText(e.target.value)}
      />
      <div className="settings-feedback-actions">
        {status === 'sent' && <span className="settings-feedback-status sent">{t('feedbackSent')}</span>}
        {status === 'error' && <span className="settings-feedback-status error">{t('feedbackError')}</span>}
        <button
          className="settings-send-btn"
          onClick={handleSend}
          disabled={sending || !feedbackText.trim() || !hasSmtp}
        >
          {sending ? t('feedbackSending') : t('feedbackSend')}
        </button>
      </div>
    </div>
  );
}

function OllamaContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  const { t } = useI18n();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'done' | 'failed'>('idle');
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('http://localhost:11434');
  const [model, setModel] = useState('qwen2.5:14b');
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [version, setVersion] = useState('');

  const checkConnection = async () => {
    setStatus('checking');
    try {
      const ver: string = await invoke('ollama_check');
      setVersion(ver);
      setStatus('connected');
      try {
        const modelList: string[] = await invoke('ollama_models');
        setModels(modelList);
      } catch {}
    } catch {
      setStatus('disconnected');
      setModels([]);
    }
  };

  useEffect(() => {
    (async () => {
      const isInstalled: boolean = await invoke('ollama_is_installed');
      setInstalled(isInstalled);
      if (!isInstalled) return;
      try {
        const store = await load('settings.json');
        const savedEnabled = await store.get<boolean>('ollama_enabled');
        const savedUrl = await store.get<string>('ollama_url');
        const savedModel = await store.get<string>('ollama_model');
        if (typeof savedEnabled === 'boolean') setEnabled(savedEnabled);
        if (savedUrl && typeof savedUrl === 'string') setUrl(savedUrl);
        if (savedModel && typeof savedModel === 'string') setModel(savedModel);
      } catch {}
      checkConnection();
    })();
  }, []);

  const handleInstall = async (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    setInstallState('installing');
    try {
      await invoke('ollama_install');
      setInstallState('done');
      setInstalled(true);
      checkConnection();
    } catch {
      setInstallState('failed');
    }
  };

  const handleToggle = async (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    const next = !enabled;
    setEnabled(next);
    try { await invoke('ollama_toggle', { enabled: next }); } catch {}
  };

  const saveConfig = async (newUrl: string, newModel: string) => {
    try { await invoke('ollama_set_config', { url: newUrl, model: newModel }); } catch {}
  };

  if (installed === null) {
    return (
      <div className="settings-ollama">
        <div className="settings-card">
          <span className="settings-card-subtitle">{t('ollamaChecking')}</span>
        </div>
      </div>
    );
  }

  if (!installed && installState !== 'done') {
    return (
      <div className="settings-ollama">
        <div className="settings-ollama-install-card">
          <div className="settings-ollama-install-header">
            <span className="settings-ollama-install-title">{t('ollamaNotInstalled')}</span>
            <span className="settings-ollama-badge">{t('ollamaRecommended')}</span>
          </div>
          <p className="settings-ollama-install-desc">{t('ollamaInstallDesc')}</p>
          <div className="settings-ollama-install-actions">
            {installState === 'installing' ? (
              <span className="settings-ollama-installing">{t('ollamaInstalling')}</span>
            ) : installState === 'failed' ? (
              <>
                <span className="settings-ollama-install-error">{t('ollamaInstallFailed')}</span>
                <button className="settings-ollama-install-btn" onClick={handleInstall}>
                  {t('ollamaInstallYes')}
                </button>
              </>
            ) : (
              <>
                <button className="settings-ollama-install-btn primary" onClick={handleInstall}>
                  {t('ollamaInstallYes')}
                </button>
                <button className="settings-ollama-install-btn" onClick={onFlash}>
                  {t('ollamaInstallCancel')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-ollama">
      <button className="settings-card" onClick={handleToggle}>
        <div className="settings-card-row">
          <span className="settings-card-title">{t('ollamaEnabled')}</span>
          <span className={`settings-ollama-toggle${enabled ? ' on' : ''}`}>
            <span className="settings-ollama-toggle-dot" />
          </span>
        </div>
        <span className="settings-card-subtitle">{t('ollamaSubtitle')}</span>
      </button>

      <div className="settings-card">
        <div className="settings-card-row">
          <span className="settings-card-title">{t('ollamaStatus')}</span>
          <span className={`settings-ollama-status ${status}`}>
            {status === 'checking' ? t('ollamaChecking')
              : status === 'connected' ? `${t('ollamaConnected')} (v${version})`
              : t('ollamaDisconnected')}
          </span>
          <button className="settings-ollama-refresh" onClick={(e) => { onFlash(e); checkConnection(); }}>
            {t('ollamaRefresh')}
          </button>
        </div>
      </div>

      <div className="settings-card">
        <span className="settings-card-title">{t('ollamaUrl')}</span>
        <input
          className="settings-ollama-input"
          value={url}
          onChange={(e) => { setUrl(e.target.value); saveConfig(e.target.value, model); }}
          placeholder="http://localhost:11434"
        />
      </div>

      <div className="settings-card">
        <span className="settings-card-title">{t('ollamaModel')}</span>
        {models.length > 0 ? (
          <div className="settings-ollama-models">
            {models.map((m) => (
              <button
                key={m}
                className={`settings-ollama-model-btn${m === model ? ' active' : ''}`}
                onClick={(e) => { onFlash(e); setModel(m); saveConfig(url, m); }}
              >
                {m}
              </button>
            ))}
          </div>
        ) : (
          <input
            className="settings-ollama-input"
            value={model}
            onChange={(e) => { setModel(e.target.value); saveConfig(url, e.target.value); }}
            placeholder="qwen2.5:14b"
          />
        )}
      </div>
    </div>
  );
}

function ArchiveContent({
  onFlash,
  sessions,
  onSwitchSession,
}: {
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
  sessions: Session[];
  onSwitchSession: (id: string) => void;
}) {
  const { t } = useI18n();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sparkleId, setSparkleId] = useState<string | null>(null);

  const grouped = sessions.reduce<Record<string, Session[]>>((acc, session) => {
    const date = new Date(session.createdAt);
    const key = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(session);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const handleDateClick = (e: React.MouseEvent<HTMLElement>, date: string) => {
    onFlash(e);
    setSparkleId(date);
    setTimeout(() => {
      setSparkleId(null);
      setSelectedDate(date);
    }, 400);
  };

  if (selectedDate && grouped[selectedDate]) {
    const dateSessions = grouped[selectedDate];
    const half = Math.ceil(dateSessions.length / 2);
    const leftCol = dateSessions.slice(0, half);
    const rightCol = dateSessions.slice(half);

    return (
      <div className="archive-detail">
        <button
          className="archive-back-btn"
          onClick={(e) => { onFlash(e); setSelectedDate(null); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {selectedDate}
        </button>
        <div className="archive-grid">
          <div className="archive-grid-col">
            {leftCol.map((session) => (
              <button
                key={session.id}
                className="archive-session-card"
                onClick={(e) => { onFlash(e); onSwitchSession(session.id); }}
              >
                <span className="archive-session-name">{session.name}</span>
                <span className="archive-session-preview">
                  {session.messages[0]?.content.slice(0, 80) || t('archiveEmptySession')}
                </span>
                <span className="archive-session-count">
                  {session.messages.length} {t('archiveMessages')}
                </span>
              </button>
            ))}
          </div>
          <div className="archive-grid-col">
            {rightCol.map((session) => (
              <button
                key={session.id}
                className="archive-session-card"
                onClick={(e) => { onFlash(e); onSwitchSession(session.id); }}
              >
                <span className="archive-session-name">{session.name}</span>
                <span className="archive-session-preview">
                  {session.messages[0]?.content.slice(0, 80) || t('archiveEmptySession')}
                </span>
                <span className="archive-session-count">
                  {session.messages.length} {t('archiveMessages')}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="archive-list">
      {sortedDates.length === 0 && (
        <div className="archive-empty">{t('archiveEmpty')}</div>
      )}
      {sortedDates.map((date) => (
        <button
          key={date}
          className={`archive-date-block${sparkleId === date ? ' archive-sparkle' : ''}`}
          onClick={(e) => handleDateClick(e, date)}
        >
          <span className="archive-date-label">{date}</span>
          <span className="archive-date-count">
            {grouped[date].length} {t('sessions').toLowerCase()}
          </span>
        </button>
      ))}
    </div>
  );
}

export function SettingsPage({ page, onClose, sessions, onSwitchSession }: SettingsPageProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();

  const renderContent = () => {
    switch (page) {
      case 'shortcuts':
        return <ShortcutsContent onFlash={onFlash} />;
      case 'personalize':
        return <PersonalizeContent onFlash={onFlash} />;
      case 'language':
        return <LanguageContent onFlash={onFlash} />;
      case 'feedback':
        return <FeedbackContent onFlash={onFlash} />;
      case 'ollama':
        return <OllamaContent onFlash={onFlash} />;
      case 'archive':
        return (
          <ArchiveContent
            onFlash={onFlash}
            sessions={sessions ?? []}
            onSwitchSession={(id) => {
              onSwitchSession?.(id);
              onClose();
            }}
          />
        );
    }
  };

  const pageTitle = t(PAGE_TITLE_KEYS[page]);

  return (
    <div className="settings-subpage" role="region" aria-label={pageTitle}>
      <div className="settings-subpage-scroll">
        <div className="settings-subpage-inner">
          <h2 className="settings-subpage-title">{pageTitle}</h2>

          {renderContent()}

          {page === 'personalize' && (
            <div className="settings-advanced-row">
              <button
                className="settings-advanced-btn"
                onClick={(e) => { onFlash(e); onClose(); }}
              >
                {t('advanced')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
