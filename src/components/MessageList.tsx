/**
 * MessageList — virtualized (paginated) list of chat messages.
 *
 * Renders messages in reverse order (newest at top — CSS flex-direction: column-reverse).
 * Markdown is rendered off-thread via useMarkdownWorker and cached by message ID.
 * Search highlighting is applied as a post-process over the rendered HTML.
 *
 * Pagination: shows the 10 most recent messages, with "show more" to load older ones.
 * TypewriterStatus handles the animated "thinking..." status text during streaming.
 */
import { useEffect, useRef, useMemo, useState, useCallback, memo } from 'react';
import { useI18n } from '../i18n';
import { useMarkdownWorker } from '../hooks/useMarkdownWorker';
import type { Message } from '../types';
import { ToolActivityList } from './ToolActivity';
import '../styles/messages.css';

function TypewriterStatus({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('');
  const [phase, setPhase] = useState<'typing' | 'hold' | 'erasing'>('typing');
  const textRef = useRef(text);
  const phaseRef = useRef(phase);
  const displayedRef = useRef('');

  useEffect(() => {
    if (text !== textRef.current) {
      textRef.current = text;
      setPhase('erasing');
    }
  }, [text]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const currentPhase = phaseRef.current;
      const currentDisplayed = displayedRef.current;
      const target = textRef.current;

      if (currentPhase === 'typing') {
        if (currentDisplayed.length < target.length) {
          const next = target.slice(0, currentDisplayed.length + 1);
          setDisplayed(next);
          timer = setTimeout(tick, 30);
        } else {
          setPhase('hold');
          timer = setTimeout(tick, 800);
        }
      } else if (currentPhase === 'hold') {
        setPhase('erasing');
        timer = setTimeout(tick, 0);
      } else {
        if (currentDisplayed.length > 0) {
          const next = currentDisplayed.slice(0, -1);
          setDisplayed(next);
          timer = setTimeout(tick, 15);
        } else {
          setPhase('typing');
          timer = setTimeout(tick, 0);
        }
      }
    };

    timer = setTimeout(tick, 30);
    return () => clearTimeout(timer);
  }, []);

  return (
    <span className="status-label">
      {displayed}
      {phase !== 'erasing' && <span>...</span>}
    </span>
  );
}

interface MessageListProps {
  messages: Message[];
  searchQuery?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightText(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const safeText = escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safeText.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '<mark class="search-highlight">$1</mark>'
  );
}

function highlightHtml(html: string, query: string): string {
  if (!query) return html;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_match, tag: string, text: string) => {
    if (tag) return tag;
    return text.replace(re, '<mark class="search-highlight">$1</mark>');
  });
}

function InnerVoice({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false);
  const reasoning = msg.reasoning;
  const tools = msg.toolActivities;
  const hasReasoning = !!reasoning;
  const hasTools = !!tools && tools.length > 0;
  if (!hasReasoning && !hasTools) return null;
  return (
    <div className="inner-voice">
      <button
        className="inner-voice-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="inner-voice-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="inner-voice-label">Inner voice</span>
        <span className={`inner-voice-chevron${open ? ' open' : ''}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="inner-voice-content">
          {hasReasoning && <div className="inner-voice-reasoning">{reasoning}</div>}
          {hasTools && <ToolActivityList tools={tools} />}
        </div>
      )}
    </div>
  );
}

interface MessageRowProps {
  msg: Message;
  searchQuery: string;
  html: string | null;
}

const MessageRow = memo(function MessageRow({ msg, searchQuery, html }: MessageRowProps) {
  const isStatusOnly = !!(msg.statusText && msg.isStreaming && !msg.content);
  const isStreamingContent = !!(msg.isStreaming && msg.content);

  return (
    <div className={`message-row ${msg.role}`}>
      {msg.role === 'assistant' && (
        <div className="message-avatar">
          <div className={`message-diamond${msg.isStreaming ? ' spinning' : ''}`} />
        </div>
      )}
      <div>
        {isStatusOnly ? (
          <div className="message-bubble message-status">
            <TypewriterStatus text={msg.statusText!} />
          </div>
        ) : html ? (
          <div className={`message-bubble message-bubble-markdown${isStreamingContent ? ' streaming' : ''}`}>
            <div dangerouslySetInnerHTML={{ __html: html }} />
            {msg.statusText && msg.isStreaming && (
              <div className="message-inline-status">{msg.statusText}</div>
            )}
          </div>
        ) : searchQuery ? (
          <div
            className="message-bubble"
            dangerouslySetInnerHTML={{ __html: highlightText(msg.content, searchQuery) }}
          />
        ) : (
          <div className={`message-bubble${isStreamingContent ? ' streaming' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
        )}
        {msg.role === 'assistant' && <InnerVoice msg={msg} />}
        <div className={`message-time${msg.role === 'user' ? ' user' : ''}`}>
          {formatTime(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.msg.id === next.msg.id &&
  prev.msg.content === next.msg.content &&
  prev.msg.isStreaming === next.msg.isStreaming &&
  prev.msg.statusText === next.msg.statusText &&
  prev.msg.reasoning === next.msg.reasoning &&
  JSON.stringify(prev.msg.toolActivities) === JSON.stringify(next.msg.toolActivities) &&
  prev.searchQuery === next.searchQuery &&
  prev.html === next.html
);

const PAGE_SIZE = 10;
const LOAD_MORE_SIZE = 10;

export function MessageList({ messages, searchQuery = '' }: MessageListProps) {
  const { t } = useI18n();
  const { render: renderMarkdown } = useMarkdownWorker();
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionKeyRef = useRef<string | undefined>(undefined);
  const [maxVisible, setMaxVisible] = useState(PAGE_SIZE);

  const currentSessionKey = messages[0]?.id;

  useEffect(() => {
    if (currentSessionKey !== sessionKeyRef.current) {
      sessionKeyRef.current = currentSessionKey;
      setMaxVisible(PAGE_SIZE);
    }
  }, [currentSessionKey]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.code-copy-btn') as HTMLElement | null;
      if (!btn) return;
      const encoded = btn.getAttribute('data-code');
      if (!encoded) return;
      navigator.clipboard.writeText(decodeURIComponent(encoded)).then(() => {
        btn.textContent = t('copied');
        btn.setAttribute('data-state', 'copied');
        setTimeout(() => {
          btn.textContent = t('copy');
          btn.removeAttribute('data-state');
        }, 2000);
      });
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [t]);

  useEffect(() => {
    document.querySelectorAll('.code-copy-btn').forEach((btn) => {
      if (btn.getAttribute('data-state') !== 'copied') {
        btn.textContent = t('copy');
      }
    });
  }, [t]);

  const filteredMessages = useMemo(
    () => searchQuery
      ? messages.filter((msg) => msg.content.toLowerCase().includes(searchQuery.toLowerCase()))
      : messages,
    [messages, searchQuery]
  );

  useEffect(() => {
    if (currentSessionKey === sessionKeyRef.current && filteredMessages.length > maxVisible) {
      setMaxVisible(filteredMessages.length);
    }
  }, [filteredMessages.length, maxVisible, currentSessionKey]);

  const displayCount = Math.min(maxVisible, filteredMessages.length);
  const hasMore = filteredMessages.length > displayCount;

  const visibleMessages = useMemo(
    () => {
      if (displayCount === 0) return [];
      const sliced = filteredMessages.slice(filteredMessages.length - displayCount);
      return [...sliced].reverse();
    },
    [filteredMessages, displayCount]
  );

  const handleShowMore = useCallback(() => {
    setMaxVisible((prev) => prev + LOAD_MORE_SIZE);
  }, []);

  if (messages.length === 0) {
    return (
      <div className="message-list">
        <div className="message-empty">
          <div className="message-empty-diamond" />
          <span className="message-empty-text">{t('emptyState')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      <div ref={bottomRef} />
      {visibleMessages.map((msg) => {
        // Skip empty assistant ghosts — no content, not streaming, no status label
        if (msg.role === 'assistant' && !msg.content && !msg.isStreaming && !msg.statusText) {
          return null;
        }
        const needsMarkdown = msg.role === 'assistant' && !!msg.content;
        const cacheKey = msg.isStreaming ? `${msg.id}:${msg.content.length}` : msg.id;
        const rawHtml = needsMarkdown ? renderMarkdown(cacheKey, msg.content) : null;
        const html = rawHtml && searchQuery ? highlightHtml(rawHtml, searchQuery) : rawHtml;
        return <MessageRow key={msg.id} msg={msg} searchQuery={searchQuery} html={html} />;
      })}
      {hasMore && (
        <button className="message-show-more" onClick={handleShowMore}>
          {t('showMore')} ({filteredMessages.length - maxVisible})
        </button>
      )}
    </div>
  );
}
