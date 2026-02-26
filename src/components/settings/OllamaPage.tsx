/**
 * OllamaPage — Optional Ollama / local LLM configuration.
 *
 * Haiku handles context compression by default. Ollama is optional for users
 * who prefer a local LLM. Not installed = show informational message, not a prompt.
 * When installed: toggle enabled/disabled, connection status, URL + model config.
 *
 * Tauri commands: ollama_is_installed, ollama_check, ollama_models,
 * ollama_install, ollama_toggle, ollama_set_config.
 */
import { useState, useEffect } from 'react';
import { invoke } from '../../utils/invoke-shim';
import { isTauri } from '../../utils/platform';
import { loadWebStore } from '../../utils/web-store';
import { useI18n } from '../../i18n';
import '../../styles/settings-ollama.css';

interface OllamaPageProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Settings page for configuring the optional Ollama local LLM integration.
 *
 * @param onFlash - ripple effect callback on interactive element click
 */
export function OllamaPage({ onFlash }: OllamaPageProps) {
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
        const store = isTauri
          ? await import('@tauri-apps/plugin-store').then(m => m.load('settings.json'))
          : await loadWebStore('settings.json');
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
        <div className="settings-card">
          <div className="settings-card-row">
            <span className="settings-card-title">{t('ollamaNotInstalled')}</span>
            <span className="settings-ollama-badge settings-ollama-badge--optional">{t('ollamaOptional')}</span>
          </div>
          <span className="settings-card-subtitle">{t('ollamaHaikuHandles')}</span>
        </div>
        <div className="settings-card">
          <span className="settings-card-title">{t('ollamaInstallOptional')}</span>
          <span className="settings-card-subtitle">{t('ollamaInstallDesc')}</span>
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
              <button className="settings-ollama-install-btn" onClick={handleInstall}>
                {t('ollamaInstallYes')}
              </button>
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
          <span className="settings-ollama-badge settings-ollama-badge--optional">{t('ollamaOptional')}</span>
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
