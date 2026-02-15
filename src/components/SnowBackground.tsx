import { useEffect, useRef } from 'react';

export function SnowBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let W: number, H: number;
    let animId: number;

    const FLAKE_COUNT = 40;
    const flakes: Array<{
      x: number; y: number;
      r: number; speed: number;
      drift: number; opacity: number;
      wobble: number; wobbleSpeed: number;
    }> = [];

    function resize() {
      W = canvas!.clientWidth;
      H = canvas!.clientHeight;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initFlakes() {
      flakes.length = 0;
      for (let i = 0; i < FLAKE_COUNT; i++) {
        flakes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 1 + Math.random() * 1.5,
          speed: 0.2 + Math.random() * 0.5,
          drift: (Math.random() - 0.5) * 0.3,
          opacity: 0.1 + Math.random() * 0.2,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.005 + Math.random() * 0.01,
        });
      }
    }

    function getSnowColor(): string {
      return getComputedStyle(document.documentElement).getPropertyValue('--snow-particle').trim() || 'rgba(200,220,255,1)';
    }

    let snowRgb = getSnowColor();
    const observer = new MutationObserver(() => { snowRgb = getSnowColor(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    function parseRgb(color: string): [number, number, number] {
      const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : [200, 220, 255];
    }

    let lastTime = 0;
    const TARGET_FPS = 60;
    const FRAME_MS = 1000 / TARGET_FPS;

    function draw(now: number) {
      if (!lastTime) lastTime = now;
      const dt = Math.min(now - lastTime, 100) / FRAME_MS;
      lastTime = now;

      ctx!.clearRect(0, 0, W, H);
      const [r, g, b] = parseRgb(snowRgb);
      for (const f of flakes) {
        f.y += f.speed * dt;
        f.wobble = (f.wobble + f.wobbleSpeed * dt) % (Math.PI * 2);
        f.x += (f.drift + Math.sin(f.wobble) * 0.3) * dt;

        if (f.y > H + 5) { f.y = -5; f.x = Math.random() * W; }
        if (f.x > W + 5) f.x = -5;
        if (f.x < -5) f.x = W + 5;

        ctx!.beginPath();
        ctx!.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${r},${g},${b},${f.opacity})`;
        ctx!.fill();
      }
    animId = requestAnimationFrame((t) => draw(t));
    }

    resize();
    initFlakes();
    animId = requestAnimationFrame(draw);

    const onResize = () => { resize(); };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
