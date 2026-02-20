/**
 * FeedbackPage — Textarea + send button for submitting user feedback.
 *
 * Invokes 'send_feedback' Tauri command with the trimmed text.
 * Shows sent/error status inline for 3 seconds, then resets.
 */
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../../i18n';
import '../../styles/settings-feedback.css';

interface FeedbackPageProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Settings page for submitting feedback to the Winter team.
 *
 * @param onFlash - ripple effect callback on send button click
 */
export function FeedbackPage({ onFlash }: FeedbackPageProps) {
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
      setTimeout(() => setStatus('idle'), 3000);
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
