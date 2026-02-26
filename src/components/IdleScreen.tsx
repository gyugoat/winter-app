/**
 * IdleScreen — full-screen screensaver shown after prolonged inactivity.
 *
 * Renders an interactive snow-accumulation canvas where flakes progressively
 * reveal an Olaf image by stamping ice-colored particles matching each pixel's
 * hue. The Olaf silhouette is fully revealed after 10 minutes.
 *
 * Any keydown or mousedown event wakes the app and unmounts this screen.
 * The `onWake` callback must be wired to clear the idle state in the parent.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Diamond } from './Diamond';
import { playMakima } from '../hooks/useMakimaSound';
import olafImgSrc from '../assets/olaf.png';

interface IdleScreenProps {
  /** Called when the user interacts to dismiss the idle screen */
  onWake: () => void;
}

/** Renders the full-screen idle screensaver with snow canvas and pulsing diamond */
export function IdleScreen({ onWake }: IdleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<number>(0);
  
  const imageBitmapRef = useRef<HTMLImageElement | null>(null);
  const imageDataRef = useRef<Uint8ClampedArray | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const clickedRef = useRef(false);
  const clickTimeRef = useRef(0);

  const handleWake = useCallback(() => {
    if (!clickedRef.current) {
      clickedRef.current = true;
      clickTimeRef.current = performance.now();
      playMakima('greeting');
      // Same timing as Splash: 1600ms snow-fall, then 500ms fade-out
      setTimeout(() => {
        setFadeOut(true);
        setTimeout(onWake, 500);
      }, 1600);
    }
  }, [onWake]);

  // Wake only on click — the div already has onClick={handleWake}.
  // Removed keydown/mousedown listeners so idle screen stays until clicked.

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
    const MAX_PARTICLES = 30; 
    const MAX_SNOW_HEIGHT = 40; 
    const OLAF_DURATION_MS = 10 * 60 * 1000; // 10분
    const TRICK_PARTICLES_PER_FRAME = 3; 

    const dpr = window.devicePixelRatio || 1;
    let W: number, H: number;
    
    // ⭐ [수정 핵심] 초기값을 0으로 확실하게 할당! (에러 원인 해결)
    let STACK_Y = 0; 
    
    let COLS: number;
    let heightMap: Float32Array; 
    let animId: number;
    let spawnAccum = 0; 

    const offCanvas = document.createElement('canvas');
    const offCtxRaw = offCanvas.getContext('2d');
    
    const analysisCanvas = document.createElement('canvas');
    const analysisCtxRaw = analysisCanvas.getContext('2d');

    if (!offCtxRaw || !analysisCtxRaw) return;
    const offCtx = offCtxRaw;
    const analysisCtx = analysisCtxRaw;

    let imgInfo = { x: 0, y: 0, w: 0, h: 0 };

    let settledY = 0;
    let settledVY = 0;

    interface Particle { 
      x: number; y: number; 
      size: number; alpha: number;
      speed: number; drift: number; 
      wobble: number; settled: boolean;
      vy: number;
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
        const targetHeight = H * 0.18; 
        const scale = targetHeight / img.height;
        
        const imgW = img.width * scale;
        const imgH = img.height * scale;
        
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
        vy: 0,
      });
    }

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

    function getIceColorStyle(r: number, g: number, b: number) {
      let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      lum = Math.pow(lum, 4); 

      const shadowR = 30, shadowG = 50, shadowB = 90;
      const lightR = 210, lightG = 245, lightB = 255;

      const targetR = Math.floor(shadowR + ((lightR - shadowR) * lum));
      const targetG = Math.floor(shadowG + ((lightG - shadowG) * lum));
      const targetB = Math.floor(shadowB + ((lightB - shadowB) * lum));
      
      return `rgba(${targetR}, ${targetG}, ${targetB}, 0.95)`;
    }

    const snowVar = getComputedStyle(document.documentElement).getPropertyValue('--snow-particle').trim() || 'rgba(200,220,255,1)';
    const rgbMatch = snowVar.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    const sR = rgbMatch ? +rgbMatch[1] : 200;
    const sG = rgbMatch ? +rgbMatch[2] : 220;
    const sB = rgbMatch ? +rgbMatch[3] : 255;

    let lastTime = 0;
    const TARGET_INTERVAL = 1000 / 60; // 60fps baseline

    function draw(now: number) {
      if (!lastTime) lastTime = now;
      const dt = Math.min(now - lastTime, 100) / TARGET_INTERVAL;
      lastTime = now;

      if (!startTimeRef.current) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(1, elapsed / OLAF_DURATION_MS);
      const allowedBuildHeight = imgInfo.h * progress;

      const clicked = clickedRef.current;

      ctx!.clearRect(0, 0, W, H);

      // 1. 눈속임 파티클 (only when not clicked)
      if (!clicked) {
        for(let k=0; k < TRICK_PARTICLES_PER_FRAME; k++) {
            if (progress >= 1) break; 
            const rx = imgInfo.x + Math.random() * imgInfo.w;
            const ry = STACK_Y - (Math.random() * allowedBuildHeight);

            const pixel = getPixelData(rx, ry);
            if (pixel) {
                offCtx.fillStyle = getIceColorStyle(pixel.r, pixel.g, pixel.b);
                offCtx.beginPath();
                offCtx.arc(rx, ry, 0.8 + Math.random(), 0, Math.PI * 2);
                offCtx.fill();
            }
        }
      }

      // Spawn new particles only when not clicked
      if (!clicked) {
        spawnAccum += 0.8 * dt;
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

      // When clicked, settled snow (offscreen canvas) falls with gravity
      if (clicked) {
        settledVY += 0.35 * dt;
        settledY += settledVY * dt;
      }

      // Blit settled snow layer (with Y offset when falling)
      ctx!.drawImage(offCanvas, 0, settledY, W, H);

      let allOffScreen = true;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        
        if (clicked) {
          // All particles fall with gravity (same physics as Splash)
          p.settled = false;
          p.vy += 0.35 * dt;
          p.y += p.vy * dt;
          p.x += p.drift * 0.5 * dt;
          if (p.y < H + 20) allOffScreen = false;
        } else if (!p.settled) {
            p.y += p.speed * dt;
            p.x += (p.drift + Math.sin(now * 0.0009 + p.wobble) * 0.2) * dt;

            const COL_W = 3; 
            const col = Math.max(0, Math.min(COLS - 1, Math.floor(p.x / COL_W)));
            const currentPileH = heightMap[col];
            const collisionY = STACK_Y - currentPileH;

            if (p.y + p.size >= collisionY) {
                const pixel = getPixelData(p.x, collisionY);
                
                let shouldAccumulate = false;
                const bump = p.size * 0.7; 

                if (pixel) {
                    const heightFromGround = STACK_Y - collisionY;
                    if (heightFromGround < allowedBuildHeight + (Math.random() * 5)) {
                        shouldAccumulate = true;
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

      if (!clicked) {
        for (let i = particles.length - 1; i >= 0; i--) {
          if (particles[i].settled) particles.splice(i, 1);
        }
      }

      // Stop animation when everything has fallen off screen
      if (clicked && allOffScreen && settledY > H) return;
      animId = requestAnimationFrame(draw);
    }

    // ⭐ 순서 중요! resize 먼저 -> spawn 나중에
    resize();
    for (let i = 0; i < 20; i++) spawn(Math.random() * (STACK_Y - 40));
    
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
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.4s ease',
        pointerEvents: fadeOut ? 'none' : 'auto',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      
      <div style={{
        position: 'relative', zIndex: 10, marginBottom: '80px',
        transition: 'transform 0.6s ease, opacity 0.4s ease',
        transform: fadeOut ? 'scale(0.6)' : 'scale(1)',
        opacity: fadeOut ? 0 : 1,
      }}>
        <Diamond size={64} glow={true} />
        <style>{`@keyframes idlePulse { 0% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.05); opacity: 1; } 100% { transform: scale(1); opacity: 0.8; } }`}</style>
      </div>

      {!isReady && <div style={{color:'rgba(255,255,255,0.3)', fontSize:'12px', position:'absolute', bottom:20}}>Loading...</div>}
      <style>{`@keyframes idleFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}