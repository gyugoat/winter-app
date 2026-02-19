/**
 * Diamond — the Winter brand mark.
 *
 * A rotated square rendered as a div with CSS custom properties for color/glow.
 * Used in the titlebar, splash screen, idle screen, and settings.
 */

interface DiamondProps {
  /** Side length in pixels (the element is square before rotation) */
  size?: number;
  /** When true, renders a pulsing box-shadow glow */
  glow?: boolean;
  /** Extra CSS class names to attach (for positioning) */
  className?: string;
}

/**
 * Renders the diamond brand mark at the requested size.
 * Border radius scales proportionally so the shape stays sharp at small sizes.
 */
export function Diamond({ size = 22, glow = false, className = '' }: DiamondProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        background: 'var(--diamond-color)',
        transform: 'rotate(45deg)',
        borderRadius: Math.max(2, size * 0.06),
        boxShadow: glow
          ? '0 0 24px var(--glow-diamond), 0 0 48px var(--glow-diamond)'
          : 'none',
        transition: 'box-shadow 0.2s',
        flexShrink: 0,
      }}
    />
  );
}
