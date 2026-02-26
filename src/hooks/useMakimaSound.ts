/**
 * useMakimaSound — plays Makima TTS voice lines at key moments.
 *
 * Uses Web Audio API (AudioContext) instead of HTMLAudioElement so that
 * sounds play reliably even when the browser tab is in the background.
 * Once the AudioContext is unlocked by a user gesture (click/keydown),
 * it stays active regardless of tab visibility.
 *
 * Categories:
 *   splash   — played when user clicks the splash screen
 *   greeting — played when waking from idle back to chat
 *   done     — played when a task/streaming completes
 *   error    — played when an error occurs during streaming
 *
 * Each category has multiple clips; one is chosen at random (equal probability).
 */

import splashKR from '../assets/sounds/splash_눈사람_KR.wav';
import splashJP from '../assets/sounds/splash_눈사람_JP.wav';
import greetingJP from '../assets/sounds/greeting_반가워_JP.wav';
import greetingKR from '../assets/sounds/greeting_어서와_KR.wav';
import doneJP1 from '../assets/sounds/done_확인해줘_JP.wav';
import doneKR from '../assets/sounds/done_완료했어_KR.wav';
import doneJP2 from '../assets/sounds/done_완료했어_JP.wav';
import errorKR1 from '../assets/sounds/error_문제가생겼어_KR.wav';
import errorKR2 from '../assets/sounds/error_오류가발생했어_KR.wav';
import errorJP1 from '../assets/sounds/error_문제가생겼어_JP.wav';
import errorJP2 from '../assets/sounds/error_오류가발생했어_JP.wav';

const SOUNDS = {
  splash: [splashKR, splashJP],
  greeting: [greetingJP, greetingKR],
  done: [doneJP1, doneKR, doneJP2],
  error: [errorKR1, errorKR2, errorJP1, errorJP2],
} as const;

type SoundCategory = keyof typeof SOUNDS;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Web Audio API singleton ─────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (autoplay policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Unlock AudioContext on first user interaction — once unlocked it stays
// active even when the tab goes to background.
function unlockOnGesture() {
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Remove after first successful unlock
    if (ctx.state === 'running') {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
    }
  };
  document.addEventListener('click', unlock, { passive: true });
  document.addEventListener('keydown', unlock, { passive: true });
  document.addEventListener('touchstart', unlock, { passive: true });
}

// Auto-register unlock listeners
if (typeof document !== 'undefined') {
  unlockOnGesture();
}

async function fetchAndDecode(url: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(url);
  if (cached) return cached;

  const ctx = getAudioContext();
  const response = await fetch(url);
  const arrayBuf = await response.arrayBuffer();
  const audioBuf = await ctx.decodeAudioData(arrayBuf);
  bufferCache.set(url, audioBuf);
  return audioBuf;
}

function playBuffer(buffer: AudioBuffer, volume: number): void {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  source.start(0);
}

// ── Public API ──────────────────────────────────────────────────────────

/** Play a random clip from the given category. Fire-and-forget. */
export function playMakima(category: SoundCategory): void {
  try {
    const src = pickRandom(SOUNDS[category]);
    fetchAndDecode(src)
      .then((buf) => playBuffer(buf, 0.7))
      .catch(() => {/* non-critical */});
  } catch {
    /* non-critical */
  }
}
