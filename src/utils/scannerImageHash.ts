// Lightweight 8x8 average-hash (aHash) for near-duplicate page detection.
// Returns a 64-bit hash as a hex string. Hamming distance compares similarity.

export async function computeImageHash(blob: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const ctx = c.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return '';
    }
    ctx.drawImage(bitmap, 0, 0, 8, 8);
    bitmap.close();
    const data = ctx.getImageData(0, 0, 8, 8).data;
    const grays: number[] = [];
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      grays.push(g);
      total += g;
    }
    const avg = total / grays.length;
    let bits = '';
    for (const g of grays) bits += g >= avg ? '1' : '0';
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(bits.substring(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return '';
  }
}

export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    d += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return d;
}

// <=6 bits different out of 64 ≈ very likely the same page
export const DUPLICATE_HAMMING_THRESHOLD = 6;
