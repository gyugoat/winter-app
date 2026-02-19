/**
 * MessageInput — the primary text entry bar at the bottom of the chat.
 *
 * Handles:
 * - Auto-growing textarea (max 120px height)
 * - Image attachments via paste, drag-drop, or file picker
 * - Send on Enter (Shift+Enter = newline), Ctrl+↑/↓ for message history
 * - Stop button while streaming
 * - Mode selector pill for Normal / Search / Analyze
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickFlash } from '../hooks/useClickFlash';
import { useI18n } from '../i18n';
import type { ImageAttachment, MessageMode } from '../types';
import '../styles/input.css';

interface MessageInputProps {
  /** Called when the user submits a message */
  onSend: (text: string, images?: ImageAttachment[], mode?: MessageMode) => void;
  /** When true, the input is read-only (AI is responding) */
  disabled?: boolean;
  /** True while the AI is streaming — shows stop button instead of send */
  isStreaming?: boolean;
  /** Aborts the current stream */
  onStop?: () => void;
  /** Returns the previous sent message for Ctrl+↑ history */
  onHistoryUp?: () => string | null;
  /** Returns the next sent message for Ctrl+↓ history */
  onHistoryDown?: () => string | null;
  /** Optional shared ref so the parent can programmatically trigger the file picker */
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Receives a focus() callback so the parent can focus this input via keyboard shortcuts */
  onFocusReady?: (fn: () => void) => void;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Labels for each mode option — emoji kept simple for cross-platform rendering */
const MODE_OPTIONS: { value: MessageMode; label: string; title: string }[] = [
  { value: 'normal', label: 'Normal', title: 'Standard chat mode' },
  { value: 'search', label: '🔍 Search', title: 'Search mode — injects a search prefix' },
  { value: 'analyze', label: '🧠 Analyze', title: 'Analysis mode — injects an analysis prefix' },
];

/**
 * Converts a File to a base64-encoded ImageAttachment.
 * Returns null if the file exceeds the 5 MB limit.
 */
function fileToBase64(file: File): Promise<ImageAttachment | null> {
  if (file.size > MAX_IMAGE_SIZE) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({ mediaType: file.type || 'image/png', data: base64 });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** The main message composition bar with mode selector, textarea, image previews, and send/stop button */
export function MessageInput({ onSend, disabled, isStreaming, onStop, onHistoryUp, onHistoryDown, fileInputRef: externalFileRef, onFocusReady }: MessageInputProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [mode, setMode] = useState<MessageMode>('normal');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const internalFileRef = useRef<HTMLInputElement>(null);
  const fileInputRef = externalFileRef ?? internalFileRef;

  useEffect(() => {
    if (onFocusReady) {
      onFocusReady(() => textareaRef.current?.focus());
    }
  }, [onFocusReady]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && attachedImages.length === 0) || disabled) return;
    onSend(trimmed, attachedImages.length > 0 ? attachedImages : undefined, mode);
    setText('');
    setAttachedImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, attachedImages, onSend, disabled, mode]);

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

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const results = await Promise.all(imageFiles.map(fileToBase64));
    const newImages = results.filter((r): r is ImageAttachment => r !== null);
    if (newImages.length > 0) {
      setAttachedImages((prev) => [...prev, ...newImages]);
    }
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[];
    processFiles(files);
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files) processFiles(files);
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) processFiles(files);
    e.target.value = '';
  }, [processFiles]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div className="input-bar" onDrop={handleDrop} onDragOver={handleDragOver}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        hidden
        multiple
        onChange={handleFileChange}
      />
      {/* Mode selector pill — subtle toggle above the input bubble */}
      <div className="input-mode-bar">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`input-mode-btn${mode === opt.value ? ' active' : ''}`}
            onClick={() => setMode(opt.value)}
            title={opt.title}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="input-bubble">
        {attachedImages.length > 0 && (
          <div className="input-image-previews">
            {attachedImages.map((img, i) => (
              <div key={i} className="input-image-thumb">
                <img src={`data:${img.mediaType};base64,${img.data}`} alt="" />
                <button className="input-image-remove" onClick={(e) => { onFlash(e); removeImage(i); }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="input-field"
          placeholder={t('inputPlaceholder')}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
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
