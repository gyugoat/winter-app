/**
 * useClickFlash — micro-interaction utility for button press feedback.
 *
 * Adds the `click-flash` CSS class to trigger a brief animation, then removes
 * it after the animation completes. The `void el.offsetWidth` forces a reflow
 * so re-clicking the same element restarts the animation.
 */
import { useCallback } from 'react';

/**
 * Triggers the click-flash animation on a DOM element.
 * Forces reflow between removal and re-addition to restart the animation.
 */
export function flash(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove('click-flash');
  void el.offsetWidth;
  el.classList.add('click-flash');
  el.addEventListener('animationend', () => el.classList.remove('click-flash'), { once: true });
}

export function useClickFlash() {
  return useCallback((e: React.MouseEvent<HTMLElement>) => {
    flash(e.currentTarget);
  }, []);
}
