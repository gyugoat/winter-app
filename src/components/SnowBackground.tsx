import { useEffect, useRef } from 'react';

interface SnowBackgroundProps {
  idle?: boolean;
}

export function SnowBackground({ idle = false }: SnowBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<number>(0);
  const idleRef = useRef(idle);
  idleRef.current = idle;

  useEffect(() => {
    startTimeRef.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let W: number, H: number;
    let animId: number;

    const FLAKE_COUNT = 20;
    const TOTAL_STAGES = 20;
    const STAGE_DURATION_SEC = 30;
    const SNOW_LAYER_HEIGHT = 8;

    let snowLayerFill = 0;

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

    function drawGroundSnow(c: CanvasRenderingContext2D, r: number, g: number, b: number, layerH: number) {
      if (layerH <= 0) return;
      const y = H - layerH;
      const grad = c.createLinearGradient(0, y, 0, H);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.15)`);
      grad.addColorStop(0.3, `rgba(${r},${g},${b},0.25)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0.35)`);
      c.fillStyle = grad;

      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) {
        const wave = Math.sin(x * 0.02) * 1.5 + Math.sin(x * 0.05 + 1) * 0.8;
        c.lineTo(x, y + wave);
      }
      c.lineTo(W, H);
      c.closePath();
      c.fill();
    }

    // Olaf-like: pear body, small head, twig arms with branches, carrot nose, smile, hair tufts
    function drawSnowman(c: CanvasRenderingContext2D, stage: number, stageProgress: number) {
      if (stage < 0) return;

      const [r, g, b] = parseRgb(snowRgb);
      const snowmanX = W * 0.82;
      const groundY = H - SNOW_LAYER_HEIGHT;

      // stage 0-6: body, 7-11: head, 12-15: arms, 16-19: face
      const progress = stage + stageProgress;
      const bodyOpacity = Math.min(1, Math.max(0, progress / 7));
      const headOpacity = Math.min(1, Math.max(0, (progress - 7) / 5));
      const armsOpacity = Math.min(1, Math.max(0, (progress - 12) / 4));
      const faceOpacity = Math.min(1, Math.max(0, (progress - 16) / 4));

      if (bodyOpacity > 0) {
        c.save();
        c.globalAlpha = bodyOpacity * 0.9;
        c.fillStyle = `rgb(${r},${g},${b})`;
        c.beginPath();
        c.ellipse(snowmanX, groundY - 22, 28, 22, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      const bodyTopY = groundY - 42;
      const headR = 14;
      const headY = bodyTopY - headR + 4;

      if (headOpacity > 0) {
        c.save();
        c.globalAlpha = headOpacity * 0.9;
        c.fillStyle = `rgb(${r},${g},${b})`;
        c.beginPath();
        c.arc(snowmanX, headY, headR, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      if (armsOpacity > 0) {
        c.save();
        c.globalAlpha = armsOpacity;
        c.strokeStyle = 'rgba(90,60,30,1)';
        c.lineWidth = 2;
        c.lineCap = 'round';

        const armY = groundY - 30;

        c.beginPath();
        c.moveTo(snowmanX - 26, armY);
        c.lineTo(snowmanX - 50, armY - 18);
        c.stroke();
        c.beginPath();
        c.moveTo(snowmanX - 42, armY - 12);
        c.lineTo(snowmanX - 48, armY - 22);
        c.stroke();
        c.beginPath();
        c.moveTo(snowmanX - 44, armY - 14);
        c.lineTo(snowmanX - 52, armY - 12);
        c.stroke();

        c.beginPath();
        c.moveTo(snowmanX + 26, armY);
        c.lineTo(snowmanX + 50, armY - 18);
        c.stroke();
        c.beginPath();
        c.moveTo(snowmanX + 42, armY - 12);
        c.lineTo(snowmanX + 48, armY - 22);
        c.stroke();
        c.beginPath();
        c.moveTo(snowmanX + 44, armY - 14);
        c.lineTo(snowmanX + 52, armY - 12);
        c.stroke();

        c.restore();
      }

      if (faceOpacity > 0) {
        c.save();
        c.globalAlpha = faceOpacity;

        c.fillStyle = '#1a1a1a';
        c.beginPath();
        c.arc(snowmanX - 5, headY - 3, 2.2, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(snowmanX + 5, headY - 3, 2.2, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = '#e87400';
        c.beginPath();
        c.moveTo(snowmanX, headY + 1);
        c.lineTo(snowmanX + 14, headY + 3);
        c.lineTo(snowmanX, headY + 5);
        c.closePath();
        c.fill();

        c.strokeStyle = '#1a1a1a';
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(snowmanX, headY + 8, 4, 0.1, Math.PI - 0.1);
        c.stroke();

        c.fillStyle = '#1a1a1a';
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.arc(snowmanX, groundY - 32 + i * 8, 2, 0, Math.PI * 2);
          c.fill();
        }

        c.strokeStyle = 'rgba(90,60,30,1)';
        c.lineWidth = 2;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(snowmanX - 2, headY - headR);
        c.lineTo(snowmanX - 4, headY - headR - 8);
        c.stroke();
        c.beginPath();
        c.moveTo(snowmanX + 1, headY - headR);
        c.lineTo(snowmanX + 3, headY - headR - 7);
        c.stroke();
        c.beginPath();
        c.moveTo(snowmanX, headY - headR - 1);
        c.lineTo(snowmanX, headY - headR - 9);
        c.stroke();

        c.restore();
      }
    }

    let lastTime = 0;
    let lastDrawTime = 0;
    const TARGET_FPS = 20;
    const FRAME_MS = 1000 / TARGET_FPS;
    const MIN_FRAME_INTERVAL = FRAME_MS * 0.9;

    function draw(now: number) {
      animId = requestAnimationFrame(draw);

      if (!startTimeRef.current) startTimeRef.current = now;
      if (!lastTime) lastTime = now;

      const elapsed = now - lastDrawTime;
      if (lastDrawTime && elapsed < MIN_FRAME_INTERVAL) return;

      const dt = Math.min(now - lastTime, 100) / FRAME_MS;
      lastTime = now;
      lastDrawTime = now;

      const isIdle = idleRef.current;
      const elapsedSec = (now - startTimeRef.current) / 1000;
      const currentStage = Math.min(Math.floor(elapsedSec / STAGE_DURATION_SEC), TOTAL_STAGES);
      const stageProgress = currentStage < TOTAL_STAGES ? (elapsedSec % STAGE_DURATION_SEC) / STAGE_DURATION_SEC : 1;

      ctx!.clearRect(0, 0, W, H);
      const [r, g, b] = parseRgb(snowRgb);

      for (const f of flakes) {
        f.y += f.speed * dt;
        f.wobble = (f.wobble + f.wobbleSpeed * dt) % (Math.PI * 2);
        f.x += (f.drift + Math.sin(f.wobble) * 0.3) * dt;

        if (f.y >= H) {
          if (isIdle && snowLayerFill < 1) {
            snowLayerFill = Math.min(1, snowLayerFill + 0.005 * dt);
          }
          f.y = -5;
          f.x = Math.random() * W;
        }

        if (f.x > W + 5) f.x = -5;
        if (f.x < -5) f.x = W + 5;

        ctx!.beginPath();
        ctx!.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${r},${g},${b},${f.opacity})`;
        ctx!.fill();
      }

      if (isIdle && snowLayerFill > 0) {
        drawGroundSnow(ctx!, r, g, b, SNOW_LAYER_HEIGHT * snowLayerFill);
        drawSnowman(ctx!, currentStage, stageProgress);
      }
    }

    resize();
    initFlakes();
    animId = requestAnimationFrame((t) => draw(t));

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
