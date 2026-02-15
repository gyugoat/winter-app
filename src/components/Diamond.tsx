interface DiamondProps {
  size?: number;
  glow?: boolean;
  className?: string;
}

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
