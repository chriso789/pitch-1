/**
 * PITCH pattern analysis — zero-custom-training inspection assistance.
 *
 * Runs entirely on PITCH-controlled code (in the browser; no external AI).
 * It answers "what looks different from the surrounding material?", NOT
 * "is this damage?". Every region it returns is a *possible anomaly* for
 * inspector review; it never claims confirmed damage, material, cause or
 * quantity. A photo with no unusual regions is a valid result, distinct
 * from a photo that could not be assessed (blur, dark, overexposed).
 */
import type { Point } from './annotations';
import type { RawDetection, RecognitionResult } from './recognition';

export const PATTERN_PROVIDER_ID = 'pitch-pattern';
export const PATTERN_MODEL_ID = 'cv-grid-v1';

export interface GrayImage { width: number; height: number; /** RGBA bytes */ data: Uint8ClampedArray }

export interface QualityReport {
  brightness: number; contrast: number; sharpness: number;
  issues: string[];
  assessable: boolean;
}

export interface PatternOutcome {
  status: 'regions_found' | 'no_unusual_regions' | 'not_assessable';
  quality: QualityReport;
  cells: { cols: number; rows: number };
  result: RecognitionResult;
}

const GRID = 16;
const Z_THRESHOLD = 3.5;
const MAX_REGIONS = 8;
const MAX_REGION_FRACTION = 0.3;

function luminance(d: Uint8ClampedArray, i: number) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }

export function assessQuality(img: GrayImage): QualityReport {
  const { width: w, height: h, data } = img;
  const L = new Float32Array(w * h);
  let sum = 0;
  for (let p = 0; p < w * h; p++) { L[p] = luminance(data, p * 4); sum += L[p]; }
  const mean = sum / (w * h);
  let v = 0; for (let p = 0; p < w * h; p++) v += (L[p] - mean) ** 2;
  const contrast = Math.sqrt(v / (w * h));
  // Laplacian variance (blur measure)
  let ls = 0, ls2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const lap = L[p - 1] + L[p + 1] + L[p - w] + L[p + w] - 4 * L[p];
    ls += lap; ls2 += lap * lap; n++;
  }
  const sharpness = n ? ls2 / n - (ls / n) ** 2 : 0;
  const issues: string[] = [];
  if (mean < 35) issues.push('Too dark to assess');
  if (mean > 230) issues.push('Overexposed — detail lost');
  if (contrast < 8) issues.push('Very low contrast');
  if (sharpness < 15) issues.push('Blurry — surface detail not resolvable');
  return { brightness: mean, contrast, sharpness, issues, assessable: issues.length === 0 };
}

interface CellFeat { mean: number; std: number; edge: number; chromaA: number; chromaB: number; ori: number }

function cellFeatures(img: GrayImage, cols: number, rows: number): CellFeat[] {
  const { width: w, height: h, data } = img;
  const L = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) L[p] = luminance(data, p * 4);
  const feats: CellFeat[] = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const x0 = Math.floor((cx * w) / cols), x1 = Math.floor(((cx + 1) * w) / cols);
    const y0 = Math.floor((cy * h) / rows), y1 = Math.floor(((cy + 1) * h) / rows);
    let s = 0, s2 = 0, e = 0, a = 0, b = 0, gx2 = 0, gy2 = 0, n = 0;
    for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const p = y * w + x, i = p * 4;
      const l = L[p]; s += l; s2 += l * l;
      const gx = L[p + 1] - L[p - 1], gy = L[p + w] - L[p - w];
      e += Math.hypot(gx, gy); gx2 += gx * gx; gy2 += gy * gy;
      a += data[i] - data[i + 1]; b += (data[i] + data[i + 1]) / 2 - data[i + 2];
      n++;
    }
    n = n || 1;
    const mean = s / n;
    feats.push({ mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), edge: e / n, chromaA: a / n, chromaB: b / n,
      ori: (gx2 - gy2) / (gx2 + gy2 + 1e-6) });
  }
  return feats;
}

function robustZ(values: number[]): number[] {
  const sorted = [...values].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)];
  const dev = values.map((v) => Math.abs(v - med)).sort((x, y) => x - y);
  const mad = dev[Math.floor(dev.length / 2)] * 1.4826 || 1e-6;
  return values.map((v) => (v - med) / mad);
}

function convexHull(pts: Point[]): Point[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const FEATURE_LABELS: Record<keyof CellFeat, string> = {
  mean: 'brightness', std: 'texture', edge: 'edge density', chromaA: 'colour', chromaB: 'colour', ori: 'pattern direction',
};

/** Analyze an RGBA image. Pure — testable without a browser. */
export function analyzePattern(img: GrayImage): PatternOutcome {
  const quality = assessQuality(img);
  const cols = GRID, rows = Math.max(4, Math.round((GRID * img.height) / img.width));
  const base = { providerId: PATTERN_PROVIDER_ID, modelId: PATTERN_MODEL_ID };
  if (!quality.assessable) {
    return { status: 'not_assessable', quality, cells: { cols, rows },
      result: { ...base, detections: [], warnings: quality.issues.map((i) => `Not assessable: ${i}`) } };
  }
  const feats = cellFeatures(img, cols, rows);
  const keys: (keyof CellFeat)[] = ['mean', 'std', 'edge', 'chromaA', 'chromaB', 'ori'];
  const z = keys.map((k) => robustZ(feats.map((f) => f[k])));
  const score = feats.map((_, i) => Math.max(...z.map((zk) => Math.abs(zk[i]))));
  const driver = feats.map((_, i) => keys[z.reduce((best, zk, k) => (Math.abs(zk[i]) > Math.abs(z[best][i]) ? k : best), 0)]);
  const flagged = score.map((s) => s >= Z_THRESHOLD);

  // Connected components (4-neighbour) of flagged cells
  const seen = new Uint8Array(feats.length);
  const regions: number[][] = [];
  for (let i = 0; i < feats.length; i++) {
    if (!flagged[i] || seen[i]) continue;
    const stack = [i], comp: number[] = []; seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!; comp.push(c);
      const cx = c % cols, cy = Math.floor(c / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, ni = ny * cols + nx;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && flagged[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      }
    }
    regions.push(comp);
  }
  const warnings: string[] = [];
  const total = cols * rows;
  const usable = regions.filter((r) => {
    if (r.length / total > MAX_REGION_FRACTION) { warnings.push('A large area differs from the rest of the photo (likely sky, ground or another surface) — not treated as an anomaly.'); return false; }
    return true;
  });
  usable.sort((a, b) => Math.max(...b.map((i) => score[i])) - Math.max(...a.map((i) => score[i])));
  const detections: RawDetection[] = usable.slice(0, MAX_REGIONS).map((comp) => {
    const corners: Point[] = [];
    for (const c of comp) {
      const cx = c % cols, cy = Math.floor(c / cols);
      corners.push({ x: cx / cols, y: cy / rows }, { x: (cx + 1) / cols, y: cy / rows }, { x: cx / cols, y: (cy + 1) / rows }, { x: (cx + 1) / cols, y: (cy + 1) / rows });
    }
    const peak = Math.max(...comp.map((i) => score[i]));
    const why = [...new Set(comp.map((i) => FEATURE_LABELS[driver[i]]))].join(', ');
    return {
      kind: 'polygon' as const,
      polygonNorm: convexHull(corners),
      component: 'Unclassified surface',
      damageCategory: 'possible_anomaly',
      condition: `Possible anomaly — ${why} differs from surrounding material (score ${peak.toFixed(1)}). Not confirmed damage; inspector review required. Shadows, repairs and normal colour variation can cause this.`,
    };
  });
  if (usable.length > MAX_REGIONS) warnings.push(`${usable.length - MAX_REGIONS} weaker unusual regions not shown.`);
  return {
    status: detections.length ? 'regions_found' : 'no_unusual_regions',
    quality, cells: { cols, rows },
    result: { ...base, detections, warnings },
  };
}

/** Browser loader: decode an image URL and downscale for analysis. */
export async function loadImageForAnalysis(url: string, maxSide = 512): Promise<GrayImage & { srcWidth: number; srcHeight: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photo download failed (${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image decoding unavailable');
  ctx.drawImage(bmp, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data, srcWidth: bmp.width, srcHeight: bmp.height };
}
