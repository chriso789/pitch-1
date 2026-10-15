/**
 * Runs scan cleanup + ink check off the main thread so the camera and review
 * screens stay responsive. Falls back to the same pure functions on the main
 * thread when Workers are unavailable. Supports cancellation via AbortSignal.
 * Input pixels are copied before transfer so the caller's original survives.
 */
import { restoreScan, checkInkPreservation, estimatePaper, type Img, type ScanMode, type RestoreOptions, type InkCheck } from './restore';

export interface RestoreResult { img: Img; ink: InkCheck }

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: RestoreResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./restore.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data; const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
      if (m.ok) p.resolve({ img: { data: m.data, width: m.width, height: m.height }, ink: m.ink });
      else p.reject(new Error(m.error));
    };
    worker.onerror = () => { for (const p of pending.values()) p.reject(new Error('Cleanup worker crashed')); pending.clear(); worker?.terminate(); worker = null; };
    return worker;
  } catch { return null; }
}

export function restoreScanSync(img: Img, mode: ScanMode, opts: RestoreOptions, checkInk: boolean): RestoreResult {
  const cleaned = restoreScan(img, mode, opts);
  return { img: cleaned, ink: checkInk ? checkInkPreservation(img, cleaned, estimatePaper(img)) : { needsReview: false, lossRatio: 0 } as InkCheck };
}

export function restoreScanAsync(img: Img, mode: ScanMode, opts: RestoreOptions = {}, checkInk = true, signal?: AbortSignal): Promise<RestoreResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  const w = getWorker();
  if (!w) return Promise.resolve(restoreScanSync(img, mode, opts, checkInk));
  const id = ++seq;
  const copy = new Uint8ClampedArray(img.data); // keep caller's pixels intact
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    signal?.addEventListener('abort', () => { if (pending.delete(id)) reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
    w.postMessage({ id, data: copy, width: img.width, height: img.height, mode, opts, checkInk }, [copy.buffer]);
  });
}
