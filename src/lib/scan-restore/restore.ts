/**
 * UltraScan restoration: local illumination correction + cleanup modes, with an
 * ink-preservation check so faint pen strokes, initials and signatures are never
 * silently erased. Pure functions on RGBA buffers (no DOM), so they are testable.
 *
 * No generative model is used: nothing is invented or reconstructed. Each output
 * pixel is a deterministic function of the captured pixel and its local paper
 * brightness.
 */
export type ScanMode = 'auto' | 'ultraClean' | 'originalColor' | 'bw' | 'grayscale' | 'original';

export const SCAN_MODES: { mode: ScanMode; label: string; hint: string }[] = [
  { mode: 'auto', label: 'Auto', hint: 'Balanced cleanup' },
  { mode: 'ultraClean', label: 'Ultra Clean', hint: 'Strong shadow and paper cleanup' },
  { mode: 'originalColor', label: 'Original Color', hint: 'Keeps colored ink and stamps' },
  { mode: 'bw', label: 'Black & White', hint: 'High contrast, printable' },
  { mode: 'grayscale', label: 'Grayscale', hint: 'Natural-looking scan' },
  { mode: 'original', label: 'Original', hint: 'Untouched, cropped only' },
];

export interface Img { data: Uint8ClampedArray; width: number; height: number }

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Per-channel paper-brightness map. Downsample, dilate (max filter removes ink),
 * blur, then sample bilinearly back at full size. Returns 3 Float32 maps.
 */
export function estimatePaper(img: Img): Float32Array[] {
  const { data, width: W, height: H } = img;
  const step = Math.max(4, Math.round(Math.max(W, H) / 96));
  const sw = Math.ceil(W / step), sh = Math.ceil(H / step);
  const out: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    // Downsample: brightest pixel per block (paper, not ink).
    let small: Float32Array = new Float32Array(sw * sh);
    for (let by = 0; by < sh; by++) for (let bx = 0; bx < sw; bx++) {
      let m = 0;
      const y1 = Math.min(H, (by + 1) * step), x1 = Math.min(W, (bx + 1) * step);
      for (let y = by * step; y < y1; y += 2) for (let x = bx * step; x < x1; x += 2) {
        const v = data[(y * W + x) * 4 + c]; if (v > m) m = v;
      }
      small[by * sw + bx] = m;
    }
    // Dilate radius 2 to swallow large ink blobs (signatures, headings).
    small = filter(small, sw, sh, 2, 'max');
    // Smooth radius 2.
    small = filter(small, sw, sh, 2, 'mean');
    // Bilinear upsample.
    const full = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / step - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / step - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
        const a = small[y0 * sw + x0] * (1 - tx) + small[y0 * sw + x1] * tx;
        const b = small[y1 * sw + x0] * (1 - tx) + small[y1 * sw + x1] * tx;
        full[y * W + x] = Math.max(24, a * (1 - ty) + b * ty);
      }
    }
    out.push(full);
  }
  return out;
}

function filter(src: Float32Array, w: number, h: number, r: number, kind: 'max' | 'mean'): Float32Array {
  const dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = kind === 'max' ? 0 : 0, n = 0;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        const v = src[yy * w + xx];
        if (kind === 'max') { if (v > acc) acc = v; } else { acc += v; n++; }
      }
    }
    dst[y * w + x] = kind === 'max' ? acc : acc / Math.max(1, n);
  }
  return dst;
}

/** Normalized luma (paper → ~255) used by the modes and the ink check. */
function normalize(img: Img, paper: Float32Array[]): Float32Array {
  const { data, width: W, height: H } = img;
  const n = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    n[i] = clamp(luma(data[p] / paper[0][i], data[p + 1] / paper[1][i], data[p + 2] / paper[2][i]) * 255);
  }
  return n;
}

/** Post-capture adjustments. Defaults (1, 0, 1) are a no-op. */
export interface RestoreOptions {
  /** Cleanup strength, 0.5 (gentle) – 1.5 (strong). */
  intensity?: number;
  /** Added to every channel, -60 – 60. */
  brightness?: number;
  /** Contrast around mid-grey, 0.5 – 1.5. */
  contrast?: number;
}
export const DEFAULT_RESTORE_OPTIONS: Required<RestoreOptions> = { intensity: 1, brightness: 0, contrast: 1 };

/** Brightness/contrast applied in place on an RGBA buffer. */
export function applyTone(img: Img, brightness = 0, contrast = 1): Img {
  if (brightness === 0 && contrast === 1) return img;
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    d[p] = clamp((d[p] - 128) * contrast + 128 + brightness);
    d[p + 1] = clamp((d[p + 1] - 128) * contrast + 128 + brightness);
    d[p + 2] = clamp((d[p + 2] - 128) * contrast + 128 + brightness);
  }
  return img;
}

export function restoreScan(img: Img, mode: ScanMode, opts: RestoreOptions = {}): Img {
  const { intensity = 1, brightness = 0, contrast = 1 } = opts;
  const t = Math.min(1.5, Math.max(0.5, intensity));
  const { data, width: W, height: H } = img;
  const out = new Uint8ClampedArray(data.length);
  if (mode === 'original') { out.set(data); return applyTone({ data: out, width: W, height: H }, brightness, contrast); }
  const paper = estimatePaper(img);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    const r = (data[p] / paper[0][i]) * 255, g = (data[p + 1] / paper[1][i]) * 255, b = (data[p + 2] / paper[2][i]) * 255;
    const L = luma(r, g, b);
    let R: number, G: number, B: number;
    if (mode === 'originalColor') {
      // Gentle: 80% corrected, keeps ink hue; only near-paper tones go white.
      R = 0.8 * r + 0.2 * data[p]; G = 0.8 * g + 0.2 * data[p + 1]; B = 0.8 * b + 0.2 * data[p + 2];
      if (L > 245 - (t - 1) * 10) R = G = B = 255;
    } else if (mode === 'bw') {
      // Threshold on paper-normalized luma; 228 (same as the ink check) keeps faint pencil/pen strokes.
      R = G = B = L < 228 - (t - 1) * 30 ? 0 : 255;
    } else {
      const k0 = mode === 'ultraClean' ? 1.35 : 1.15, w0 = mode === 'ultraClean' ? 232 : 242;
      const k = 1 + (k0 - 1) * t, white = Math.min(252, Math.max(220, w0 - (t - 1) * 20));
      const s = (v: number) => (L >= white ? 255 : 255 - (255 - v) * k);
      R = s(r); G = s(g); B = s(b);
      if (mode === 'grayscale') { const y = luma(R, G, B); R = G = B = y; }
    }
    out[p] = clamp(R); out[p + 1] = clamp(G); out[p + 2] = clamp(B); out[p + 3] = 255;
  }
  return applyTone({ data: out, width: W, height: H }, brightness, contrast);
}

export interface InkCheck {
  inkPixels: number;
  faintInkPixels: number;
  lostPixels: number;
  lostFaintPixels: number;
  lossRatio: number;
  faintLossRatio: number;
  /** True when cleanup erased a meaningful share of ink — needs human review. */
  needsReview: boolean;
}

/**
 * Compares the captured page with the cleaned page. Ink = pixels clearly darker
 * than their local paper; faint ink = only slightly darker (pencil, light pen,
 * initials). A pixel is "lost" when cleanup turned it into near-white.
 */
export function checkInkPreservation(original: Img, enhanced: Img, paper?: Float32Array[]): InkCheck {
  const pp = paper ?? estimatePaper(original);
  const n = normalize(original, pp);
  const e = enhanced.data;
  let ink = 0, faint = 0, lost = 0, lostFaint = 0;
  for (let i = 0; i < n.length; i++) {
    const v = n[i];
    if (v >= 228) continue;
    const isFaint = v >= 185;
    const outL = luma(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]);
    const gone = outL >= 245;
    ink++; if (gone) lost++;
    if (isFaint) { faint++; if (gone) lostFaint++; }
  }
  const lossRatio = ink ? lost / ink : 0;
  const faintLossRatio = faint ? lostFaint / faint : 0;
  const needsReview = ink >= 50 && (lossRatio > 0.05 || (faint >= 50 && faintLossRatio > 0.15));
  return { inkPixels: ink, faintInkPixels: faint, lostPixels: lost, lostFaintPixels: lostFaint, lossRatio, faintLossRatio, needsReview };
}
