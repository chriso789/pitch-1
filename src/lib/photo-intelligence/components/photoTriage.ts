/**
 * Triage a company's existing photos for labeling: sharpness/visibility,
 * near-duplicate detection and a diverse recommended subset. Pure helpers
 * plus one browser runner. Originals are only read, never copied.
 */
import { assessQuality, loadImageForAnalysis, type GrayImage } from '../patternAnalysis';

/** 64-bit difference hash (9×8 luminance grid) as 16 hex chars. */
export function differenceHash(img: GrayImage): string {
  const { width: w, height: h, data } = img;
  const lum = (x: number, y: number) => {
    const i = (Math.min(h - 1, Math.floor(y)) * w + Math.min(w - 1, Math.floor(x))) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const a = lum(((x + 0.5) * w) / 9, ((y + 0.5) * h) / 8), b = lum(((x + 1.5) * w) / 9, ((y + 0.5) * h) / 8);
    bits += a > b ? '1' : '0';
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingHex(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}

export const DUPLICATE_HAMMING = 6;

export interface TriagedPhoto {
  id: string; propertyKey: string;
  hash: string | null; sharpness: number | null; assessable: boolean; issues: string[];
  /** id of an earlier, sharper photo this one nearly duplicates. */
  duplicateOf: string | null;
}

/** Mark near-duplicates (keeping the sharper copy) within one company's set. */
export function markDuplicates(photos: TriagedPhoto[]): TriagedPhoto[] {
  const order = [...photos].sort((a, b) => (b.sharpness ?? -1) - (a.sharpness ?? -1));
  const kept: TriagedPhoto[] = [];
  const dup = new Map<string, string>();
  for (const p of order) {
    if (!p.hash) continue;
    const k = kept.find((q) => hammingHex(q.hash!, p.hash!) <= DUPLICATE_HAMMING);
    if (k) dup.set(p.id, k.id); else kept.push(p);
  }
  return photos.map((p) => ({ ...p, duplicateOf: dup.get(p.id) ?? null }));
}

/**
 * Recommend up to `limit` photos: assessable, non-duplicate, spread across
 * properties round-robin (sharpest first within each property).
 */
export function recommendForLabeling(photos: TriagedPhoto[], limit = 100): TriagedPhoto[] {
  const groups = new Map<string, TriagedPhoto[]>();
  for (const p of photos) {
    if (!p.assessable || p.duplicateOf || p.propertyKey === 'unassigned') continue;
    if (!groups.has(p.propertyKey)) groups.set(p.propertyKey, []);
    groups.get(p.propertyKey)!.push(p);
  }
  for (const g of groups.values()) g.sort((a, b) => (b.sharpness ?? 0) - (a.sharpness ?? 0));
  const out: TriagedPhoto[] = [];
  const lists = [...groups.values()];
  for (let round = 0; out.length < limit && lists.some((l) => l.length > round); round++) {
    for (const l of lists) { if (l[round] && out.length < limit) out.push(l[round]); }
  }
  return out;
}

export async function triagePhotos(photos: { id: string; url: string | null; propertyKey: string }[], onProgress?: (done: number) => void): Promise<TriagedPhoto[]> {
  const out: TriagedPhoto[] = [];
  for (const p of photos) {
    let t: TriagedPhoto = { id: p.id, propertyKey: p.propertyKey, hash: null, sharpness: null, assessable: false, issues: ['Photo could not be opened'], duplicateOf: null };
    if (p.url) {
      try {
        const img = await loadImageForAnalysis(p.url, 256);
        const q = assessQuality(img);
        t = { ...t, hash: differenceHash(img), sharpness: q.sharpness, assessable: q.assessable, issues: q.issues };
      } catch { /* keep "could not be opened" */ }
    }
    out.push(t);
    onProgress?.(out.length);
  }
  return markDuplicates(out);
}
