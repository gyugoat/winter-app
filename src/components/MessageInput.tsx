import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickFlash } from '../hooks/useClickFlash';
import { useI18n } from '../i18n';
import '../styles/input.css';

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  onHistoryUp?: () => string | null;
  onHistoryDown?: () => string | null;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
  onFocusReady?: (fn: () => void) => void;
}

export function MessageInput({ onSend, disabled, isStreaming, onStop, onHistoryUp, onHistoryDown, fileInputRef: externalFileRef, onFocusReady }: MessageInputProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const internalFileRef = useRef<HTMLInputElement>(null);
  const fileInputRef = externalFileRef ?? internalFileRef;

  useEffect(() => {
    if (onFocusReady) {
      onFocusReady(() => textareaRef.current?.focus());
    }
  }, [onFocusReady]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'ArrowUp' && onHistoryUp) {
      e.preventDefault();
      const prev = onHistoryUp();
      if (prev !== null) setText(prev);
    }
    if (ctrl && e.key === 'ArrowDown' && onHistoryDown) {
      e.preventDefault();
      const next = onHistoryDown();
      if (next !== null) setText(next);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  return (
    <div className="input-bar">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        hidden
        multiple
      />
      <div className="input-bubble">
        <textarea
          ref={textareaRef}
          className="input-field"
          placeholder={t('inputPlaceholder')}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <div className="input-actions">
          <button
            className="input-attach"
            onClick={(e) => { onFlash(e); fileInputRef.current?.click(); }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {isStreaming ? (
            <button
              className="input-send input-stop"
              onClick={(e) => { onFlash(e); onStop?.(); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className="input-send"
              onClick={(e) => { onFlash(e); handleSend(); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
