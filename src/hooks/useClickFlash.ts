import { useCallback } from 'react';

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
