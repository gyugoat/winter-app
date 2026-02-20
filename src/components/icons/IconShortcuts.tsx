import type React from 'react';

/**
 * Keyboard icon for the settings menu shortcuts item.
 */
export function IconShortcuts({ size = 16, ...props }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="6" y1="8" x2="6" y2="8.01" />
      <line x1="10" y1="8" x2="10" y2="8.01" />
      <line x1="14" y1="8" x2="14" y2="8.01" />
      <line x1="18" y1="8" x2="18" y2="8.01" />
      <line x1="6" y1="12" x2="6" y2="12.01" />
      <line x1="18" y1="12" x2="18" y2="12.01" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </svg>
  );
}
