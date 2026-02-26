/**
 * useIdle — detects user inactivity and triggers the idle screen.
 *
 * Listens to a set of interaction events (mouse, keyboard, scroll, touch).
 * If none fire within `timeout` ms, the idle state becomes true.
 * Returns a `wake` function that resets the timer immediately.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Events considered as "user activity" for idle detection */
const EVENTS: (keyof WindowEventMap)[] = [
  'mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel',
];

/**
 * @param timeout - Inactivity threshold in milliseconds
 * @returns `[isIdle, wake]` — idle boolean and manual wake function
 */
export function useIdle(timeout: number): [boolean, () => void] {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const idleRef = useRef(false);
  idleRef.current = idle;

  const resetTimer = useCallback(() => {
    // Only reset the inactivity timer when NOT already idle.
    // Once idle, only the explicit `wake` call (from IdleScreen click) can exit.
    if (idleRef.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), timeout);
  }, [timeout]);

  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), timeout);
  }, [timeout]);

  useEffect(() => {
    timer.current = setTimeout(() => setIdle(true), timeout);

    for (const ev of EVENTS) window.addEventListener(ev, resetTimer, { passive: true });
    return () => {
      clearTimeout(timer.current);
      for (const ev of EVENTS) window.removeEventListener(ev, resetTimer);
    };
  }, [timeout, resetTimer]);

  return [idle, wake];
}
