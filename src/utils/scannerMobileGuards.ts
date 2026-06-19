// Mobile / low-memory guardrails for the scanner.
// All values are conservative and fail-open: when the API is unavailable we
// assume a normal device.

import type { PdfProfile } from './scannerExtras';

export interface DeviceMemoryProfile {
  deviceMemoryGb: number | null;
  isLowMemory: boolean;
  recommendedPdfProfile: PdfProfile;
  previewMaxEdgePx: number;
  warnArchiveMode: boolean;
}

export function detectDeviceMemoryProfile(): DeviceMemoryProfile {
  const mem = (navigator as any).deviceMemory as number | undefined;
  const memVal = typeof mem === 'number' ? mem : null;
  const low = memVal !== null && memVal <= 2;
  return {
    deviceMemoryGb: memVal,
    isLowMemory: low,
    recommendedPdfProfile: low ? 'standard' : 'standard',
    previewMaxEdgePx: low ? 1200 : 2000,
    warnArchiveMode: low,
  };
}

/**
 * Track object URLs you create so they can all be released on unmount /
 * dialog close. Aggressively prevents leaks on mobile Safari.
 */
export class ObjectUrlRegistry {
  private urls = new Set<string>();

  create(blob: Blob): string {
    const u = URL.createObjectURL(blob);
    this.urls.add(u);
    return u;
  }

  revoke(url: string) {
    if (this.urls.delete(url)) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* noop */
      }
    }
  }

  revokeAll() {
    for (const u of this.urls) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* noop */
      }
    }
    this.urls.clear();
  }

  size() {
    return this.urls.size;
  }
}

/** Convenience: downscale a canvas in-place to bound peak memory. */
export function downscaleCanvasInPlace(
  canvas: HTMLCanvasElement,
  maxEdgePx: number,
): HTMLCanvasElement {
  const maxEdge = Math.max(canvas.width, canvas.height);
  if (maxEdge <= maxEdgePx) return canvas;
  const scale = maxEdgePx / maxEdge;
  const w = Math.round(canvas.width * scale);
  const h = Math.round(canvas.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(canvas, 0, 0, w, h);
  return c;
}
