/**
 * useMarkdownWorker — off-thread markdown rendering with a global shared Web Worker.
 *
 * All hook instances share a single worker (ref-counted) to avoid spawning
 * multiple workers. Rendered HTML is cached by message ID in a module-level Map
 * so re-renders don't retrigger work.
 *
 * Rendering is async: `render()` returns null on the first call and the cached
 * HTML on subsequent calls after the worker responds. Uses `useSyncExternalStore`
 * to trigger re-renders when the cache updates.
 *
 * All output is sanitized with DOMPurify before being cached.
 */
import { useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import DOMPurify from 'dompurify';
import type { WorkerRequest, WorkerResponse } from '../workers/markdown.worker';

const htmlCache = new Map<string, string>();
const HTML_CACHE_MAX = 2000;

/** Evict oldest 50% of entries when cache exceeds max size (Map preserves insertion order). */
function evictCache() {
  if (htmlCache.size <= HTML_CACHE_MAX) return;
  const keys = Array.from(htmlCache.keys());
  const evictCount = Math.floor(keys.length / 2);
  for (let i = 0; i < evictCount; i++) {
    htmlCache.delete(keys[i]);
  }
}

let listeners: Array<() => void> = [];
function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}
function notify() {
  for (const l of listeners) l();
}

let snapshotVersion = 0;
function getSnapshot() { return snapshotVersion; }

let workerInstance: Worker | null = null;
let refCount = 0;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('../workers/markdown.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerInstance.onmessage = (e: MessageEvent<WorkerResponse>) => {
      let html = DOMPurify.sanitize(e.data.html);
      // Wrap bare <table> elements in a scrollable container for overflow handling
      html = html.replace(
        /(<table[\s>])/gi,
        '<div class="table-scroll-wrap">$1'
      ).replace(/<\/table>/gi, '</table></div>');
      htmlCache.set(e.data.id, html);
      evictCache();
      snapshotVersion++;
      notify();
    };
  }
  return workerInstance;
}

export function useMarkdownWorker() {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current = getWorker();
    refCount++;
    return () => {
      refCount--;
      if (refCount === 0 && workerInstance) {
        workerInstance.terminate();
        workerInstance = null;
      }
      workerRef.current = null;
    };
  }, []);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const render = useCallback((id: string, content: string): string | null => {
    const cached = htmlCache.get(id);
    if (cached !== undefined) return cached;
    workerRef.current?.postMessage({ id, content } satisfies WorkerRequest);
    return null;
  }, []);

  const renderBatch = useCallback((items: Array<{ id: string; content: string }>) => {
    const toSend: WorkerRequest[] = [];
    for (const item of items) {
      if (!htmlCache.has(item.id)) {
        toSend.push(item);
      }
    }
    if (toSend.length > 0) {
      workerRef.current?.postMessage(toSend);
    }
  }, []);

  const getCached = useCallback((id: string): string | null => {
    return htmlCache.get(id) ?? null;
  }, []);

  return { render, renderBatch, getCached };
}
