import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import '../styles/auth.css';

interface AuthProps {
  getAuthorizeUrl: () => Promise<string>;
  onExchangeCode: (code: string) => Promise<void>;
  onSkip: () => void;
}

export function Auth({ getAuthorizeUrl, onExchangeCode, onSkip }: AuthProps) {
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
        <h2 className="auth-title">Welcome to Winter</h2>
        <p className="auth-subtitle">
          Authorize with your Claude account to get started.
        </p>

        <div className="auth-step">
          <div className="auth-step-label">Step 1 — Authorize</div>
          <button
            type="button"
            className="auth-link-btn"
            onClick={handleAuthorize}
          >
            Open Authorization Page →
          </button>
        </div>

        <div className="auth-step">
          <div className="auth-step-label">Step 2 — Paste the code</div>
          <input
            className="auth-input"
            type="text"
            placeholder="Paste authorization code here..."
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
          {submitting ? 'Connecting...' : 'Continue'}
        </button>

        <button
          type="button"
          className="auth-skip"
          onClick={onSkip}
        >
          Skip for now →
        </button>
      </form>
    </div>
  );
}
