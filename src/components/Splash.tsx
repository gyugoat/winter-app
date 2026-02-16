import { useEffect, useRef, useState, useCallback } from 'react';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n/en';
import '../styles/splash.css';

const RETURN_GREETING_KEYS: TranslationKey[] = [
  'splashReturn1', 'splashReturn2', 'splashReturn3', 'splashReturn4', 'splashReturn5',
];

interface SplashProps {
  onDone: () => void;
  returning?: boolean;
}

export function Splash({ onDone, returning = false }: SplashProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fadeOut, setFadeOut] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const clickedRef = useRef(false);
  const clickTimeRef = useRef(0);
  const greetingKeyRef = useRef(
    returning
      ? RETURN_GREETING_KEYS[Math.floor(Math.random() * RETURN_GREETING_KEYS.length)]
      : 'splashFirstGreeting' as TranslationKey
  );

  const handleClick = useCallback(() => {
    if (!clickedRef.current) {
      clickedRef.current = true;
      clickTimeRef.current = performance.now();
      setShowGreeting(true);
      setTimeout(() => {
        setFadeOut(true);
        setTimeout(onDone, 500);
      }, 1600);
    }
  }, [onDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext('2d');
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;

    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Offscreen canvas for settled snow (double-buffer)
    const offCanvas = document.createElement('canvas');
    offCanvas.width = W * dpr;
    offCanvas.height = H * dpr;
    const maybeOffCtx = offCanvas.getContext('2d');
    if (!maybeOffCtx) return;
    const offCtx: CanvasRenderingContext2D = maybeOffCtx;
    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = W / 2;
    const cy = H / 2;
    // Snow stacks ~80px below diamond center
    const STACK_Y = cy + 80;
    // Diamond melts snow within this radius
    const MELT_RADIUS = 70;
    // Max snow accumulation height (~1cm visual = ~38px)
    const MAX_SNOW_HEIGHT = 38;

    const COL_W = 3;
    const COLS = Math.ceil(W / COL_W);
    const heightMap = new Float32Array(COLS);

    interface Particle {
      x: number; y: number;
      size: number; alpha: number;
      speed: number; drift: number;
      wobble: number; settled: boolean;
      vy: number;
    }

    const particles: Particle[] = [];
    const MAX_PARTICLES = 30;

    function spawn(startY?: number) {
      particles.push({
        x: Math.random() * W,
        y: startY ?? (-4 - Math.random() * 40),
        size: 1.5 + Math.random() * 2.5,
        alpha: 0.3 + Math.random() * 0.6,
        speed: 0.8 + Math.random() * 1.4,
        drift: (Math.random() - 0.5) * 0.4,
        wobble: Math.random() * Math.PI * 2,
        settled: false,
        vy: 0,
      });
    }

    for (let i = 0; i < 20; i++) spawn(Math.random() * (STACK_Y - 40));

    let animId: number;
    let spawnAccum = 0;
    let settledY = 0;
    let settledVY = 0;

    const snowVar = getComputedStyle(document.documentElement).getPropertyValue('--snow-particle').trim() || 'rgba(200,220,255,1)';
    const rgbMatch = snowVar.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    const sR = rgbMatch ? +rgbMatch[1] : 200;
    const sG = rgbMatch ? +rgbMatch[2] : 220;
    const sB = rgbMatch ? +rgbMatch[3] : 255;

    function draw(now: number) {
      ctx.clearRect(0, 0, W, H);

      const clicked = clickedRef.current;

      if (!clicked) {
        spawnAccum += 0.8;
        let active = 0;
        for (let i = 0; i < particles.length; i++) {
          if (!particles[i].settled) active++;
        }
        while (spawnAccum >= 1 && active < MAX_PARTICLES) {
          spawn();
          active++;
          spawnAccum -= 1;
        }
        spawnAccum = Math.min(spawnAccum, 3);
      }

      if (!clicked) {
        // Diamond melt — suppress heightMap near center
        const centerCol = Math.floor(cx / COL_W);
        const meltCols = Math.ceil(MELT_RADIUS / COL_W);
        for (let d = -meltCols; d <= meltCols; d++) {
          const c = centerCol + d;
          if (c < 0 || c >= COLS) continue;
          const dist = Math.abs(d * COL_W);
          const meltStrength = 1 - (dist / MELT_RADIUS);
          if (meltStrength > 0) {
            heightMap[c] *= (1 - meltStrength * 0.15);
          }
        }
        // Diamond melt — clear settled snow on offscreen canvas near center
        offCtx.save();
        offCtx.globalCompositeOperation = 'destination-out';
        offCtx.beginPath();
        offCtx.arc(cx, cy + 40, MELT_RADIUS * 0.7, 0, Math.PI * 2);
        offCtx.fillStyle = 'rgba(0,0,0,0.15)';
        offCtx.fill();
        offCtx.restore();
      }

      // When clicked, settled snow falls with gravity
      if (clicked) {
        settledVY += 0.35;
        settledY += settledVY;
      }

      // Blit settled snow layer (single drawImage — O(1))
      ctx.drawImage(offCanvas, 0, settledY, W, H);

      let allOffScreen = true;

      for (const p of particles) {
        if (clicked) {
          p.settled = false;
          p.vy += 0.35;
          p.y += p.vy;
          p.x += p.drift * 0.5;
          if (p.y < H + 20) allOffScreen = false;
        } else if (!p.settled) {
          p.y += p.speed;
          p.x += p.drift + Math.sin(now * 0.0009 + p.wobble) * 0.2;

          const col = Math.max(0, Math.min(COLS - 1, Math.floor(p.x / COL_W)));
          const groundY = STACK_Y - heightMap[col];
          if (p.y + p.size >= groundY) {
            const distFromCenter = Math.abs(p.x - cx);
            if (distFromCenter < MELT_RADIUS * 0.6) {
              p.alpha *= 0.92;
              if (p.alpha < 0.02) { p.settled = true; p.alpha = 0; }
              continue;
            }
            p.y = groundY - p.size;
            p.settled = true;
            const bump = p.size * 0.7;
            heightMap[col] = Math.min(heightMap[col] + bump, MAX_SNOW_HEIGHT);
            for (let d = 1; d <= 2; d++) {
              const falloff = 0.3 / d;
              if (col - d >= 0) heightMap[col - d] = Math.min(heightMap[col - d] + bump * falloff, MAX_SNOW_HEIGHT);
              if (col + d < COLS) heightMap[col + d] = Math.min(heightMap[col + d] + bump * falloff, MAX_SNOW_HEIGHT);
            }
            // Stamp settled particle onto offscreen canvas
            offCtx.beginPath();
            offCtx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
            offCtx.fillStyle = `rgba(${sR},${sG},${sB},${p.alpha})`;
            offCtx.fill();
          }
        }

        if (!p.settled && p.alpha > 0.01 && p.y < H + 20) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${sR},${sG},${sB},${p.alpha})`;
          ctx.fill();
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].settled) particles.splice(i, 1);
      }

      if (clicked && allOffScreen && settledY > H) return;
      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className={`splash${fadeOut ? ' fade-out' : ''}`} onClick={handleClick}>
      <div className="splash-drag" data-tauri-drag-region />
      <canvas ref={canvasRef} />
      <div className={`splash-diamond${showGreeting ? ' shrink' : ''}`} />
      <span className={`splash-title${showGreeting ? ' hide' : ''}`}>Winter</span>
      <span className={`splash-greeting${showGreeting ? ' visible' : ''}`}
	style={{ marginTop: '-60px' }}
	>
        {t(greetingKeyRef.current)}
      </span>
    </div>
  );
}
