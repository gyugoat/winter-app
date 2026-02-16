import { useEffect, useRef } from 'react';

interface IdleScreenProps {
  onWake: () => void;
}

export function IdleScreen({ onWake }: IdleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const dismiss = () => onWake();
    window.addEventListener('mousemove', dismiss, { once: true });
    window.addEventListener('mousedown', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });
    window.addEventListener('touchstart', dismiss, { once: true });
    return () => {
      window.removeEventListener('mousemove', dismiss);
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('touchstart', dismiss);
    };
  }, [onWake]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let W: number, H: number;
    let animId: number;

    const FLAKE_COUNT = 60;
    const SNOW_HEIGHT = 38;

    interface Flake {
      x: number; y: number;
      r: number; speed: number;
      drift: number; opacity: number;
      wobble: number; wobbleSpeed: number;
    }

    const flakes: Flake[] = [];

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
          r: 1 + Math.random() * 2,
          speed: 0.3 + Math.random() * 0.8,
          drift: (Math.random() - 0.5) * 0.3,
          opacity: 0.15 + Math.random() * 0.35,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.005 + Math.random() * 0.01,
        });
      }
    }

    function getSnowRgb(): [number, number, number] {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--snow-particle').trim() || 'rgba(200,220,255,1)';
      const m = raw.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : [200, 220, 255];
    }

    let [sR, sG, sB] = getSnowRgb();
    const observer = new MutationObserver(() => { [sR, sG, sB] = getSnowRgb(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    function drawSnowGround(c: CanvasRenderingContext2D) {
      const y = H - SNOW_HEIGHT;
      const grad = c.createLinearGradient(0, y, 0, H);
      grad.addColorStop(0, `rgba(${sR},${sG},${sB},0.25)`);
      grad.addColorStop(0.4, `rgba(${sR},${sG},${sB},0.4)`);
      grad.addColorStop(1, `rgba(${sR},${sG},${sB},0.55)`);
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 12) {
        const wave = Math.sin(x * 0.025) * 2 + Math.sin(x * 0.06 + 1) * 1;
        c.lineTo(x, y + wave);
      }
      c.lineTo(W, H);
      c.closePath();
      c.fill();
    }

    function drawOlaf(c: CanvasRenderingContext2D, now: number) {
      const groundY = H - SNOW_HEIGHT;
      const ox = W * 0.78;
      const breathe = Math.sin(now * 0.001) * 1.5;

      c.save();

      // bottom body — large round ball
      const bottomR = 32;
      const bottomY = groundY - bottomR + 4;
      c.fillStyle = `rgba(${sR},${sG},${sB},0.92)`;
      c.beginPath();
      c.ellipse(ox, bottomY + breathe * 0.3, bottomR, bottomR - 2, 0, 0, Math.PI * 2);
      c.fill();
      // subtle shadow on bottom body
      const bottomGrad = c.createRadialGradient(ox, bottomY + bottomR * 0.4, 0, ox, bottomY, bottomR);
      bottomGrad.addColorStop(0, 'rgba(0,0,0,0.06)');
      bottomGrad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = bottomGrad;
      c.beginPath();
      c.ellipse(ox, bottomY + breathe * 0.3, bottomR, bottomR - 2, 0, 0, Math.PI * 2);
      c.fill();

      // middle body — medium ball
      const midR = 22;
      const midY = bottomY - bottomR - midR + 12 + breathe * 0.2;
      c.fillStyle = `rgba(${sR},${sG},${sB},0.92)`;
      c.beginPath();
      c.ellipse(ox, midY, midR, midR - 1, 0, 0, Math.PI * 2);
      c.fill();

      // head — small ball
      const headR = 17;
      const headY = midY - midR - headR + 8 + breathe * 0.1;
      c.fillStyle = `rgba(${sR},${sG},${sB},0.95)`;
      c.beginPath();
      c.arc(ox, headY, headR, 0, Math.PI * 2);
      c.fill();

      // twig arms from middle body
      c.strokeStyle = 'rgba(90,55,25,0.9)';
      c.lineWidth = 2.5;
      c.lineCap = 'round';

      // left arm
      c.beginPath();
      c.moveTo(ox - midR + 2, midY - 2);
      c.lineTo(ox - midR - 28, midY - 18);
      c.stroke();
      // left arm branches
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(ox - midR - 18, midY - 12);
      c.lineTo(ox - midR - 26, midY - 24);
      c.stroke();
      c.beginPath();
      c.moveTo(ox - midR - 22, midY - 14);
      c.lineTo(ox - midR - 30, midY - 10);
      c.stroke();

      // right arm
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(ox + midR - 2, midY - 2);
      c.lineTo(ox + midR + 28, midY - 18);
      c.stroke();
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(ox + midR + 18, midY - 12);
      c.lineTo(ox + midR + 26, midY - 24);
      c.stroke();
      c.beginPath();
      c.moveTo(ox + midR + 22, midY - 14);
      c.lineTo(ox + midR + 30, midY - 10);
      c.stroke();

      // eyes — big Olaf-style
      c.fillStyle = '#1a1a1a';
      c.beginPath();
      c.ellipse(ox - 6, headY - 4, 3, 3.5, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(ox + 6, headY - 4, 3, 3.5, 0, 0, Math.PI * 2);
      c.fill();
      // eye highlights
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.beginPath();
      c.arc(ox - 5, headY - 5.5, 1.2, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(ox + 7, headY - 5.5, 1.2, 0, Math.PI * 2);
      c.fill();

      // carrot nose
      c.fillStyle = '#e87400';
      c.beginPath();
      c.moveTo(ox, headY + 1);
      c.lineTo(ox + 18, headY + 3.5);
      c.lineTo(ox, headY + 6);
      c.closePath();
      c.fill();
      // nose highlight
      c.fillStyle = 'rgba(255,180,60,0.3)';
      c.beginPath();
      c.moveTo(ox + 1, headY + 2);
      c.lineTo(ox + 10, headY + 3);
      c.lineTo(ox + 1, headY + 4);
      c.closePath();
      c.fill();

      // smile
      c.strokeStyle = '#1a1a1a';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(ox, headY + 9, 6, 0.15, Math.PI - 0.15);
      c.stroke();

      // buttons on middle body
      c.fillStyle = '#1a1a1a';
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.arc(ox, midY - midR + 10 + i * 10, 2.5, 0, Math.PI * 2);
        c.fill();
      }

      // twig hair on top of head
      c.strokeStyle = 'rgba(90,55,25,0.85)';
      c.lineWidth = 2;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(ox - 3, headY - headR + 1);
      c.lineTo(ox - 5, headY - headR - 12);
      c.stroke();
      c.beginPath();
      c.moveTo(ox + 2, headY - headR + 1);
      c.lineTo(ox + 4, headY - headR - 11);
      c.stroke();
      c.beginPath();
      c.moveTo(ox, headY - headR);
      c.lineTo(ox, headY - headR - 14);
      c.stroke();
      // tiny branch on center twig
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(ox, headY - headR - 9);
      c.lineTo(ox + 5, headY - headR - 13);
      c.stroke();
      c.beginPath();
      c.moveTo(ox - 5, headY - headR - 8);
      c.lineTo(ox - 9, headY - headR - 12);
      c.stroke();

      // snow base around Olaf's feet
      c.fillStyle = `rgba(${sR},${sG},${sB},0.5)`;
      c.beginPath();
      c.ellipse(ox, groundY, bottomR + 8, 6, 0, 0, Math.PI * 2);
      c.fill();

      c.restore();
    }

    let lastTime = 0;
    let lastDrawTime = 0;
    const TARGET_FPS = 60;
    const FRAME_MS = 1000 / TARGET_FPS;
    const MIN_FRAME_INTERVAL = FRAME_MS * 0.9;

    function draw(now: number) {
      animId = requestAnimationFrame(draw);

      if (!lastTime) lastTime = now;

      const elapsed = now - lastDrawTime;
      if (lastDrawTime && elapsed < MIN_FRAME_INTERVAL) return;

      const dt = Math.min(now - lastTime, 100) / FRAME_MS;
      lastTime = now;
      lastDrawTime = now;

      ctx!.clearRect(0, 0, W, H);

      for (const f of flakes) {
        f.y += f.speed * dt;
        f.wobble = (f.wobble + f.wobbleSpeed * dt) % (Math.PI * 2);
        f.x += (f.drift + Math.sin(f.wobble) * 0.3) * dt;

        if (f.y >= H) { f.y = -5; f.x = Math.random() * W; }
        if (f.x > W + 5) f.x = -5;
        if (f.x < -5) f.x = W + 5;

        ctx!.beginPath();
        ctx!.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${sR},${sG},${sB},${f.opacity})`;
        ctx!.fill();
      }

      drawSnowGround(ctx!);
      drawOlaf(ctx!, now);
    }

    resize();
    initFlakes();
    animId = requestAnimationFrame((t) => draw(t));

    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'var(--bg-deep)',
        borderRadius: 10,
        animation: 'idleFadeIn 0.8s ease',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
      <style>{`
        @keyframes idleFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
