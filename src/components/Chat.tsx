import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Titlebar } from './Titlebar';
import { Sidebar } from './Sidebar';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { SnowBackground } from './SnowBackground';
import { SettingsPage } from './Settings';
import { Diamond } from './Diamond';
import { useChat } from '../hooks/useChat';
import { useShortcuts } from '../hooks/useShortcuts';
import '../styles/chat.css';

export type SettingsPageId = 'shortcuts' | 'personalize' | 'language' | 'feedback' | 'archive';

interface ChatProps {
  onReauth?: () => void;
}

const DIAMOND_ANIM_DURATION = 10_000;

export function Chat({ onReauth }: ChatProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPageId | null>(null);
  const [diamondGlow, setDiamondGlow] = useState(false);
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSettingsRef = useRef<SettingsPageId | null>(null);
  const {
    sessions,
    archivedSessions,
    activeSession,
    activeSessionId,
    sendMessage,
    isStreaming,
    addSession,
    switchSession,
    deleteSession,
    renameSession,
    archiveSession,
  } = useChat();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const shortcutActions = useMemo(() => ({
    onNewSession: () => { addSession(); setSettingsPage(null); },
    onArchiveSession: () => { if (activeSessionId !== '__draft__') archiveSession(activeSessionId); },
    onPrevSession: () => {
      const idx = sessions.findIndex((s) => s.id === activeSessionId);
      if (idx > 0) switchSession(sessions[idx - 1].id);
    },
    onNextSession: () => {
      const idx = sessions.findIndex((s) => s.id === activeSessionId);
      if (idx >= 0 && idx < sessions.length - 1) switchSession(sessions[idx + 1].id);
    },
    onDeleteSession: () => {
      if (activeSessionId !== '__draft__') deleteSession(activeSessionId);
    },
    onAttachFile: () => fileInputRef.current?.click(),
    onStopStreaming: () => { invoke('abort_stream').catch(() => {}); },
    isStreaming,
    sessions,
    activeSessionId,
  }), [addSession, sessions, activeSessionId, switchSession, deleteSession, archiveSession, isStreaming]);

  const { addToHistory, getPreviousSent, getNextSent, resetHistoryIndex } = useShortcuts(shortcutActions);

  const handleSendMessage = useCallback((text: string) => {
    addToHistory(text);
    resetHistoryIndex();
    sendMessage(text);
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
          onNewSession={() => { addSession(); setSettingsPage(null); triggerDiamondGlow(); }}
          onSwitchSession={handleSwitchSession}
          onDeleteSession={deleteSession}
          onArchiveSession={archiveSession}
          onRenameSession={renameSession}
          onSelectSettingsPage={(page) => setSettingsPage(page)}
          onReauth={onReauth ?? (() => {})}
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
        </button>
        {settingsPage !== null ? (
          <SettingsPage
            page={settingsPage}
            onClose={() => setSettingsPage(null)}
            sessions={archivedSessions}
            onSwitchSession={(id) => { handleSwitchSession(id); setSettingsPage(null); }}
          />
        ) : (
          <>
            <MessageList messages={activeSession.messages} />
            <MessageInput
              onSend={handleSendMessage}
              disabled={isStreaming}
              isStreaming={isStreaming}
              onStop={() => invoke('abort_stream').catch(() => {})}
              onHistoryUp={getPreviousSent}
              onHistoryDown={getNextSent}
              fileInputRef={fileInputRef}
            />
          </>
        )}
      </div>
    </div>
  );
}
