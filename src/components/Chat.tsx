/**
 * Chat — the main application shell.
 *
 * Orchestrates the full chat experience:
 * - Sidebar (session management)
 * - MessageList + MessageInput (conversation)
 * - FileChanges side panel (git diff viewer)
 * - FileViewer tab bar (file content viewer)
 * - SettingsPage overlay
 * - QuestionDock (AI-driven question prompts)
 * - Search bar
 * - Toast notifications
 * - Diamond brand mark with glow animation
 */
import { useState, useEffect, useRef, useCallback, useMemo, useTransition, type ChangeEvent } from 'react';
import { invoke } from '../utils/invoke-shim';
import { Titlebar } from './Titlebar';
import { Sidebar } from './Sidebar';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { SnowBackground } from './SnowBackground';
import { SettingsPage } from './settings';
import { Diamond } from './Diamond';
import { FileChanges } from './FileChanges';
import { FileViewer } from './FileViewer';
import { ErrorBoundary } from './ErrorBoundary';
import { useClickFlash } from '../hooks/useClickFlash';
import { useChat } from '../hooks/useChat';
import { useShortcuts } from '../hooks/useShortcuts';
import { useQuestion } from '../hooks/useQuestion';
import { useAgents } from '../hooks/useAgents';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { MessageMode } from '../types';
import { QuestionDock } from './QuestionDock';
import { AgentBar } from './AgentBar';
import '../styles/chat.css';

export type SettingsPageId = 'shortcuts' | 'personalize' | 'language' | 'feedback' | 'archive' | 'ollama' | 'folder' | 'automation';

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
  const [settingsTrigger, setSettingsTrigger] = useState(0);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesDetached, setChangesDetached] = useState(false);
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
    isDraft,
    sendMessage,
    isStreaming,
    streamingSessionId,
    addSession,
    switchSession,
    deleteSession,
    renameSession,
    archiveSession,
    reorderSessions,
    abortOpencode,
    reloadSessions,
    busySessions,
    unreadSessions,
    markSessionRead,
  } = useChat();

  const [workingDirectory, setWorkingDirectory] = useState('');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleEditValue, setTitleEditValue] = useState('');

  useEffect(() => {
    invoke<string>('get_working_directory').then(setWorkingDirectory).catch(() => {});
  }, []);

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

  const handleChangeDirectory = useCallback((dir: string) => {
    invoke('set_working_directory', { directory: dir })
      .then(() => {
        setWorkingDirectory(dir);
        reloadSessions();
      })
      .catch((err) => console.error('Failed to set directory:', err));
  }, [reloadSessions]);

  const handleOpenFile = useCallback((filePath: string | null) => {
    if (!filePath) { setActiveTab(null); return; }
    setOpenTabs((prev) => prev.includes(filePath) ? prev : [...prev, filePath]);
    setActiveTab(filePath);
  }, []);

  const handleCloseTab = useCallback((filePath: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((p) => p !== filePath);
      if (activeTab === filePath) {
        const idx = prev.indexOf(filePath);
        const neighbor = next[Math.min(idx, next.length - 1)] ?? null;
        setActiveTab(neighbor);
      }
      return next;
    });
  }, [activeTab]);

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
      if (idx > 0) {
        switchSession(sessions[idx - 1].id);
      } else if (idx === -1 && sessions.length > 0) {
        // draft → jump to first (top) session
        switchSession(sessions[0].id);
      }
    },
    onNextSession: () => {
      const idx = sessions.findIndex((s) => s.id === activeSessionId);
      if (idx >= 0 && idx < sessions.length - 1) {
        switchSession(sessions[idx + 1].id);
      } else if (idx === -1 && sessions.length > 0) {
        // draft → jump to last (bottom) session
        switchSession(sessions[sessions.length - 1].id);
      }
    },
    onDeleteSession: () => {
      if (activeSessionId !== '__draft__') {
        deleteSession(activeSessionId);
        showToast('toastDeleted');
      }
    },
    onAttachFile: () => fileInputRef.current?.click(),
    onStopStreaming: () => abortOpencode(),
    onFocusInput: () => inputFocusRef.current(),
    onSearch: toggleSearch,
    onToggleSidebar: () => setSidebarOpen((prev) => !prev),
    onToggleSettings: () => { setSidebarOpen(true); setSettingsTrigger((n) => n + 1); },
    isStreaming,
    sessions,
    activeSessionId,
  }), [addSession, sessions, activeSessionId, switchSession, deleteSession, archiveSession, isStreaming, showToast, toggleSearch, abortOpencode]);

  const { addToHistory, getPreviousSent, getNextSent, resetHistoryIndex } = useShortcuts(shortcutActions);
  const { pending: pendingQuestion, reply: replyQuestion, reject: rejectQuestion } = useQuestion(
    activeSession.ocSessionId,
    isStreaming
  );

  const handleReplyQuestion = useCallback((requestID: string, answers: string[][]) => {
    replyQuestion(requestID, answers);
  }, [replyQuestion]);

  const handleSendMessage = useCallback((text: string, images?: import('../types').ImageAttachment[], mode?: MessageMode) => {
    addToHistory(text);
    resetHistoryIndex();
    sendMessage(text, images, mode);
  }, [sendMessage, addToHistory, resetHistoryIndex]);

  const agentState = useAgents();

  const triggerDiamondGlow = useCallback(() => {
    setDiamondGlow(true);
    if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    glowTimerRef.current = setTimeout(() => setDiamondGlow(false), DIAMOND_ANIM_DURATION);
  }, []);

  const handleAgentSwitch = useCallback(() => {
    abortOpencode();
    reloadSessions();
    triggerDiamondGlow();
  }, [abortOpencode, reloadSessions, triggerDiamondGlow]);

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

  // Augment messages: if the active session is busy (streaming from server),
  // mark the last assistant message as isStreaming so the diamond spins in chat too.
  const augmentedMessages = useMemo(() => {
    const msgs = activeSession.messages;
    if (!msgs.length) return msgs;
    const ocSessionId = activeSession.ocSessionId;
    const isBusy = ocSessionId ? busySessions.has(ocSessionId) : false;
    // Also consider our own streaming (streamingSessionId matches)
    const isOwnStream = isStreaming && streamingSessionId === activeSession.id;
    if (!isBusy && !isOwnStream) return msgs;
    // If already has a streaming message, no augmentation needed
    if (msgs.some((m) => m.isStreaming)) return msgs;
    // Find last assistant message and mark it as streaming
    const lastIdx = msgs.length - 1;
    for (let i = lastIdx; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        const copy = [...msgs];
        copy[i] = { ...copy[i], isStreaming: true };
        return copy;
      }
    }
    return msgs;
  }, [activeSession.messages, activeSession.ocSessionId, busySessions, isStreaming, streamingSessionId, activeSession.id]);

  const [, startTransition] = useTransition();
  const handleSwitchSession = (id: string) => {
    startTransition(() => {
      switchSession(id);
    });
    setSettingsPage(null);
    setSearchOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="chat-layout">
      <Titlebar />
      <AgentBar agents={agentState} onSwitch={handleAgentSwitch} />
      <div className={`chat-body${sidebarOpen ? ' sidebar-open' : ' sidebar-collapsed'}${changesOpen && !changesDetached ? ' changes-open' : ''}`}>
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          sessions={sessions}
          activeSessionId={activeSessionId}
          streamingSessionId={streamingSessionId}
          busySessions={busySessions}
          openSettingsTrigger={settingsTrigger}
          unreadSessions={unreadSessions}
          onNewSession={() => { addSession(); setSettingsPage(null); triggerDiamondGlow(); showToast('toastNewSession'); }}
          onSwitchSession={(id) => { handleSwitchSession(id); markSessionRead(id); }}
          onDeleteSession={(id) => { deleteSession(id); showToast('toastDeleted'); }}
          onArchiveSession={(id) => { archiveSession(id); showToast('toastArchived'); }}
          onRenameSession={renameSession}
          onReorderSessions={reorderSessions}
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
            <span role="status" aria-live="polite" className={`chat-toast${toast.dropping ? ' dropping' : ''}`}>
              {toast.text}
            </span>
          )}
        </button>
        <button
          className={`fc-toggle-btn${changesOpen ? ' active' : ''}`}
          onClick={(e) => { onFlash(e); setChangesOpen(!changesOpen); }}
          aria-label="Toggle file changes"
          style={{ position: 'absolute', top: 14, right: 16, zIndex: 2 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
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
        {openTabs.length > 0 && (
          <div className="tab-bar">
            <button
              className={`tab-item${activeTab === null ? ' active' : ''}`}
              onClick={() => setActiveTab(null)}
            >
              <span className="tab-label">Chat</span>
            </button>
            {openTabs.map((fp) => (
              <button
                key={fp}
                className={`tab-item${activeTab === fp ? ' active' : ''}`}
                onClick={() => setActiveTab(fp)}
              >
                <span className="tab-label">{fp.split('/').pop()}</span>
                <span
                  className="tab-close"
                  onClick={(e) => { e.stopPropagation(); handleCloseTab(fp); }}
                  role="button"
                  aria-label={`Close ${fp.split('/').pop()}`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        )}
        {settingsPage !== null ? (
          <SettingsPage
            page={settingsPage}
            onClose={() => setSettingsPage(null)}
            onNavigate={(page) => setSettingsPage(page)}
            sessions={archivedSessions}
            onSwitchSession={(id) => { handleSwitchSession(id); setSettingsPage(null); }}
            workingDirectory={workingDirectory}
            onChangeDirectory={(dir) => { handleChangeDirectory(dir); setSettingsPage(null); }}
          />
        ) : activeTab ? (
          <ErrorBoundary>
            <FileViewer
              filePath={activeTab}
              homePath={workingDirectory}
            />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary>
            {activeSession.name && (
              <div className="chat-session-title">
                {isDraft ? (
                  <span className="chat-session-title-text chat-session-title-text--draft">
                    {activeSession.name}
                  </span>
                ) : editingTitle ? (
                  <input
                    className="chat-session-title-input"
                    value={titleEditValue}
                    onChange={(e) => setTitleEditValue(e.target.value)}
                    onBlur={() => {
                      if (titleEditValue.trim() && titleEditValue.trim() !== activeSession.name) {
                        renameSession(activeSessionId, titleEditValue.trim());
                      }
                      setEditingTitle(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter') {
                        if (titleEditValue.trim() && titleEditValue.trim() !== activeSession.name) {
                          renameSession(activeSessionId, titleEditValue.trim());
                        }
                        setEditingTitle(false);
                      }
                      if (e.key === 'Escape') {
                        setEditingTitle(false);
                      }
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="chat-session-title-text"
                    onClick={() => { setEditingTitle(true); setTitleEditValue(activeSession.name); }}
                    title="Click to rename"
                  >
                    {activeSession.name}
                  </span>
                )}
                {workingDirectory && (
                  <button
                    className="chat-folder-label"
                    onClick={() => setSettingsPage('folder')}
                    title={workingDirectory}
                  >
                    {workingDirectory.split('/').pop() || workingDirectory}
                  </button>
                )}
              </div>
            )}
            <MessageList messages={augmentedMessages} searchQuery={searchQuery} />
            {pendingQuestion ? (
              <QuestionDock
                request={pendingQuestion}
                onReply={handleReplyQuestion}
                onReject={rejectQuestion}
              />
            ) : (
              <MessageInput
                onSend={handleSendMessage}
                disabled={false}
                isStreaming={isStreaming && streamingSessionId === activeSessionId}
                onStop={abortOpencode}
                onHistoryUp={getPreviousSent}
                onHistoryDown={getNextSent}
                fileInputRef={fileInputRef}
                onFocusReady={(fn) => { inputFocusRef.current = fn; }}
              />
            )}
          </ErrorBoundary>
        )}
        <ErrorBoundary>
          <FileChanges
          ocSessionId={activeSession.ocSessionId}
          open={changesOpen}
          onToggle={() => setChangesOpen(false)}
          externalDirectory={workingDirectory}
          onViewFile={handleOpenFile}
          onDetachChange={setChangesDetached}
        />
        </ErrorBoundary>
      </div>
    </div>
  );
}
