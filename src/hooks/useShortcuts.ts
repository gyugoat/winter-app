import { useEffect, useRef, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const MAX_HISTORY = 20;

interface ShortcutActions {
  onNewSession: () => void;
  onArchiveSession: () => void;
  onPrevSession: () => void;
  onNextSession: () => void;
  onDeleteSession: () => void;
  onAttachFile: () => void;
  onStopStreaming: () => void;
  onFocusInput: () => void;
  isStreaming: boolean;
  sessions: { id: string }[];
  activeSessionId: string;
}

export function useShortcuts(actions: ShortcutActions) {
  const alwaysOnTopRef = useRef(false);
  const sentHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  const addToHistory = useCallback((text: string) => {
    const history = sentHistoryRef.current;
    if (history[0] === text) return;
    history.unshift(text);
    if (history.length > MAX_HISTORY) history.pop();
    historyIndexRef.current = -1;
  }, []);

  const getPreviousSent = useCallback((): string | null => {
    const history = sentHistoryRef.current;
    if (history.length === 0) return null;
    const nextIdx = historyIndexRef.current + 1;
    if (nextIdx >= history.length) return null;
    historyIndexRef.current = nextIdx;
    return history[nextIdx];
  }, []);

  const getNextSent = useCallback((): string | null => {
    const nextIdx = historyIndexRef.current - 1;
    if (nextIdx < 0) {
      historyIndexRef.current = -1;
      return '';
    }
    historyIndexRef.current = nextIdx;
    return sentHistoryRef.current[nextIdx];
  }, []);

  const resetHistoryIndex = useCallback(() => {
    historyIndexRef.current = -1;
  }, []);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        if (actions.isStreaming) {
          e.preventDefault();
          actions.onStopStreaming();
        }
        return;
      }

      if (!ctrl) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        actions.onFocusInput();
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          actions.onNewSession();
          break;

        case 'q':
          e.preventDefault();
          actions.onArchiveSession();
          break;

        case '[':
          e.preventDefault();
          actions.onPrevSession();
          break;

        case ']':
          e.preventDefault();
          actions.onNextSession();
          break;

        case 'backspace':
          e.preventDefault();
          actions.onDeleteSession();
          break;

        case 'k':
          e.preventDefault();
          actions.onAttachFile();
          break;

        case 'p': {
          e.preventDefault();
          const win = getCurrentWindow();
          alwaysOnTopRef.current = !alwaysOnTopRef.current;
          await win.setAlwaysOnTop(alwaysOnTopRef.current);
          break;
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [actions]);

  return {
    addToHistory,
    getPreviousSent,
    getNextSent,
    resetHistoryIndex,
    isAlwaysOnTop: alwaysOnTopRef,
  };
}
