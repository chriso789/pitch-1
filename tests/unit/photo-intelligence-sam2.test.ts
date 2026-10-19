import { describe, it, expect } from 'vitest';
import { preprocessForSam, maskToPolygonNorm, sam2SegmentationModel } from '@/lib/photo-intelligence/components/onnxModel';

describe('SAM 2.1 preprocessing', () => {
  it('produces a 1x3x1024x1024 tensor with ImageNet normalization', () => {
    const img = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(0) };
    const { data, dims } = preprocessForSam(img);
    expect(dims).toEqual([1, 3, 1024, 1024]);
    // Black pixel → (0 - mean) / std for channel R
    expect(data[0]).toBeCloseTo((0 - 0.485) / 0.229, 4);
  });
});

describe('mask to polygon', () => {
  it('extracts a normalized polygon for a solid mask region', () => {
    const side = 256;
    const mask = new Float32Array(side * side).fill(-5);
    for (let y = 50; y < 100; y++) for (let x = 60; x < 140; x++) mask[y * side + x] = 5;
    const poly = maskToPolygonNorm(mask, side);
    expect(poly).not.toBeNull();
    const xs = poly!.map((p) => p.x), ys = poly!.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(60 / 256, 1);
    expect(Math.max(...xs)).toBeCloseTo(140 / 256, 1);
    expect(Math.min(...ys)).toBeCloseTo(50 / 256, 1);
  });

  it('rejects empty and tiny masks instead of inventing geometry', () => {
    const side = 256;
    expect(maskToPolygonNorm(new Float32Array(side * side).fill(-5), side)).toBeNull();
    const tiny = new Float32Array(side * side).fill(-5); tiny[0] = 5;
    expect(maskToPolygonNorm(tiny, side)).toBeNull();
  });
});

describe('SAM 2.1 segmentation model guardrails', () => {
  it('reports no verified classes — masks are unlabeled regions, never named components', () => {
    const model = sam2SegmentationModel(
      { modelId: 'e', verifiedClasses: [], session: {}, inputName: 'pixel_values' },
      { modelId: 'd', verifiedClasses: [], session: {}, inputName: 'x' },
    );
    expect(model.modelId).toBe('sam2.1-hiera-tiny');
    expect(model.verifiedClasses).toHaveLength(0);
  });
});
