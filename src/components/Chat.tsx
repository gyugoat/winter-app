import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Titlebar } from './Titlebar';
import { Sidebar } from './Sidebar';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { SnowBackground } from './SnowBackground';
import { SettingsPage } from './Settings';
import { Diamond } from './Diamond';
import { useClickFlash } from '../hooks/useClickFlash';
import { useChat } from '../hooks/useChat';
import { useShortcuts } from '../hooks/useShortcuts';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import '../styles/chat.css';

export type SettingsPageId = 'shortcuts' | 'personalize' | 'language' | 'feedback' | 'archive' | 'ollama';

interface ChatProps {
  onReauth?: () => void;
  onShowReadme?: () => void;
}

const DIAMOND_ANIM_DURATION = 10_000;
const TOAST_VISIBLE_MS = 1100;
const TOAST_DROP_MS = 400;

export function Chat({ onReauth, onShowReadme }: ChatProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPageId | null>(null);
  const [diamondGlow, setDiamondGlow] = useState(false);
  const [toast, setToast] = useState<{ text: string; dropping: boolean } | null>(null);
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSettingsRef = useRef<SettingsPageId | null>(null);
  const inputFocusRef = useRef<() => void>(() => {});
  const {
    sessions,
    archivedSessions,
    activeSession,
    activeSessionId,
    sendMessage,
    isStreaming,
    usage,
    addSession,
    switchSession,
    deleteSession,
    renameSession,
    archiveSession,
  } = useChat();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((key: TranslationKey) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text: t(key), dropping: false });
    toastTimerRef.current = setTimeout(() => {
      setToast((prev) => prev ? { ...prev, dropping: true } : null);
      toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DROP_MS);
    }, TOAST_VISIBLE_MS);
  }, [t]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        setSearchQuery('');
      }
      return !prev;
    });
  }, []);

  const shortcutActions = useMemo(() => ({
    onNewSession: () => { addSession(); setSettingsPage(null); showToast('toastNewSession'); },
    onArchiveSession: () => {
      if (activeSessionId !== '__draft__') {
        archiveSession(activeSessionId);
        showToast('toastArchived');
      }
    },
    onPrevSession: () => {
      const idx = sessions.findIndex((s) => s.id === activeSessionId);
      if (idx > 0) switchSession(sessions[idx - 1].id);
    },
    onNextSession: () => {
      const idx = sessions.findIndex((s) => s.id === activeSessionId);
      if (idx >= 0 && idx < sessions.length - 1) switchSession(sessions[idx + 1].id);
    },
    onDeleteSession: () => {
      if (activeSessionId !== '__draft__') {
        deleteSession(activeSessionId);
        showToast('toastDeleted');
      }
    },
    onAttachFile: () => fileInputRef.current?.click(),
    onStopStreaming: () => { invoke('abort_stream').catch(() => {}); },
    onFocusInput: () => inputFocusRef.current(),
    onSearch: toggleSearch,
    isStreaming,
    sessions,
    activeSessionId,
  }), [addSession, sessions, activeSessionId, switchSession, deleteSession, archiveSession, isStreaming, showToast, toggleSearch]);

  const { addToHistory, getPreviousSent, getNextSent, resetHistoryIndex } = useShortcuts(shortcutActions);

  const handleSendMessage = useCallback((text: string, images?: import('../types').ImageAttachment[]) => {
    addToHistory(text);
    resetHistoryIndex();
    sendMessage(text, images);
  }, [sendMessage, addToHistory, resetHistoryIndex]);

  const triggerDiamondGlow = useCallback(() => {
    setDiamondGlow(true);
    if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    glowTimerRef.current = setTimeout(() => setDiamondGlow(false), DIAMOND_ANIM_DURATION);
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') triggerDiamondGlow();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [triggerDiamondGlow]);

  useEffect(() => {
    if (prevSettingsRef.current !== null && settingsPage === null) {
      triggerDiamondGlow();
    }
    prevSettingsRef.current = settingsPage;
  }, [settingsPage, triggerDiamondGlow]);

  const handleSwitchSession = (id: string) => {
    switchSession(id);
    setSettingsPage(null);
    setSearchOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="chat-layout">
      <Titlebar />
      <div className={`chat-body${sidebarOpen ? ' sidebar-open' : ' sidebar-collapsed'}`}>
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onNewSession={() => { addSession(); setSettingsPage(null); triggerDiamondGlow(); showToast('toastNewSession'); }}
          onSwitchSession={handleSwitchSession}
          onDeleteSession={(id) => { deleteSession(id); showToast('toastDeleted'); }}
          onArchiveSession={(id) => { archiveSession(id); showToast('toastArchived'); }}
          onRenameSession={renameSession}
          onSelectSettingsPage={(page) => setSettingsPage(page)}
          onReauth={onReauth ?? (() => {})}
          onShowReadme={onShowReadme ?? (() => {})}
        />
        <SnowBackground />
        <button
          className="chat-brand"
          onClick={() => setSettingsPage(null)}
        >
          Winter
          <Diamond
            size={12}
            glow={diamondGlow}
            className={`chat-brand-diamond${diamondGlow ? ' chat-brand-diamond-animate' : ''}`}
          />
          <span className="chat-brand-dot">.</span>
          {toast && (
            <span className={`chat-toast${toast.dropping ? ' dropping' : ''}`}>
              {toast.text}
            </span>
          )}
          {(usage.input > 0 || usage.output > 0) && (
            <span className="chat-usage">
              {usage.input.toLocaleString()} / {usage.output.toLocaleString()}
            </span>
          )}
        </button>
        {searchOpen && (
          <div className="chat-search-bar">
            <svg className="chat-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              className="chat-search-input"
              type="text"
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); } }}
            />
            <button className="chat-search-close" onClick={(e) => { onFlash(e); setSearchOpen(false); setSearchQuery(''); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        {settingsPage !== null ? (
          <SettingsPage
            page={settingsPage}
            onClose={() => setSettingsPage(null)}
            sessions={archivedSessions}
            onSwitchSession={(id) => { handleSwitchSession(id); setSettingsPage(null); }}
          />
        ) : (
          <>
            <MessageList messages={activeSession.messages} searchQuery={searchQuery} />
            <MessageInput
              onSend={handleSendMessage}
              disabled={isStreaming}
              isStreaming={isStreaming}
              onStop={() => invoke('abort_stream').catch(() => {})}
              onHistoryUp={getPreviousSent}
              onHistoryDown={getNextSent}
              fileInputRef={fileInputRef}
              onFocusReady={(fn) => { inputFocusRef.current = fn; }}
            />
          </>
        )}
      </div>
    </div>
  );
}
