import { describe, it, expect } from 'vitest';
import {
  preprocessForDino,
  patchEmbeddingsFromOutput,
  neighbourSimilarity,
  dinov2SimilarityModel,
} from '@/lib/photo-intelligence/components/onnxModel';

describe('DINOv2 preprocessing', () => {
  it('produces a 1x3x224x224 tensor normalized with ImageNet stats', () => {
    const img = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };
    const { data, dims } = preprocessForDino(img);
    expect(dims).toEqual([1, 3, 224, 224]);
    expect(data.length).toBe(3 * 224 * 224);
    // White pixel → (1 - mean) / std for channel R
    expect(data[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
  });
});

describe('patch embedding grid', () => {
  it('splits tokens into a patch grid, dropping the CLS token', () => {
    const dim = 4, patches = 196;
    const buf = new Float32Array((1 + patches) * dim);
    for (let i = 0; i < buf.length; i++) buf[i] = i;
    const grid = patchEmbeddingsFromOutput({ data: buf, dims: [1, 1 + patches, dim] });
    expect(grid.embeddings).toHaveLength(patches);
    expect(grid.cols).toBe(14);
    expect(grid.rows).toBe(14);
    expect(grid.embeddings[0][0]).toBe(dim); // first patch token, not CLS
  });
});

describe('neighbour similarity', () => {
  it('marks a visually different patch with lower similarity than uniform neighbours', () => {
    const cols = 4, rows = 4, dim = 8;
    const base = new Float32Array(dim).fill(1);
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < cols * rows; i++) embeddings.push(new Float32Array(base));
    // Patch 5 is orthogonal to everything else.
    embeddings[5] = new Float32Array(dim); embeddings[5][0] = 1; embeddings[5][1] = -1;
    const sims = neighbourSimilarity({ embeddings, cols, rows });
    expect(sims[5]).toBeLessThan(sims[0]);
    expect(sims[5]).toBeLessThan(1);
  });

  it('a uniform surface has near-perfect similarity everywhere — no anomaly signal', () => {
    const cols = 3, rows = 3, dim = 8;
    const embeddings = Array.from({ length: 9 }, () => new Float32Array(dim).fill(1));
    const sims = neighbourSimilarity({ embeddings, cols, rows });
    for (const s of sims) expect(s).toBeGreaterThan(0.999);
  });
});

describe('DINOv2 similarity model guardrails', () => {
  it('never reports component regions — segmentation needs a verified head', async () => {
    const model = dinov2SimilarityModel({ modelId: 'dinov2-small', verifiedClasses: [], session: {}, inputName: 'pixel_values' });
    expect(await model.segment({ width: 4, height: 4, data: new Uint8ClampedArray(64) })).toHaveLength(0);
    expect(model.verifiedClasses).toHaveLength(0);
  });

  it('returns null similarity when the model output shape is unexpected', async () => {
    const session = { inputNames: ['pixel_values'], run: async () => ({ out: { data: new Float32Array(4), dims: [4] } }) };
    const model = dinov2SimilarityModel({ modelId: 'dinov2-small', verifiedClasses: [], session, inputName: 'pixel_values' });
    expect(await model.patchSimilarity({ width: 4, height: 4, data: new Uint8ClampedArray(64) })).toBeNull();
  });
});
