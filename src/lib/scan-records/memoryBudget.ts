/**
 * Memory budgeting for multipage scans. Decoded RGBA frames are width*height*4 bytes and a
 * cleanup pass holds ~3 copies (source, cleaned, encoded canvas). Concurrency is chosen so
 * the in-flight working set stays under the device budget. Captured originals are stored as
 * compressed JPEG blobs and are never dropped or downscaled to relieve memory.
 */
export const BYTES_PER_PIXEL = 4;
export const WORKING_COPIES = 3;

export function frameBytes(width: number, height: number) { return width * height * BYTES_PER_PIXEL; }

/** Device budget for in-flight cleanup work, from navigator.deviceMemory (GB) when available. */
export function workingBudgetBytes(deviceMemoryGb?: number) {
  const gb = deviceMemoryGb && deviceMemoryGb > 0 ? deviceMemoryGb : 2; // conservative default for phones
  return Math.min(256, Math.max(48, gb * 32)) * 1024 * 1024;
}

export function chooseConcurrency(width: number, height: number, deviceMemoryGb?: number, max = 4) {
  const per = frameBytes(width, height) * WORKING_COPIES;
  return Math.max(1, Math.min(max, Math.floor(workingBudgetBytes(deviceMemoryGb) / Math.max(1, per))));
}

/** Total stored bytes of a scan: originals are counted and must all survive. */
export function scanStorageBytes(pages: { blob?: Blob | null; originalBlob?: Blob | null }[]) {
  let processed = 0, originals = 0;
  for (const p of pages) { processed += p.blob?.size ?? 0; originals += p.originalBlob?.size ?? 0; }
  return { processed, originals, total: processed + originals };
}

export function currentDeviceMemory(): number | undefined {
  return typeof navigator !== 'undefined' ? (navigator as any).deviceMemory : undefined;
}
