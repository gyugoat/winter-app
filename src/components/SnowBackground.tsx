import { useEffect, useRef } from 'react';

export function SnowBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let W: number, H: number;
    let animId: number;

    const FLAKE_COUNT = 20;
    const BUCKET_WIDTH = 10;
    const MAX_PER_BUCKET = 3;
    const TOTAL_STAGES = 20;
    const STAGE_DURATION_SEC = 30;

    const flakes: Array<{
      x: number; y: number;
      r: number; speed: number;
      drift: number; opacity: number;
      wobble: number; wobbleSpeed: number;
    }> = [];

    const groundBuckets: Map<number, number> = new Map();

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

    function getBucketIndex(x: number): number {
      return Math.floor(x / BUCKET_WIDTH);
    }

    function drawSnowman(c: CanvasRenderingContext2D, stage: number, stageProgress: number) {
      if (stage < 0) return;

      const [r, g, b] = parseRgb(snowRgb);
      const snowmanX = W * 0.85;
      const groundY = H;

      const bodyBottomR = 30;
      const bodyMiddleR = 22;
      const headR = 16;
      const bodyBottomY = groundY - bodyBottomR;
      const bodyMiddleY = bodyBottomY - bodyBottomR - bodyMiddleR + 5;
      const headY = bodyMiddleY - bodyMiddleR - headR + 3;

      // stage 0-6: bottom, 7-10: middle, 11-14: head, 15-17: arms, 18-19: face
      const progress = stage + stageProgress;
      const bodyOpacity = Math.min(1, Math.max(0, progress / 7));
      const middleOpacity = Math.min(1, Math.max(0, (progress - 7) / 4));
      const headOpacity = Math.min(1, Math.max(0, (progress - 11) / 4));
      const armsOpacity = Math.min(1, Math.max(0, (progress - 15) / 3));
      const faceOpacity = Math.min(1, Math.max(0, (progress - 18) / 2));

      if (bodyOpacity > 0) {
        c.beginPath();
        c.arc(snowmanX, bodyBottomY, bodyBottomR, 0, Math.PI * 2);
        c.fillStyle = `rgba(${r},${g},${b},${bodyOpacity * 0.9})`;
        c.fill();
      }

      if (middleOpacity > 0) {
        c.beginPath();
        c.arc(snowmanX, bodyMiddleY, bodyMiddleR, 0, Math.PI * 2);
        c.fillStyle = `rgba(${r},${g},${b},${middleOpacity * 0.9})`;
        c.fill();
      }

      if (headOpacity > 0) {
        c.beginPath();
        c.arc(snowmanX, headY, headR, 0, Math.PI * 2);
        c.fillStyle = `rgba(${r},${g},${b},${headOpacity * 0.9})`;
        c.fill();
      }

      if (armsOpacity > 0) {
        c.strokeStyle = `rgba(80,60,40,${armsOpacity})`;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(snowmanX - bodyMiddleR, bodyMiddleY);
        c.lineTo(snowmanX - bodyMiddleR - 20, bodyMiddleY - 15);
        c.stroke();
        c.beginPath();
        c.moveTo(snowmanX + bodyMiddleR, bodyMiddleY);
        c.lineTo(snowmanX + bodyMiddleR + 20, bodyMiddleY - 15);
        c.stroke();
      }

      if (faceOpacity > 0) {
        c.fillStyle = `rgba(30,30,30,${faceOpacity})`;
        c.beginPath();
        c.arc(snowmanX - 6, headY - 3, 2, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(snowmanX + 6, headY - 3, 2, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = `rgba(255,140,0,${faceOpacity})`;
        c.beginPath();
        c.moveTo(snowmanX, headY + 2);
        c.lineTo(snowmanX + 12, headY + 2);
        c.lineTo(snowmanX + 6, headY + 5);
        c.closePath();
        c.fill();

        c.fillStyle = `rgba(30,30,30,${faceOpacity})`;
        c.beginPath();
        c.arc(snowmanX, bodyBottomY - 15, 2.5, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(snowmanX, bodyBottomY - 5, 2.5, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(snowmanX, bodyBottomY + 5, 2.5, 0, Math.PI * 2);
        c.fill();
      }
    }

    let lastTime = 0;
    const TARGET_FPS = 60;
    const FRAME_MS = 1000 / TARGET_FPS;

    function draw(now: number) {
      if (!startTimeRef.current) startTimeRef.current = now;
      if (!lastTime) lastTime = now;
      const dt = Math.min(now - lastTime, 100) / FRAME_MS;
      lastTime = now;

      const elapsedSec = (now - startTimeRef.current) / 1000;
      const currentStage = Math.min(Math.floor(elapsedSec / STAGE_DURATION_SEC), TOTAL_STAGES);
      const stageProgress = currentStage < TOTAL_STAGES ? (elapsedSec % STAGE_DURATION_SEC) / STAGE_DURATION_SEC : 1;

      ctx!.clearRect(0, 0, W, H);
      const [r, g, b] = parseRgb(snowRgb);

      for (const [bucketIdx, count] of groundBuckets.entries()) {
        const bucketX = bucketIdx * BUCKET_WIDTH + BUCKET_WIDTH / 2;
        for (let i = 0; i < count; i++) {
          ctx!.beginPath();
          ctx!.arc(bucketX, H - 2 - i * 3, 1.5, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(${r},${g},${b},0.3)`;
          ctx!.fill();
        }
      }

      for (const f of flakes) {
        f.y += f.speed * dt;
        f.wobble = (f.wobble + f.wobbleSpeed * dt) % (Math.PI * 2);
        f.x += (f.drift + Math.sin(f.wobble) * 0.3) * dt;

        if (f.y >= H - 5) {
          const bucketIdx = getBucketIndex(f.x);
          const currentCount = groundBuckets.get(bucketIdx) || 0;
          if (currentCount < MAX_PER_BUCKET) {
            groundBuckets.set(bucketIdx, currentCount + 1);
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

      drawSnowman(ctx!, currentStage, stageProgress);

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
