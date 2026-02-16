import { useEffect, useRef } from 'react';
import { Diamond } from './Diamond';

interface IdleScreenProps {
  onWake: () => void;
}

export function IdleScreen({ onWake }: IdleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<number>(0);

  const handleWake = () => {
    onWake();
  };

  useEffect(() => {
    window.addEventListener('keydown', handleWake);
    return () => window.removeEventListener('keydown', handleWake);
  }, [onWake]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 👇 [속도 설정] 
    // 실제 사용 시: 30 (30초마다 단계 진행)
    // 테스트 시: 1 (1초마다 진행)
    const STAGE_DURATION_SEC = 30; 
    const TOTAL_STAGES = 20;

    const dpr = window.devicePixelRatio || 1;
    let W: number, H: number;
    let animId: number;

    const FLAKE_COUNT = 60;
    const MAX_SNOW_HEIGHT = 38; // 눈이 다 쌓였을 때 높이

    // 눈 쌓임 정도 (0.0 ~ 1.0)
    let groundSnowProgress = 0;

    interface Flake { x: number; y: number; r: number; speed: number; drift: number; opacity: number; wobble: number; wobbleSpeed: number; }
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

    // 👇 수정된 함수: 현재 높이(currentHeight)를 받아서 그림
    function drawSnowGround(c: CanvasRenderingContext2D, currentHeight: number) {
      if (currentHeight <= 0.5) return; // 눈이 거의 없으면 안 그림

      const y = H - currentHeight;
      const grad = c.createLinearGradient(0, y, 0, H);
      grad.addColorStop(0, `rgba(${sR},${sG},${sB},0.25)`);
      grad.addColorStop(0.4, `rgba(${sR},${sG},${sB},0.4)`);
      grad.addColorStop(1, `rgba(${sR},${sG},${sB},0.55)`);
      c.fillStyle = grad;
      c.beginPath(); 
      c.moveTo(0, H);
      
      // 물결 모양도 높이에 따라 살짝 변하게
      for (let x = 0; x <= W; x += 12) {
        const wave = (Math.sin(x * 0.025) * 2 + Math.sin(x * 0.06 + 1) * 1) * (currentHeight / MAX_SNOW_HEIGHT);
        c.lineTo(x, y + wave);
      }
      c.lineTo(W, H); 
      c.closePath(); 
      c.fill();
    }

    function drawOlaf(c: CanvasRenderingContext2D, now: number, stage: number, stageProgress: number, groundReady: boolean) {
      // 바닥 눈이 다 안 쌓였으면 올라프 그리지 않음
      if (!groundReady) return;

      const groundY = H - MAX_SNOW_HEIGHT;
      const ox = W * 0.78;
      const breathe = Math.sin(now * 0.001) * 1.5;

      const progress = stage + stageProgress;
      const bodyOpacity = Math.min(1, Math.max(0, progress / 7));
      const headOpacity = Math.min(1, Math.max(0, (progress - 7) / 5));
      const armsOpacity = Math.min(1, Math.max(0, (progress - 12) / 4));
      const faceOpacity = Math.min(1, Math.max(0, (progress - 16) / 4));

      c.save();
      // ... (이하 올라프 그리기 로직 동일) ...
      if (bodyOpacity > 0) {
        c.globalAlpha = bodyOpacity;
        const bottomR = 32; const bottomY = groundY - bottomR + 4;
        c.fillStyle = `rgba(${sR},${sG},${sB},0.92)`;
        c.beginPath(); c.ellipse(ox, bottomY + breathe * 0.3, bottomR, bottomR - 2, 0, 0, Math.PI * 2); c.fill();
        const midR = 22; const midY = bottomY - bottomR - midR + 12 + breathe * 0.2;
        c.fillStyle = `rgba(${sR},${sG},${sB},0.92)`;
        c.beginPath(); c.ellipse(ox, midY, midR, midR - 1, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = `rgba(${sR},${sG},${sB},0.5)`;
        c.beginPath(); c.ellipse(ox, groundY, bottomR + 8, 6, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1a1a1a';
        for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(ox, midY - midR + 10 + i * 10, 2.5, 0, Math.PI * 2); c.fill(); }
      }
      if (headOpacity > 0) {
        c.globalAlpha = headOpacity;
        const bottomR = 32; const midR = 22; const bottomY = groundY - bottomR + 4; const midY = bottomY - bottomR - midR + 12 + breathe * 0.2;
        const headR = 17; const headY = midY - midR - headR + 8 + breathe * 0.1;
        c.fillStyle = `rgba(${sR},${sG},${sB},0.95)`; c.beginPath(); c.arc(ox, headY, headR, 0, Math.PI * 2); c.fill();
      }
      if (armsOpacity > 0) {
        c.globalAlpha = armsOpacity;
        const bottomR = 32; const midR = 22; const bottomY = groundY - bottomR + 4; const midY = bottomY - bottomR - midR + 12 + breathe * 0.2;
        c.strokeStyle = 'rgba(90,55,25,0.9)'; c.lineWidth = 2.5; c.lineCap = 'round';
        const ox = W * 0.78;
        c.beginPath(); c.moveTo(ox - midR + 2, midY - 2); c.lineTo(ox - midR - 28, midY - 18); c.stroke();
        c.lineWidth = 1.8; c.beginPath(); c.moveTo(ox - midR - 18, midY - 12); c.lineTo(ox - midR - 26, midY - 24); c.stroke();
        c.beginPath(); c.moveTo(ox - midR - 22, midY - 14); c.lineTo(ox - midR - 30, midY - 10); c.stroke();
        c.lineWidth = 2.5; c.beginPath(); c.moveTo(ox + midR - 2, midY - 2); c.lineTo(ox + midR + 28, midY - 18); c.stroke();
        c.lineWidth = 1.8; c.beginPath(); c.moveTo(ox + midR + 18, midY - 12); c.lineTo(ox + midR + 26, midY - 24); c.stroke();
        c.beginPath(); c.moveTo(ox + midR + 22, midY - 14); c.lineTo(ox + midR + 30, midY - 10); c.stroke();
      }
      if (faceOpacity > 0) {
        c.globalAlpha = faceOpacity;
        const bottomR = 32; const midR = 22; const headR = 17; const bottomY = groundY - bottomR + 4; const midY = bottomY - bottomR - midR + 12 + breathe * 0.2; const headY = midY - midR - headR + 8 + breathe * 0.1;
        c.fillStyle = '#1a1a1a'; c.beginPath(); c.ellipse(ox - 6, headY - 4, 3, 3.5, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(ox + 6, headY - 4, 3, 3.5, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#e87400'; c.beginPath(); c.moveTo(ox, headY + 1); c.lineTo(ox + 18, headY + 3.5); c.lineTo(ox, headY + 6); c.closePath(); c.fill();
        c.strokeStyle = '#1a1a1a'; c.lineWidth = 1.5; c.beginPath(); c.arc(ox, headY + 9, 6, 0.15, Math.PI - 0.15); c.stroke();
        c.strokeStyle = 'rgba(90,55,25,0.85)'; c.lineWidth = 2; c.beginPath(); c.moveTo(ox - 3, headY - headR + 1); c.lineTo(ox - 5, headY - headR - 12); c.stroke();
        c.beginPath(); c.moveTo(ox + 2, headY - headR + 1); c.lineTo(ox + 4, headY - headR - 11); c.stroke();
        c.beginPath(); c.moveTo(ox, headY - headR); c.lineTo(ox, headY - headR - 14); c.stroke();
      }
      c.restore();
    }

    let lastTime = 0;
    let lastDrawTime = 0;
    const TARGET_FPS = 60;
    const FRAME_MS = 1000 / TARGET_FPS;
    const MIN_FRAME_INTERVAL = FRAME_MS * 0.9;

    function draw(now: number) {
      animId = requestAnimationFrame(draw);
      if (!startTimeRef.current) startTimeRef.current = now;
      if (!lastTime) lastTime = now;
      const elapsed = now - lastDrawTime;
      if (lastDrawTime && elapsed < MIN_FRAME_INTERVAL) return;
      const dt = Math.min(now - lastTime, 100) / FRAME_MS;
      lastTime = now; lastDrawTime = now;
      
      const elapsedSec = (now - startTimeRef.current) / 1000;
      const currentStage = Math.min(Math.floor(elapsedSec / STAGE_DURATION_SEC), TOTAL_STAGES);
      const stageProgress = currentStage < TOTAL_STAGES ? (elapsedSec % STAGE_DURATION_SEC) / STAGE_DURATION_SEC : 1;

      // 👇 [중요] 바닥 눈 높이 계산 (천천히 차오름)
      if (groundSnowProgress < 1) {
        // dt(델타타임)을 이용해서 부드럽게 증가. 숫자가 작을수록 천천히 쌓임.
        groundSnowProgress = Math.min(1, groundSnowProgress + 0.005 * dt);
      }

      ctx!.clearRect(0, 0, W, H);

      for (const f of flakes) {
        f.y += f.speed * dt; 
        f.wobble = (f.wobble + f.wobbleSpeed * dt) % (Math.PI * 2); 
        f.x += (f.drift + Math.sin(f.wobble) * 0.3) * dt;
        if (f.y >= H) { 
           f.y = -5; f.x = Math.random() * W; 
        }
        if (f.x > W + 5) f.x = -5; if (f.x < -5) f.x = W + 5;
        ctx!.beginPath(); ctx!.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx!.fillStyle = `rgba(${sR},${sG},${sB},${f.opacity})`; ctx!.fill();
      }

      // 1. 바닥 눈 그리기 (높이 애니메이션 적용됨)
      drawSnowGround(ctx!, MAX_SNOW_HEIGHT * groundSnowProgress);

      // 2. 올라프 그리기 (바닥이 다 쌓여야(progress >= 1) 나타나기 시작)
      drawOlaf(ctx!, now, currentStage, stageProgress, groundSnowProgress >= 0.95);
    }
    resize(); initFlakes(); animId = requestAnimationFrame((t) => draw(t));
    const onResize = () => resize(); window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', onResize); observer.disconnect(); };
  }, []);

  return (
    <div
      onClick={handleWake} onMouseMove={handleWake} onTouchStart={handleWake}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'var(--bg-deep)', animation: 'idleFadeIn 0.8s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div style={{ position: 'relative', zIndex: 10 }}>
        <Diamond size={64} glow={true} />
        <style>{`@keyframes idlePulse { 0% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.05); opacity: 1; } 100% { transform: scale(1); opacity: 0.8; } }`}</style>
      </div>
      <style>{`@keyframes idleFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}