import { useEffect, useRef, useState } from 'react';
import { Diamond } from './Diamond';
import olafImgSrc from '../assets/olaf.png';

interface IdleScreenProps {
  onWake: () => void;
}

export function IdleScreen({ onWake }: IdleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<number>(0);
  
  const imageBitmapRef = useRef<HTMLImageElement | null>(null);
  const imageDataRef = useRef<Uint8ClampedArray | null>(null);
  const [isReady, setIsReady] = useState(false);

  const handleWake = () => onWake();

  useEffect(() => {
    window.addEventListener('keydown', handleWake);
    window.addEventListener('mousedown', handleWake);
    return () => {
      window.removeEventListener('keydown', handleWake);
      window.removeEventListener('mousedown', handleWake);
    };
  }, [onWake]);

  useEffect(() => {
    const img = new Image();
    img.src = olafImgSrc;
    img.onload = () => {
      imageBitmapRef.current = img;
      setIsReady(true);
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // 설정
    const MAX_PARTICLES = 300; 
    const MAX_SNOW_HEIGHT = 40; 
    const OLAF_DURATION_MS = 10 * 60 * 1000; // 10분
    const TRICK_PARTICLES_PER_FRAME = 20; 

    const dpr = window.devicePixelRatio || 1;
    let W: number, H: number;
    let STACK_Y: number; 
    
    let COLS: number;
    let heightMap: Float32Array; 
    let animId: number;
    let spawnAccum = 0; 

    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d')!;
    
    const analysisCanvas = document.createElement('canvas');
    const analysisCtx = analysisCanvas.getContext('2d')!;

    let imgInfo = { x: 0, y: 0, w: 0, h: 0 };

    interface Particle { 
      x: number; y: number; 
      size: number; alpha: number;
      speed: number; drift: number; 
      wobble: number; settled: boolean;
    }
    const particles: Particle[] = [];

    function resize() {
      W = canvas!.clientWidth;
      H = canvas!.clientHeight;
      
      STACK_Y = (H / 2) + 80;

      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      offCanvas.width = W * dpr;
      offCanvas.height = H * dpr;
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      analysisCanvas.width = W; 
      analysisCanvas.height = H;

      const COL_W = 3;
      COLS = Math.ceil(W / COL_W) + 1;
      heightMap = new Float32Array(COLS).fill(0);

      if (imageBitmapRef.current) {
        const img = imageBitmapRef.current;
        
        // 크기: 화면 높이의 18%
        const targetHeight = H * 0.18; 
        const scale = targetHeight / img.height;
        
        const imgW = img.width * scale;
        const imgH = img.height * scale;
        
        // ⭐ [위치 수정] 오른쪽으로 더 멀리 보냄 (180 -> 250)
        const centerX = W / 2;
        const imgX = centerX + 250; 
        const imgY = STACK_Y - imgH;

        imgInfo = { x: imgX, y: imgY, w: imgW, h: imgH };

        analysisCtx.clearRect(0, 0, W, H);
        analysisCtx.drawImage(img, imgX, imgY, imgW, imgH);
        imageDataRef.current = analysisCtx.getImageData(0, 0, W, H).data;
      }
    }

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
      });
    }

    for (let i = 0; i < 20; i++) spawn(Math.random() * (STACK_Y - 40));

    // ⭐ [명암 분석] 픽셀의 RGB값을 그대로 가져옴
    function getPixelData(x: number, y: number) {
      if (!imageDataRef.current) return null;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      if (ix < 0 || ix >= W || iy < 0 || iy >= H) return null;

      const idx = (iy * W + ix) * 4;
      const r = imageDataRef.current[idx];
      const g = imageDataRef.current[idx + 1];
      const b = imageDataRef.current[idx + 2];
      const a = imageDataRef.current[idx + 3];

      if (a < 20) return null; 
      return { r, g, b };
    }

    // ⭐ [Winter Ice 컬러링] 밝기에 따라 얼음 색상 매핑
    function getIceColorStyle(r: number, g: number, b: number) {
      // 밝기 계산 (Luminance)
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255; // 0.0 ~ 1.0

      // 어두운 부분(그림자) -> 진한 네이비 블루 (60, 90, 130)
      // 밝은 부분(하이라이트) -> 흰색에 가까운 블루 (200, 240, 255)
      // 이 사이를 보간(Interpolate)합니다.
      
      const targetR = Math.floor(60 + (140 * lum));
      const targetG = Math.floor(90 + (150 * lum));
      const targetB = Math.floor(130 + (125 * lum));
      
      // 약간의 투명도로 얼음 질감
      return `rgba(${targetR}, ${targetG}, ${targetB}, 0.85)`;
    }

    const snowVar = getComputedStyle(document.documentElement).getPropertyValue('--snow-particle').trim() || 'rgba(200,220,255,1)';
    const rgbMatch = snowVar.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    const sR = rgbMatch ? +rgbMatch[1] : 200;
    const sG = rgbMatch ? +rgbMatch[2] : 220;
    const sB = rgbMatch ? +rgbMatch[3] : 255;

    function draw(now: number) {
      animId = requestAnimationFrame(draw);
      
      if (!startTimeRef.current) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(1, elapsed / OLAF_DURATION_MS);
      const allowedBuildHeight = imgInfo.h * progress;

      // 1. 눈속임 (Trick): 명암 적용된 파티클 생성
      for(let k=0; k < TRICK_PARTICLES_PER_FRAME; k++) {
          if (progress >= 1) break; 
          const rx = imgInfo.x + Math.random() * imgInfo.w;
          const ry = STACK_Y - (Math.random() * allowedBuildHeight);

          const pixel = getPixelData(rx, ry);
          if (pixel) {
              // ⭐ 명암 적용된 색상 사용
              offCtx.fillStyle = getIceColorStyle(pixel.r, pixel.g, pixel.b);
              offCtx.beginPath();
              // 약간 작게 찍어서 디테일 살림
              offCtx.arc(rx, ry, 1 + Math.random(), 0, Math.PI * 2);
              offCtx.fill();
          }
      }

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

      ctx!.clearRect(0, 0, W, H);
      ctx!.drawImage(offCanvas, 0, 0, W, H);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        
        if (!p.settled) {
            p.y += p.speed;
            p.x += p.drift + Math.sin(now * 0.0009 + p.wobble) * 0.2;

            const COL_W = 3; 
            const col = Math.max(0, Math.min(COLS - 1, Math.floor(p.x / COL_W)));
            const currentPileH = heightMap[col];
            const collisionY = STACK_Y - currentPileH;

            if (p.y + p.size >= collisionY) {
                const pixel = getPixelData(p.x, collisionY);
                
                let shouldAccumulate = false;
                let bump = p.size * 0.7; 

                if (pixel) {
                    const heightFromGround = STACK_Y - collisionY;
                    if (heightFromGround < allowedBuildHeight + (Math.random() * 5)) {
                        shouldAccumulate = true;
                        // ⭐ 충돌한 눈송이도 명암 색상으로 변신
                        offCtx.fillStyle = getIceColorStyle(pixel.r, pixel.g, pixel.b);
                    }
                } else {
                    if (currentPileH < MAX_SNOW_HEIGHT) {
                        shouldAccumulate = true;
                        offCtx.fillStyle = `rgba(${sR},${sG},${sB},${p.alpha})`;
                    }
                }

                if (shouldAccumulate) {
                    heightMap[col] = Math.min(heightMap[col] + bump, 999); 
                    
                    for (let d = 1; d <= 2; d++) {
                        const falloff = 0.3 / d;
                        if (col - d >= 0) heightMap[col - d] += bump * falloff;
                        if (col + d < COLS) heightMap[col + d] += bump * falloff;
                    }

                    offCtx.beginPath();
                    offCtx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
                    offCtx.fill();
                }

                p.settled = true; 
            }
        }

        if (!p.settled && p.alpha > 0.01 && p.y < H + 20) {
            ctx!.beginPath();
            ctx!.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
            ctx!.fillStyle = `rgba(${sR},${sG},${sB},${p.alpha})`;
            ctx!.fill();
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].settled) particles.splice(i, 1);
      }
    }

    resize();
    animId = requestAnimationFrame(draw);

    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
    };
  }, [isReady]);

  return (
    <div
      onClick={handleWake} 
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'var(--bg-deep)', animation: 'idleFadeIn 0.8s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      
      <div style={{ position: 'relative', zIndex: 10, marginBottom: '80px' }}>
        <Diamond size={64} glow={true} />
        <style>{`@keyframes idlePulse { 0% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.05); opacity: 1; } 100% { transform: scale(1); opacity: 0.8; } }`}</style>
      </div>

      {!isReady && <div style={{color:'rgba(255,255,255,0.3)', fontSize:'12px', position:'absolute', bottom:20}}>Loading...</div>}
      <style>{`@keyframes idleFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}