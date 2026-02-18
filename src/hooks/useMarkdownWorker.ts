import { useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import DOMPurify from 'dompurify';
import type { WorkerRequest, WorkerResponse } from '../workers/markdown.worker';

const htmlCache = new Map<string, string>();

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
      htmlCache.set(e.data.id, DOMPurify.sanitize(e.data.html));
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
