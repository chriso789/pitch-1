/**
 * Shared, resilient HEIC/HEIF → JPEG decoding.
 *
 * iPhone HEICs are large and decoding is CPU/memory heavy, so every decode in the
 * app funnels through one global queue. Decoding many at once (parallel uploads or
 * a full photo grid) is what makes conversions silently fail and tiles render blank.
 *
 * Decode strategy, in order:
 *  1. heic2any (works in Chrome/Firefox/Android)
 *  2. native createImageBitmap (Safari/iOS can decode HEIC natively)
 *  3. <img> decode via object URL (last resort for browsers with native support)
 */
import heic2any from 'heic2any';

const MAX_CONCURRENT_DECODES = 2;
let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_DECODES) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => { active++; resolve(); }));
}

function release() {
  active = Math.max(0, active - 1);
  queue.shift()?.();
}

export function isHeicFile(file: { name?: string; type?: string }): boolean {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif') || type === 'image/heic' || type === 'image/heif';
}

async function bitmapToJpegBlob(bitmap: ImageBitmap, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
  });
}

async function decodeViaImgTag(blob: Blob, quality: number): Promise<Blob> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = objectUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) throw new Error('Native HEIC decode unavailable');
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Convert a HEIC/HEIF blob to a JPEG blob. Throws only when every strategy fails.
 */
export async function heicToJpegBlob(blob: Blob, quality = 0.85): Promise<Blob> {
  await acquire();
  try {
    try {
      const converted = await heic2any({ blob, toType: 'image/jpeg', quality });
      const out = Array.isArray(converted) ? converted[0] : converted;
      if (out && out.size > 0) return out;
      throw new Error('heic2any returned empty blob');
    } catch (err) {
      console.warn('[heicDecode] heic2any failed, trying native decode:', err);
    }

    try {
      const bitmap = await createImageBitmap(blob);
      return await bitmapToJpegBlob(bitmap, quality);
    } catch (err) {
      console.warn('[heicDecode] createImageBitmap failed, trying <img> decode:', err);
    }

    return await decodeViaImgTag(blob, quality);
  } finally {
    release();
  }
}
