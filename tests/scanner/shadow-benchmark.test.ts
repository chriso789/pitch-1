/**
 * Milestone D — synthetic shadow-cleanup benchmark (deterministic, generated in code).
 * Page: printed text bars, fine print, a faint simulated signature, checkbox, a fold line,
 * a hard diagonal shadow and uneven (vignetted, yellow) lighting. Metrics are printed for the
 * tracking docs. OCR character error rate and real-photo results are NOT measured here.
 */
import { describe, it, expect } from 'vitest';
import { restoreScan, checkInkPreservation, estimatePaper, type Img, type ScanMode } from '@/lib/scan-restore/restore';

const W = 600, H = 800;
type Mask = Uint8Array; // 1=ink 2=faint ink 3=fold
function build(): { img: Img; mask: Mask } {
  const d = new Uint8ClampedArray(W * H * 4), mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const vignette = 1 - 0.25 * Math.hypot((x - W / 2) / W, (y - H / 2) / H);
    const shadow = x + y > 900 ? 0.45 : 1; // hard diagonal shadow
    let l = vignette * shadow, r = 238 * l, g = 228 * l, b = 195 * l;
    const text = (y % 40 < 6 && y > 40 && y < 520 && x > 40 && x < 560 && (x % 30) < 24);
    const fine = (y > 540 && y < 600 && y % 8 < 2 && x > 40 && x < 400 && x % 6 < 4);
    const box = (y > 620 && y < 650 && x > 40 && x < 70) && (y < 623 || y > 646 || x < 43 || x > 66);
    const sig = Math.abs(y - (700 + 15 * Math.sin(x / 18))) < 1.5 && x > 300 && x < 560;
    const fold = x === 300;
    if (text || fine || box) { r *= 0.15; g *= 0.15; b *= 0.15; mask[i] = 1; }
    else if (sig) { r *= 0.72; g *= 0.74; b *= 0.85; mask[i] = 2; }
    else if (fold) { r *= 0.9; g *= 0.9; b *= 0.9; mask[i] = 3; }
    const p = i * 4; d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
  }
  return { img: { data: d, width: W, height: H }, mask };
}
const lum = (im: Img, i: number) => 0.299 * im.data[i * 4] + 0.587 * im.data[i * 4 + 1] + 0.114 * im.data[i * 4 + 2];

function metrics(src: Img, out: Img, mask: Mask) {
  let paperSum = 0, paperN = 0, paperShadowSum = 0, paperShadowN = 0, inkSum = 0, inkN = 0, faintSum = 0, faintN = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, L = lum(out, i);
    if (mask[i] === 0) { paperSum += L; paperN++; if (x + y > 900) { paperShadowSum += L; paperShadowN++; } }
    else if (mask[i] === 1) { inkSum += L; inkN++; }
    else if (mask[i] === 2) { faintSum += L; faintN++; }
  }
  const paper = paperSum / paperN, paperShadow = paperShadowSum / paperShadowN;
  return { paper, paperShadow, shadowResidual: paper - paperShadow, ink: inkSum / inkN, faint: faintSum / faintN, faintContrast: paper - faintSum / faintN };
}

describe('Milestone D — synthetic shadow benchmark', () => {
  const { img, mask } = build();
  const before = metrics(img, img, mask);
  const rows: Record<string, any> = { input: { ...before, ms: 0 } };
  for (const mode of ['auto', 'ultraClean', 'originalColor', 'grayscale', 'bw'] as ScanMode[]) {
    it(`${mode}: removes shadow, keeps text and faint signature visible`, () => {
      const t0 = performance.now();
      const out = restoreScan(img, mode);
      const ms = performance.now() - t0;
      const m = metrics(img, out, mask);
      rows[mode] = { ...m, ms: Math.round(ms) };
      expect(m.shadowResidual).toBeLessThan(before.shadowResidual * 0.5); // shadow at least halved
      expect(m.paper - m.ink).toBeGreaterThan(120);                       // printed text stays dark
      expect(m.faintContrast).toBeGreaterThan(15);                        // signature not erased
      const ink = checkInkPreservation(img, out, estimatePaper(img));
      if (m.faintContrast < 30) expect(ink.needsReview).toBe(true);       // weak signature ⇒ flagged
    });
  }
  it('original mode leaves pixels byte-identical (signed content never altered)', () => {
    const out = restoreScan(img, 'original');
    expect(Buffer.from(out.data).equals(Buffer.from(img.data))).toBe(true);
  });
  it('prints the benchmark table', () => {
    // eslint-disable-next-line no-console
    console.log('[shadow-benchmark]', JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, Math.round(Number(b) * 10) / 10]))]))));
    expect(Object.keys(rows).length).toBeGreaterThan(1);
  });
});
