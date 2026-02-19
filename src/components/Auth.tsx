/**
 * Auth — OAuth PKCE authentication flow screen.
 *
 * Shown when the app has no valid token. Guides the user through:
 * 1. Opening the authorization URL in the system browser
 * 2. Pasting the authorization code back into the app
 */
import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useI18n } from '../i18n';
import '../styles/auth.css';

interface AuthProps {
  /** Returns the OAuth authorization URL from the Rust backend */
  getAuthorizeUrl: () => Promise<string>;
  /** Exchanges the authorization code for an access token */
  onExchangeCode: (code: string) => Promise<void>;
  /** Skips authentication (for local/dev use) */
  onSkip: () => void;
}

/**
 * Renders the full-screen authentication card with two steps:
 * open auth URL → paste code → submit.
 */
export function Auth({ getAuthorizeUrl, onExchangeCode, onSkip }: AuthProps) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAuthorize = async () => {
    try {
      const url = await getAuthorizeUrl();
      await openUrl(url);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onExchangeCode(trimmed);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-diamond" />
        <h2 className="auth-title">{t('authTitle')}</h2>
        <p className="auth-subtitle">{t('authSubtitle')}</p>

        <div className="auth-step">
          <div className="auth-step-label">{t('authStep1')}</div>
          <button
            type="button"
            className="auth-link-btn"
            onClick={handleAuthorize}
          >
            {t('authOpenAuth')}
          </button>
        </div>

        <div className="auth-step">
          <div className="auth-step-label">{t('authStep2')}</div>
          <input
            className="auth-input"
            type="text"
            placeholder={t('authPastePlaceholder')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button
          type="submit"
          className="auth-submit"
          disabled={!code.trim() || submitting}
        >
          {submitting ? t('authConnecting') : t('authContinue')}
        </button>

        <button
          type="button"
          className="auth-skip"
          onClick={onSkip}
        >
          {t('authSkip')}
        </button>
      </form>
    </div>
  );
}
