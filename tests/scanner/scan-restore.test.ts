import { describe, it, expect } from 'vitest';
import { restoreScan, checkInkPreservation, type Img } from '@/lib/scan-restore/restore';

// 300x300 page: paper fades from bright (left) to a hard shadow (right), slight
// yellow cast; a dark text bar, and a faint pen stroke inside the shadow.
function page(): Img {
  const W = 300, H = 300, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const light = x < 150 ? 1 : 0.45; // hard shadow edge
    let r = 235 * light, g = 225 * light, b = 190 * light; // yellow light
    const dark = y >= 60 && y < 70 && x >= 20 && x < 280;
    const faint = y >= 200 && y < 203 && x >= 170 && x < 280;
    if (dark) { r *= 0.15; g *= 0.15; b *= 0.15; }
    if (faint) { r *= 0.8; g *= 0.8; b *= 0.8; }
    const p = (y * W + x) * 4; d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
  }
  return { data: d, width: W, height: H };
}
const px = (img: Img, x: number, y: number) => {
  const p = (y * img.width + x) * 4; return [img.data[p], img.data[p + 1], img.data[p + 2]];
};

describe('UltraScan restoration', () => {
  it('auto removes the shadow and yellow cast on both sides', () => {
    const out = restoreScan(page(), 'auto');
    for (const [x, y] of [[40, 150], [250, 150]]) for (const c of px(out, x, y)) expect(c).toBeGreaterThan(240);
    for (const c of px(out, 100, 65)) expect(c).toBeLessThan(80);
    for (const c of px(out, 250, 65)) expect(c).toBeLessThan(80);
  });

  it('keeps the faint pen stroke in shadow in every mode, and passes the ink check', () => {
    const src = page();
    for (const m of ['auto', 'ultraClean', 'originalColor', 'bw', 'grayscale', 'original'] as const) {
      const out = restoreScan(src, m);
      const [r] = px(out, 220, 201);
      expect(r, m).toBeLessThan(245);
      expect(checkInkPreservation(src, out).needsReview, m).toBe(false);
    }
  });

  it('original mode is byte-identical', () => {
    const src = page();
    expect(Array.from(restoreScan(src, 'original').data)).toEqual(Array.from(src.data));
  });

  it('flags cleanup that erases ink for review', () => {
    const src = page();
    const wiped: Img = { ...src, data: new Uint8ClampedArray(src.data.length).fill(255) };
    const r = checkInkPreservation(src, wiped);
    expect(r.inkPixels).toBeGreaterThan(50);
    expect(r.needsReview).toBe(true);
  });
});

describe('UltraScan post-capture adjustments', () => {
  it('default options match the original call exactly', () => {
    const src = page();
    expect(Array.from(restoreScan(src, 'auto', { intensity: 1, brightness: 0, contrast: 1 }).data))
      .toEqual(Array.from(restoreScan(src, 'auto').data));
  });
  it('reprocessing never mutates the source image', () => {
    const src = page(); const copy = Array.from(src.data);
    restoreScan(src, 'ultraClean', { intensity: 1.5, brightness: 30, contrast: 1.4 });
    expect(Array.from(src.data)).toEqual(copy);
  });
  it('strong cleanup that erases ink is still flagged for review', () => {
    const src = page();
    const out = restoreScan(src, 'auto', { brightness: 60, contrast: 0.5 });
    expect(checkInkPreservation(src, out).needsReview).toBe(true);
  });
  it('gentle intensity keeps the faint stroke', () => {
    const src = page();
    for (const m of ['auto', 'ultraClean', 'bw'] as const) {
      const out = restoreScan(src, m, { intensity: 0.5 });
      expect(px(out, 220, 201)[0], m).toBeLessThan(245);
    }
  });
});
