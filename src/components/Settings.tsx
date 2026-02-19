/**
 * Settings — multi-page settings overlay rendered inline in the chat body.
 *
 * Pages: shortcuts, personalize (model + MBTI + automation link),
 *        language, feedback, archive, ollama, folder browser, automation.
 *
 * Each page is a separate sub-component. `SettingsPage` is the outer shell
 * that renders the correct sub-component based on the `page` prop.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { openUrl } from '@tauri-apps/plugin-opener';
import QRCode from 'qrcode';
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
  onNavigate?: (page: SettingsPageId) => void;
  sessions?: Session[];
  onSwitchSession?: (id: string) => void;
  workingDirectory?: string;
  onChangeDirectory?: (dir: string) => void;
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
  { labelKey: 'shortcutSearch' as const, keys: 'Ctrl + F' },
];

const MBTI_PAIRS: [string, string][] = [['I', 'E'], ['N', 'S'], ['T', 'F'], ['J', 'P']];

const PAGE_TITLE_KEYS: Record<SettingsPageId, TranslationKey> = {
  shortcuts: 'shortcuts',
  personalize: 'personalize',
  language: 'language',
  feedback: 'feedbackTitle',
  archive: 'archiveTitle',
  ollama: 'ollamaTitle',
  folder: 'folderTitle',
  automation: 'automationTitle',
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

const MOBILE_LINK_URL = 'http://100.72.94.73:8890/winter-mobile.html';

function MobileLinkCard({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);

  const generateQr = useCallback(async () => {
    try {
      const url = await QRCode.toDataURL(MOBILE_LINK_URL, {
        width: 200,
        margin: 2,
        color: { dark: '#e5e5e5', light: '#13111f' },
      });
      setQrDataUrl(url);
    } catch {}
  }, []);

  const handleToggle = (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    const next = !expanded;
    setExpanded(next);
    if (next && !qrDataUrl) generateQr();
  };

  const handleCopy = async (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    try {
      await navigator.clipboard.writeText(MOBILE_LINK_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="settings-card settings-mobile-link-card">
      <button className="settings-mobile-link-header" onClick={handleToggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="3" />
          <line x1="12" y1="18" x2="12" y2="18.01" />
        </svg>
        <span className="settings-card-title">{t('mobileLink')}</span>
        <span className={`settings-mobile-link-chevron${expanded ? ' open' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="settings-mobile-link-body">
          <span className="settings-card-subtitle">{t('mobileLinkSubtitle')}</span>
          <div className="settings-mobile-link-url-row">
            <input
              className="settings-mobile-link-url"
              value={MOBILE_LINK_URL}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="settings-mobile-link-copy" onClick={handleCopy}>
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
          {qrDataUrl && (
            <div className="settings-mobile-link-qr">
              <img src={qrDataUrl} alt="QR" width={160} height={160} />
              <span className="settings-mobile-link-qr-hint-light">{t('mobileLinkQrHint')}</span>
            </div>
          )}
          <button
            className="settings-mobile-link-howto-toggle"
            onClick={(e) => { onFlash(e); setHowToOpen(!howToOpen); }}
          >
            {t('mobileLinkHowTo')}
            <span className={`settings-mobile-link-howto-chevron${howToOpen ? ' open' : ''}`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
          {howToOpen && (
            <div className="settings-mobile-link-howto-body">
              <p className="settings-mobile-link-howto-step">{t('mobileLinkHowToStep1')}</p>
              <p className="settings-mobile-link-howto-step">{t('mobileLinkHowToStep2')}</p>
              <p className="settings-mobile-link-howto-step">{t('mobileLinkHowToStep3')}</p>
              <p className="settings-mobile-link-howto-step">{t('mobileLinkHowToStep4')}</p>
              <p className="settings-mobile-link-howto-note">{t('mobileLinkHowToNote')}</p>
              <a
                className="settings-mobile-link-howto-cta"
                href="#"
                onClick={(e) => { e.preventDefault(); openUrl('https://tailscale.com/download'); }}
              >
                {t('mobileLinkGetTailscale')}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-20250514', label: 'modelOpus' as const },
  { id: 'claude-sonnet-4-20250514', label: 'modelSonnet' as const },
  { id: 'claude-haiku-4-20250514', label: 'modelHaiku' as const },
];

function PersonalizeContent({ onFlash, onNavigate }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void; onNavigate?: (page: SettingsPageId) => void }) {
  const { t } = useI18n();
  const [mbtiLetters, setMbtiLetters] = useState<string[]>(['I', 'N', 'T', 'J']);
  const [animatingIdx, setAnimatingIdx] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState('claude-opus-4-20250514');

  useEffect(() => {
    (async () => {
      try {
        const store = await load('settings.json');
        const saved = await store.get<string>('mbti_type');
        if (saved && typeof saved === 'string' && saved.length === 4) {
          setMbtiLetters(saved.split(''));
        }
        const savedModel = await store.get<string>('claude_model');
        if (savedModel && typeof savedModel === 'string') {
          setSelectedModel(savedModel);
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
      const personality = MBTI_PERSONALITIES[mbtiType as keyof typeof MBTI_PERSONALITIES];
      const store = await load('settings.json');
      await store.set('mbti_type', mbtiType);
      if (personality) {
        await store.set('mbti_prompt_modifier', personality.promptModifier);
      }
      await store.save();
    } catch {}
  };

  const handleModelChange = async (e: React.MouseEvent<HTMLElement>, modelId: string) => {
    onFlash(e);
    setSelectedModel(modelId);
    try {
      const store = await load('settings.json');
      await store.set('claude_model', modelId);
      await store.save();
    } catch {}
  };

  return (
    <div className="settings-personalize-cards">
      <div className="settings-card">
        <span className="settings-card-title">{t('modelTitle')}</span>
        <span className="settings-card-subtitle">{t('modelSubtitle')}</span>
        <div className="settings-model-list">
          {CLAUDE_MODELS.map((m) => (
            <button
              key={m.id}
              className={`settings-model-btn${selectedModel === m.id ? ' active' : ''}`}
              onClick={(e) => handleModelChange(e, m.id)}
            >
              {t(m.label)}
            </button>
          ))}
        </div>
      </div>
      <MobileLinkCard onFlash={onFlash} />
      <button className="settings-card settings-card-nav" onClick={(e) => { onFlash(e); onNavigate?.('automation'); }}>
        <div className="settings-card-row">
          <span className="settings-card-title settings-card-title-italic">{t('personalizeAutomation')}</span>
          <span className="settings-card-nav-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </div>
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

  const handleSend = async (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    if (!feedbackText.trim() || sending) return;
    setSending(true);
    setStatus('idle');
    try {
      await invoke('send_feedback', { text: feedbackText.trim() });
      setStatus('sent');
      setFeedbackText('');
      setTimeout(() => setStatus('idle'), 3000); // 3초 뒤 상태 초기화
    } catch {
      setStatus('error');
    }
    setSending(false);
  };

  return (
    <div className="settings-feedback">
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
          disabled={sending || !feedbackText.trim()}
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

function FolderBrowserContent({
  onFlash,
  workingDirectory,
  onChangeDirectory,
}: {
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
  workingDirectory: string;
  onChangeDirectory: (dir: string) => void;
}) {
  const { t } = useI18n();
  const [browsePath, setBrowsePath] = useState(workingDirectory || '/home');
  const [dirs, setDirs] = useState<Array<{ name: string; absolute: string }>>([]);
  const [searchResults, setSearchResults] = useState<Array<{ name: string; absolute: string }>>([]);
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [foldersVisible, setFoldersVisible] = useState(true);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [history, setHistory] = useState<string[]>([workingDirectory || '/home']);
  const [historyIdx, setHistoryIdx] = useState(0);
  const homePathRef = useRef('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createPopupRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toRel = useCallback((abs: string) => {
    const home = homePathRef.current;
    if (!home) return abs;
    if (abs === home) return '.';
    if (abs.startsWith(home + '/')) return abs.slice(home.length + 1);
    return abs;
  }, []);

  useEffect(() => {
    invoke<{ home?: string }>('opencode_get_path')
      .then(d => { if (d.home) homePathRef.current = d.home; })
      .catch(() => {});
  }, []);

  const navigateTo = useCallback(async (dirPath: string, pushHistory = true) => {
    setLoading(true);
    const relPath = toRel(dirPath);
    try {
      const data = await invoke<Array<{ name: string; absolute: string; type: string; ignored: boolean }>>('opencode_list_files', { path: relPath }).catch(() => null);
      if (!data) { setLoading(false); return; }
      if (Array.isArray(data)) {
        const filtered = data
          .filter((f) => f.type === 'directory' && !f.ignored)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => ({ name: f.name, absolute: f.absolute }));
        setDirs(filtered);
        setBrowsePath(dirPath);
        setSearchValue('');
        if (pushHistory) {
          setHistory(prev => {
            const trimmed = prev.slice(0, historyIdx + 1);
            return [...trimmed, dirPath];
          });
          setHistoryIdx(prev => prev + 1);
        }
      }
    } catch { /* best-effort */ }
    setLoading(false);
  }, [toRel, historyIdx]);

  const goBack = () => {
    if (historyIdx <= 0) return;
    const newIdx = historyIdx - 1;
    setHistoryIdx(newIdx);
    navigateTo(history[newIdx], false);
  };

  const goForward = () => {
    if (historyIdx >= history.length - 1) return;
    const newIdx = historyIdx + 1;
    setHistoryIdx(newIdx);
    navigateTo(history[newIdx], false);
  };

  const goRefresh = () => {
    navigateTo(browsePath, false);
  };

  useEffect(() => {
    navigateTo(workingDirectory || '/home', false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!searchFocused) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchFocused]);

  useEffect(() => {
    if (!creating) return;
    const handler = (e: MouseEvent) => {
      if (
        createPopupRef.current && !createPopupRef.current.contains(e.target as Node) &&
        createBtnRef.current && !createBtnRef.current.contains(e.target as Node)
      ) {
        setCreating(false);
        setNewFolderName('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [creating]);

  const goUp = () => {
    const parent = browsePath.replace(/\/[^/]+$/, '') || '/';
    navigateTo(parent);
  };

  useEffect(() => {
    const q = searchValue.trim();
    if (!q) { setSearchResults([]); setSearchDone(false); return; }
    setSearchDone(false);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const home = homePathRef.current || '/home';
        const results: Array<{ name: string; absolute: string }> = await invoke('search_directories', {
          root: home, query: q, maxResults: 20,
        });
        setSearchResults(results);
      } catch { setSearchResults([]); }
      setSearchDone(true);
    }, 200);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchValue]);

  const hasQuery = searchFocused && searchValue.trim().length > 0;
  const showDropdown = hasQuery && (searchResults.length > 0 || searchDone);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const fullPath = browsePath.endsWith('/') ? browsePath + name : browsePath + '/' + name;
    try {
      await invoke('create_directory', { path: fullPath });
      setCreating(false);
      setNewFolderName('');
      navigateTo(browsePath, false);
    } catch { /* best-effort */ }
  };

  return (
    <div className="settings-folder-browser">
      <div className="settings-folder-input-row" ref={dropdownRef}>
        <div className="settings-folder-search-wrap">
          <input
            className="settings-folder-input"
            type="text"
            placeholder="folder name"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter' && searchValue.trim()) {
                const match = searchResults[0];
                if (match) {
                  navigateTo(match.absolute);
                  setSearchFocused(false);
                } else {
                  navigateTo(searchValue.trim());
                }
              }
              if (e.key === 'Escape') setSearchFocused(false);
            }}
            autoFocus
          />
          {showDropdown && (
            <div className="settings-folder-dropdown">
              {searchResults.length === 0 ? (
                <div className="settings-folder-dropdown-empty">No folders found</div>
              ) : searchResults.slice(0, 12).map((d) => (
                <button
                  key={d.absolute}
                  className="settings-folder-dropdown-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onFlash(e);
                    navigateTo(d.absolute);
                    setSearchFocused(false);
                  }}
                >
                  <span className="settings-folder-dropdown-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                  <span className="settings-folder-dropdown-name">{d.name}</span>
                  <span className="settings-folder-dropdown-path">{d.absolute}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="settings-folder-go-btn"
          onClick={(e) => {
            onFlash(e);
            if (searchValue.trim()) {
              const match = searchResults[0];
              if (match) navigateTo(match.absolute);
              else navigateTo(searchValue.trim());
            }
          }}
        >
          {t('folderSearch')}
        </button>
      </div>

      <div className="settings-folder-browse-header">
        <div className="settings-folder-nav-btns">
          <button
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); goBack(); }}
            disabled={historyIdx <= 0}
            title="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); goForward(); }}
            disabled={historyIdx >= history.length - 1}
            title="Forward"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); goUp(); }}
            disabled={browsePath === '/'}
            title="Up"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); goRefresh(); }}
            title="Refresh"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            ref={createBtnRef}
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); setCreating(!creating); if (creating) setNewFolderName(''); }}
            title="New folder"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
        </div>
        <button
          className="settings-folder-toggle-btn"
          onClick={(e) => { onFlash(e); setFoldersVisible(!foldersVisible); }}
          title={foldersVisible ? 'Hide folders' : 'Show folders'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {foldersVisible
              ? <polyline points="18 15 12 9 6 15" />
              : <polyline points="6 9 12 15 18 9" />
            }
          </svg>
        </button>
      </div>

      {foldersVisible && (
        <div className="settings-folder-dirlist">
          {loading ? (
            <div className="settings-folder-empty">{t('folderLoading')}</div>
          ) : dirs.length === 0 ? (
            <div className="settings-folder-empty">{t('folderEmpty')}</div>
          ) : (
            dirs.map((d) => (
              <button
                key={d.absolute}
                className="settings-card settings-folder-card"
                onClick={(e) => { onFlash(e); navigateTo(d.absolute); }}
              >
                <div className="settings-card-row">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="settings-card-title">{d.name}</span>
                </div>
                <span className="settings-card-subtitle">{d.absolute}</span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="settings-folder-actions">
        <button
          className="settings-folder-select-btn"
          onClick={(e) => { onFlash(e); onChangeDirectory(browsePath); }}
        >
          {t('folderSelect')}
        </button>
      </div>

      {creating && (
        <div className="settings-folder-create-popup" ref={createPopupRef}>
          <div className="settings-folder-create-popup-bubble">
            <input
              className="settings-folder-create-popup-input"
              type="text"
              placeholder={t('folderCreatePlaceholder')}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') { setCreating(false); setNewFolderName(''); }
              }}
              autoFocus
            />
            <button
              className="settings-folder-create-popup-confirm"
              onClick={(e) => { onFlash(e); handleCreateFolder(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ServiceStatusInfo {
  id: string;
  name: string;
  category: string;
  status: 'running' | 'stopped' | 'unknown' | 'notinstalled' | 'unsupported';
  supported: boolean;
}

interface TaskStatus {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  created_by_user: boolean;
  last_run?: string;
  next_run?: string;
  running: boolean;
}

interface CreateTaskForm {
  name: string;
  schedule: string;
  script: string;
}

function AutomationContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceStatusInfo[]>([]);
  const [tasks, setTasks] = useState<TaskStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(true);
  const [cronsOpen, setCronsOpen] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateTaskForm>({ name: '', schedule: '', script: '' });
  const [creating, setCreating] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchStatus = async () => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const [svcData, taskData] = await Promise.all([
        invoke<ServiceStatusInfo[]>('get_services_status'),
        invoke<TaskStatus[]>('get_scheduler_status'),
      ]);
      if (id === fetchIdRef.current) {
        setServices(svcData);
        setTasks(taskData);
      }
    } catch {
      if (id === fetchIdRef.current) setError(true);
    }
    if (id === fetchIdRef.current) setLoading(false);
  };

  useEffect(() => { fetchStatus(); }, []);

  const setBusy = (id: string, busy: boolean) => {
    setBusyIds(prev => {
      const next = new Set(prev);
      busy ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const handleServiceToggle = async (e: React.MouseEvent<HTMLElement>, svc: ServiceStatusInfo) => {
    onFlash(e);
    if (busyIds.has(svc.id)) return;
    setBusy(svc.id, true);
    try {
      await invoke('control_service', { id: svc.id, action: svc.status === 'running' ? 'stop' : 'start' });
    } catch { setError(true); }
    try { await fetchStatus(); } catch { /* status refresh failed but action may have succeeded */ }
    setBusy(svc.id, false);
  };

  const handleServiceRestart = async (e: React.MouseEvent<HTMLElement>, svc: ServiceStatusInfo) => {
    onFlash(e);
    const key = `${svc.id}-restart`;
    if (busyIds.has(key)) return;
    setBusy(key, true);
    try {
      await invoke('control_service', { id: svc.id, action: 'restart' });
    } catch { setError(true); }
    try { await fetchStatus(); } catch { /* status refresh failed but action may have succeeded */ }
    setBusy(key, false);
  };

  const handleTaskToggle = async (e: React.MouseEvent<HTMLElement>, task: TaskStatus) => {
    onFlash(e);
    if (busyIds.has(task.id)) return;
    setBusy(task.id, true);
    try {
      await invoke('toggle_task', { id: task.id, enabled: !task.enabled });
    } catch { setError(true); }
    try { await fetchStatus(); } catch { /* status refresh failed but action may have succeeded */ }
    setBusy(task.id, false);
  };

  const handleRunNow = async (e: React.MouseEvent<HTMLElement>, task: TaskStatus) => {
    onFlash(e);
    const key = `${task.id}-run`;
    if (busyIds.has(key)) return;
    setBusy(key, true);
    try {
      await invoke('run_task_now', { id: task.id });
    } catch { setError(true); }
    setBusy(key, false);
  };

  const handleDeleteTask = async (e: React.MouseEvent<HTMLElement>, task: TaskStatus) => {
    onFlash(e);
    const key = `${task.id}-delete`;
    if (busyIds.has(key)) return;
    setBusy(key, true);
    try {
      await invoke('delete_task', { id: task.id });
      await fetchStatus();
    } catch { setError(true); }
    setBusy(key, false);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.schedule.trim() || !createForm.script.trim()) return;
    setCreating(true);
    try {
      const id = createForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!id) return;
      await invoke('create_task', {
        entry: {
          id,
          name: createForm.name.trim(),
          schedule: createForm.schedule.trim(),
          command: { script: createForm.script.trim(), args: [] },
          log_file: `${id}.log`,
          enabled: false,
          created_by_user: true,
        },
      });
      setCreateForm({ name: '', schedule: '', script: '' });
      setShowCreateForm(false);
      await fetchStatus();
    } catch { setError(true); }
    setCreating(false);
  };

  const getServiceDotClass = (status: ServiceStatusInfo['status']) => {
    switch (status) {
      case 'running': return 'settings-automation-status-dot active';
      case 'stopped': return 'settings-automation-status-dot';
      case 'notinstalled': return 'settings-automation-status-dot notinstalled';
      default: return 'settings-automation-status-dot unknown';
    }
  };

  const getServiceLabel = (svc: ServiceStatusInfo) => {
    switch (svc.status) {
      case 'running': return t('automationRunning');
      case 'stopped': return t('automationStopped');
      case 'notinstalled': return t('automationNotInstalled');
      default: return t('automationStopped');
    }
  };

  const visibleServices = services.filter(s => s.supported !== false && s.status !== 'unsupported');

  if (loading) {
    return (
      <div className="settings-automation-state">
        <span className="settings-automation-state-text settings-automation-state-loading">{t('automationLoading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-automation-state">
        <span className="settings-automation-state-text settings-automation-state-error">{t('automationError')}</span>
        <button className="settings-automation-refresh-btn" onClick={(e) => { onFlash(e); fetchStatus(); }}>
          {t('automationRefresh')}
        </button>
      </div>
    );
  }

  return (
    <div className="settings-automation">
      {visibleServices.length > 0 && (
        <div className="settings-automation-section">
          <button
            className="settings-automation-section-header"
            onClick={(e) => { onFlash(e); setServicesOpen(!servicesOpen); }}
          >
            <span className={`settings-automation-section-chevron${servicesOpen ? ' open' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
            <span className="settings-automation-section-title">{t('automationServices')}</span>
            <span className="settings-automation-section-count">{visibleServices.length}</span>
          </button>
          {servicesOpen && (
            <div className="settings-card settings-automation-list">
              {visibleServices.map((svc, i) => (
                <div key={svc.id} className={`settings-automation-row${i < visibleServices.length - 1 ? ' settings-automation-row-divider' : ''}`}>
                  <span className={getServiceDotClass(svc.status)} />
                  <span className="settings-automation-name">{svc.name}</span>
                  <span className={`settings-automation-label${svc.status === 'running' ? ' running' : ''}`}>
                    {getServiceLabel(svc)}
                  </span>
                  <div className="settings-automation-actions">
                    <button
                      className="settings-automation-action-btn"
                      onClick={(e) => handleServiceRestart(e, svc)}
                      disabled={busyIds.has(`${svc.id}-restart`) || svc.status === 'notinstalled'}
                      title={t('automationRestart')}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                    <button
                      className="settings-automation-toggle-wrap"
                      onClick={(e) => handleServiceToggle(e, svc)}
                      disabled={busyIds.has(svc.id) || svc.status === 'notinstalled'}
                      aria-label={svc.status === 'running' ? t('automationRunning') : t('automationStopped')}
                    >
                      <span className={`settings-automation-toggle${svc.status === 'running' ? ' on' : ''}`}>
                        <span className="settings-automation-toggle-dot" />
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="settings-automation-section">
        <button
          className="settings-automation-section-header"
          onClick={(e) => { onFlash(e); setCronsOpen(!cronsOpen); }}
        >
          <span className={`settings-automation-section-chevron${cronsOpen ? ' open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
          <span className="settings-automation-section-title">{t('automationCrons')}</span>
          <span className="settings-automation-section-count">{tasks.length}</span>
        </button>
        {cronsOpen && (
          <div className="settings-card settings-automation-list">
            {tasks.map((task, i) => (
              <div key={task.id} className={`settings-automation-row${i < tasks.length - 1 ? ' settings-automation-row-divider' : ''}`}>
                <span className="settings-automation-name">{task.name}</span>
                <span className="settings-automation-schedule">{task.schedule}</span>
                <div className="settings-automation-actions">
                  {task.created_by_user && (
                    <button
                      className="settings-automation-action-btn settings-automation-delete-btn"
                      onClick={(e) => handleDeleteTask(e, task)}
                      disabled={busyIds.has(`${task.id}-delete`)}
                      title={t('automationDeleteTask')}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  )}
                  <button
                    className="settings-automation-action-btn"
                    onClick={(e) => handleRunNow(e, task)}
                    disabled={busyIds.has(`${task.id}-run`) || task.running}
                    title={t('automationRunNow')}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                  <button
                    className="settings-automation-toggle-wrap"
                    onClick={(e) => handleTaskToggle(e, task)}
                    disabled={busyIds.has(task.id)}
                    aria-label={task.enabled ? t('automationRunning') : t('automationStopped')}
                  >
                    <span className={`settings-automation-toggle${task.enabled ? ' on' : ''}`}>
                      <span className="settings-automation-toggle-dot" />
                    </span>
                  </button>
                </div>
              </div>
            ))}
            {showCreateForm ? (
              <form
                className="settings-automation-create-form"
                onSubmit={handleCreateTask}
              >
                <input
                  className="settings-automation-create-input"
                  type="text"
                  placeholder={t('automationTaskName')}
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
                <input
                  className="settings-automation-create-input"
                  type="text"
                  placeholder={t('automationTaskSchedule')}
                  value={createForm.schedule}
                  onChange={e => setCreateForm(f => ({ ...f, schedule: e.target.value }))}
                />
                <input
                  className="settings-automation-create-input"
                  type="text"
                  placeholder={t('automationTaskScript')}
                  value={createForm.script}
                  onChange={e => setCreateForm(f => ({ ...f, script: e.target.value }))}
                />
                <div className="settings-automation-create-actions">
                  <button
                    type="submit"
                    className="settings-automation-create-submit"
                    disabled={creating || !createForm.name.trim() || !createForm.schedule.trim() || !createForm.script.trim()}
                  >
                    {t('automationCreate')}
                  </button>
                  <button
                    type="button"
                    className="settings-automation-create-cancel"
                    onClick={() => { setShowCreateForm(false); setCreateForm({ name: '', schedule: '', script: '' }); }}
                  >
                    {t('automationCancel')}
                  </button>
                </div>
              </form>
            ) : (
              <div className={`settings-automation-row${tasks.length > 0 ? ' settings-automation-row-divider' : ''}`}>
                <button
                  className="settings-automation-create-btn"
                  onClick={(e) => { onFlash(e); setShowCreateForm(true); }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t('automationCreateTask')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <button
        className="settings-automation-refresh-btn"
        onClick={(e) => { onFlash(e); fetchStatus(); }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        {t('automationRefresh')}
      </button>
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

export function SettingsPage({ page, onClose, onNavigate, sessions, onSwitchSession, workingDirectory, onChangeDirectory }: SettingsPageProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();

  const renderContent = () => {
    switch (page) {
      case 'shortcuts':
        return <ShortcutsContent onFlash={onFlash} />;
      case 'personalize':
        return <PersonalizeContent onFlash={onFlash} onNavigate={onNavigate} />;
      case 'language':
        return <LanguageContent onFlash={onFlash} />;
      case 'feedback':
        return <FeedbackContent onFlash={onFlash} />;
      case 'ollama':
        return <OllamaContent onFlash={onFlash} />;
      case 'folder':
        return (
          <FolderBrowserContent
            onFlash={onFlash}
            workingDirectory={workingDirectory ?? ''}
            onChangeDirectory={onChangeDirectory ?? (() => {})}
          />
        );
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
      case 'automation':
        return <AutomationContent onFlash={onFlash} />;
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