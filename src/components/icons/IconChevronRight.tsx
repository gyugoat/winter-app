import type React from 'react';

/**
 * Chevron-right icon used as navigation arrow in popup menus and sub-popups.
 */
export function IconChevronRight({ size = 10, ...props }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
