/// <reference lib="webworker" />
import { restoreScan, checkInkPreservation, estimatePaper, type ScanMode, type RestoreOptions } from './restore';

interface Req { id: number; data: Uint8ClampedArray; width: number; height: number; mode: ScanMode; opts: RestoreOptions; checkInk: boolean }

self.onmessage = (ev: MessageEvent<Req>) => {
  const { id, data, width, height, mode, opts, checkInk } = ev.data;
  try {
    const img = { data, width, height };
    const cleaned = restoreScan(img, mode, opts);
    const ink = checkInk ? checkInkPreservation(img, cleaned, estimatePaper(img)) : { needsReview: false, lossRatio: 0 };
    const out = cleaned.data as Uint8ClampedArray<ArrayBuffer>;
    (self as unknown as Worker).postMessage({ id, ok: true, data: out, width: cleaned.width, height: cleaned.height, ink }, [out.buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
