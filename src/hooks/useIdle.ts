/**
 * useIdle — detects user inactivity and triggers the idle screen.
 *
 * Listens to a set of interaction events (mouse, keyboard, scroll, touch).
 * If none fire within `timeout` ms, the idle state becomes true.
 * Returns a `wake` function that resets the timer immediately.
 */
import { useEffect, useRef, useState } from 'react';

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

  const reset = () => {
    if (idle) setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), timeout);
  };

  useEffect(() => {
    timer.current = setTimeout(() => setIdle(true), timeout);

    for (const ev of EVENTS) window.addEventListener(ev, reset, { passive: true });
    return () => {
      clearTimeout(timer.current);
      for (const ev of EVENTS) window.removeEventListener(ev, reset);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeout]);

  const wake = () => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), timeout);
  };

  return [idle, wake];
}
