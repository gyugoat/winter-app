import { useState, useEffect, useRef, useCallback } from 'react';

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

const BASE = 'http://localhost:6096';

export function useQuestion(ocSessionId: string | undefined, isStreaming: boolean) {
  const [pending, setPending] = useState<QuestionRequest | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!ocSessionId) return;
    try {
      const res = await fetch(`${BASE}/question`);
      if (!res.ok) return;
      const data: QuestionRequest[] = await res.json();
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
      await fetch(`${BASE}/question/${requestID}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      setPending(null);
    } catch {}
  }, []);

  const reject = useCallback(async (requestID: string) => {
    try {
      await fetch(`${BASE}/question/${requestID}/reject`, { method: 'POST' });
      setPending(null);
    } catch {}
  }, []);

  return { pending, reply, reject };
}
