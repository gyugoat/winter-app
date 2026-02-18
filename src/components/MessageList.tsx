import { useEffect, useRef, useMemo, useState, useCallback, memo } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import { useI18n } from '../i18n';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import jsonLang from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import yamlLang from 'highlight.js/lib/languages/yaml';
import markdownLang from 'highlight.js/lib/languages/markdown';
import type { Message } from '../types';
import '../styles/messages.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', jsonLang);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yamlLang);
hljs.registerLanguage('yml', yamlLang);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('md', markdownLang);

const marked = new Marked({
  breaks: true,
  gfm: true,
});

const renderer = {
  code({ text, lang }: { text: string; lang?: string | undefined }) {
    const language = lang && hljs.getLanguage(lang) ? lang : '';
    const highlighted = language
      ? hljs.highlight(text, { language }).value
      : hljs.highlightAuto(text).value;
    const encoded = encodeURIComponent(text);
    return `<div class="code-block-wrap"><div class="code-block-header"><span class="code-block-lang">${language || 'text'}</span><button class="code-copy-btn" data-code="${encoded}">Copy</button></div><pre><code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre></div>`;
  },
};

marked.use({ renderer });

interface MessageListProps {
  messages: Message[];
  searchQuery?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMarkdown(content: string): string {
  const raw = marked.parse(content);
  if (typeof raw !== 'string') return '';
  return DOMPurify.sanitize(raw);
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

const MessageRow = memo(function MessageRow({ msg, searchQuery }: { msg: Message; searchQuery: string }) {
  const html = useMemo(() => {
    if (msg.isStreaming) return null;
    if (msg.role !== 'assistant' || !msg.content) return null;
    const rendered = renderMarkdown(msg.content);
    return searchQuery ? highlightText(rendered, searchQuery) : rendered;
  }, [msg.role, msg.content, msg.isStreaming, searchQuery]);

  return (
    <div className={`message-row ${msg.role}`}>
      {msg.role === 'assistant' && (
        <div className="message-avatar">
          <div className="message-diamond" />
        </div>
      )}
      <div>
        {msg.statusText && msg.isStreaming && !msg.content ? (
          <div className="message-bubble message-status">
            {msg.statusText === 'thinking' ? (
              <span className="thinking-dots"><span /><span /><span /></span>
            ) : (
              <span className="status-label">{msg.statusText}</span>
            )}
          </div>
        ) : html ? (
          <div className="message-bubble message-bubble-markdown">
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
          <div className="message-bubble">{msg.content}</div>
        )}
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
  prev.searchQuery === next.searchQuery
);

const PAGE_SIZE = 10;
const LOAD_MORE_SIZE = 10;

export function MessageList({ messages, searchQuery = '' }: MessageListProps) {
  const { t } = useI18n();
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionKeyRef = useRef<string | undefined>(undefined);
  const [maxVisible, setMaxVisible] = useState(PAGE_SIZE);
  const [renderCount, setRenderCount] = useState(PAGE_SIZE);

  const currentSessionKey = messages[0]?.id;

  useEffect(() => {
    if (currentSessionKey !== sessionKeyRef.current) {
      sessionKeyRef.current = currentSessionKey;
      setMaxVisible(PAGE_SIZE);
      setRenderCount(1);
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

  const pageLimit = Math.min(maxVisible, filteredMessages.length);

  useEffect(() => {
    if (renderCount >= pageLimit) return;
    const id = requestAnimationFrame(() => {
      setRenderCount(prev => prev + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [renderCount, pageLimit]);

  useEffect(() => {
    if (currentSessionKey === sessionKeyRef.current && filteredMessages.length > maxVisible) {
      setMaxVisible(filteredMessages.length);
      setRenderCount(filteredMessages.length);
    }
  }, [filteredMessages.length, maxVisible, currentSessionKey]);

  const displayCount = Math.min(renderCount, pageLimit);
  const hasMore = filteredMessages.length > maxVisible;

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
      {visibleMessages.map((msg) => (
        <MessageRow key={msg.id} msg={msg} searchQuery={searchQuery} />
      ))}
      {hasMore && (
        <button className="message-show-more" onClick={handleShowMore}>
          {t('showMore')} ({filteredMessages.length - maxVisible})
        </button>
      )}
    </div>
  );
}
