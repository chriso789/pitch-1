import { describe, it, expect } from 'vitest';
import {
  classifyAspectRatio,
  dominantPageSize,
} from '@/utils/documentPageSize';
import { hammingDistance, DUPLICATE_HAMMING_THRESHOLD } from '@/utils/scannerImageHash';
import { analyzeEdgeForInset } from '@/utils/scannerEdgeAnalysis';

// ---------------------------------------------------------------------------
// Synthetic-canvas helper (jsdom has no real canvas). We only need the API
// surface analyzeEdgeForInset touches: width/height/getContext('2d') with
// a getImageData() that returns Uint8ClampedArray RGBA data.
// ---------------------------------------------------------------------------
function makeFakeCanvas(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => [number, number, number],
): any {
  const getImageData = (sx: number, sy: number, sw: number, sh: number) => {
    const buf = new Uint8ClampedArray(sw * sh * 4);
    let i = 0;
    for (let y = sy; y < sy + sh; y++) {
      for (let x = sx; x < sx + sw; x++) {
        const [r, g, b] = pixelAt(x, y);
        buf[i++] = r;
        buf[i++] = g;
        buf[i++] = b;
        buf[i++] = 255;
      }
    }
    return { data: buf, width: sw, height: sh } as any;
  };
  return {
    width,
    height,
    getContext: () => ({ getImageData }),
  };
}

describe('scanner fixtures — page-size classification', () => {
  it('classifies letter (11 / 8.5)', () => {
    expect(classifyAspectRatio(11, 8.5)).toBe('letter');
  });
  it('classifies legal (14 / 8.5)', () => {
    expect(classifyAspectRatio(14, 8.5)).toBe('legal');
  });
  it('classifies A4 (297 / 210)', () => {
    expect(classifyAspectRatio(297, 210)).toBe('a4');
  });
  it('rejects a square (busy background / full-frame capture)', () => {
    expect(classifyAspectRatio(1000, 1000)).toBe('unknown');
  });
  it('picks dominant size across a mixed batch', () => {
    expect(dominantPageSize(['letter', 'letter', 'legal', 'unknown'])).toBe('letter');
    expect(dominantPageSize(['unknown', 'unknown'])).toBe('letter');
  });
});

describe('scanner fixtures — duplicate hash detector', () => {
  it('reports zero distance for identical hashes', () => {
    const h = 'abcdef0123456789';
    expect(hammingDistance(h, h)).toBe(0);
  });
  it('flags near-duplicate pages under the threshold', () => {
    // Single bit difference between hex digits a (1010) and 8 (1000): distance 1.
    expect(hammingDistance('a000000000000000', '8000000000000000')).toBeLessThanOrEqual(
      DUPLICATE_HAMMING_THRESHOLD,
    );
  });
  it('treats very different hashes as non-duplicates', () => {
    expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
  });
  it('returns 64 for malformed input', () => {
    expect(hammingDistance('', 'abc')).toBe(64);
  });
});

describe('scanner fixtures — edge cleanup quality gate', () => {
  it('applies inset for a clean white document on dark background', () => {
    // White interior; analyzer only samples the border band.
    const fake = makeFakeCanvas(200, 200, () => [240, 240, 240]);
    const r = analyzeEdgeForInset(fake);
    expect(r.applyInset).toBe(true);
    expect(r.reason).toBe('clean-edge');
  });

  it('skips inset when signatures / ink hug the edge', () => {
    // Dark border (signature near edge) — analyzer should preserve content.
    const fake = makeFakeCanvas(200, 200, () => [10, 10, 10]);
    const r = analyzeEdgeForInset(fake);
    expect(r.applyInset).toBe(false);
    expect(r.reason).toBe('ink-near-edge');
    expect(r.inkRatioNearEdge).toBeGreaterThan(0.04);
  });

  it('tolerates shadowed but not dark-inked edges', () => {
    // Mid-grey shadow — above the dark threshold (90), so no skip.
    const fake = makeFakeCanvas(200, 200, () => [140, 140, 140]);
    const r = analyzeEdgeForInset(fake);
    expect(r.applyInset).toBe(true);
  });
});
