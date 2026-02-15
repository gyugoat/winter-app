import { useState, useEffect, useRef, useCallback } from 'react';
import { Titlebar } from './Titlebar';
import { Sidebar } from './Sidebar';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { SnowBackground } from './SnowBackground';
import { SettingsPage } from './Settings';
import { Diamond } from './Diamond';
import { useChat } from '../hooks/useChat';
import '../styles/chat.css';

export type SettingsPageId = 'shortcuts' | 'personalize' | 'language' | 'feedback';

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
    activeSession,
    activeSessionId,
    sendMessage,
    isStreaming,
    addSession,
    switchSession,
    deleteSession,
    renameSession,
  } = useChat();

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
          />
        ) : (
          <>
            <MessageList messages={activeSession.messages} />
            <MessageInput onSend={sendMessage} disabled={isStreaming} />
          </>
        )}
      </div>
    </div>
  );
}
