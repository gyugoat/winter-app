/**
 * useQuestion — polls the OpenCode backend for pending clarification questions.
 *
 * During streaming, polls every 2 s; when idle, every 5 s.
 * When a question matching the current session ID is found, it surfaces as
 * `pending` for the QuestionDock component to display.
 *
 * Exposes `reply` (submit selected answers) and `reject` (dismiss without answering).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '../utils/invoke-shim';

export type QuestionInfo = {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionRequest = {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
  tool?: { messageID: string; callID: string };
};

export function useQuestion(ocSessionId: string | undefined, isStreaming: boolean) {
  const [pending, setPending] = useState<QuestionRequest | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!ocSessionId) return;
    try {
      const data: QuestionRequest[] = await invoke('opencode_get_questions');
      const match = data.find((q) => q.sessionID === ocSessionId) ?? null;
      setPending(match);
    } catch {}
  }, [ocSessionId]);

  useEffect(() => {
    if (!ocSessionId) {
      setPending(null);
      return;
    }

    poll();

    const delay = isStreaming ? 2000 : 5000;
    intervalRef.current = setInterval(poll, delay);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [ocSessionId, isStreaming, poll]);

  const reply = useCallback(async (requestID: string, answers: string[][]) => {
    try {
      await invoke('opencode_reply_question', { requestId: requestID, answers });
      setPending(null);
    } catch {}
  }, []);

  const reject = useCallback(async (requestID: string) => {
    try {
      await invoke('opencode_reject_question', { requestId: requestID });
      setPending(null);
    } catch {}
  }, []);

  return { pending, reply, reject };
}
