import { describe, expect, it } from 'vitest';
import {
  addApprovedExample,
  classifyRegion,
  cosineSimilarity,
  emptyLibrary,
  normalizeEmbedding,
  type ReferenceExample,
} from '@/lib/photo-intelligence/components/referenceClassifier';
import { contentHashOf, poolRegionEmbedding, type DinoImageFeatures } from '@/lib/photo-intelligence/components/regionEmbedding';
import { scoreComponentClassification } from '@/lib/photo-intelligence/benchmark';

function emb(seed: number, dim = 8): Float32Array {
  const e = new Float32Array(dim);
  for (let i = 0; i < dim; i++) e[i] = Math.sin(seed * (i + 1));
  return normalizeEmbedding(e);
}

function example(id: string, cls: ReferenceExample['cls'], seed: number): ReferenceExample {
  return { id, cls, embedding: emb(seed), libraryVersion: 1, sourcePhotoId: 'p1', sourceRegionId: 'r1', approvedBy: 'inspector-b' };
}

describe('reference classifier', () => {
  it('returns unknown for an empty library', () => {
    const r = classifyRegion(emb(1), emptyLibrary('dinov2-small'));
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') expect(r.reason).toBe('empty_library');
  });

  it('labels a region only when similarity and margin both clear thresholds', () => {
    let lib = emptyLibrary('dinov2-small');
    lib = addApprovedExample(lib, example('t1', 'clay_tile', 1));
    lib = addApprovedExample(lib, example('s1', 'asphalt_shingle', 7));
    // Query identical to the clay_tile prototype.
    const hit = classifyRegion(emb(1), lib);
    expect(hit.kind).toBe('component');
    if (hit.kind === 'component') expect(hit.cls).toBe('clay_tile');
    // Query far from every prototype → unknown (below similarity).
    const miss = classifyRegion(emb(99), { ...lib, examples: [lib.examples[0]] });
    expect(miss.kind).toBe('unknown');
  });

  it('returns unknown when two classes tie (insufficient margin)', () => {
    let lib = emptyLibrary('dinov2-small');
    lib = addApprovedExample(lib, example('a', 'clay_tile', 1));
    lib = addApprovedExample(lib, example('b', 'concrete_tile', 1)); // identical embedding, different class
    const r = classifyRegion(emb(1), lib);
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') expect(r.reason).toBe('insufficient_margin');
  });

  it('prefers a hard-negative class over a component when it is closer', () => {
    let lib = emptyLibrary('dinov2-small');
    lib = addApprovedExample(lib, example('t1', 'clay_tile', 1));
    lib = addApprovedExample(lib, example('sh1', 'shadow', 2));
    const r = classifyRegion(emb(2), lib);
    expect(r.kind).toBe('hard_negative');
    if (r.kind === 'hard_negative') expect(r.cls).toBe('shadow');
  });

  it('rejects examples without provenance or with duplicate ids', () => {
    const lib = addApprovedExample(emptyLibrary('dinov2-small'), example('t1', 'clay_tile', 1));
    expect(() => addApprovedExample(lib, { ...example('t2', 'clay_tile', 3), approvedBy: '' })).toThrow();
    expect(() => addApprovedExample(lib, example('t1', 'clay_tile', 4))).toThrow(/Duplicate/);
  });

  it('cosine similarity is symmetric and bounded', () => {
    const a = emb(3), b = emb(4);
    const s = cosineSimilarity(a, b);
    expect(s).toBeCloseTo(cosineSimilarity(b, a), 10);
    expect(Math.abs(s)).toBeLessThanOrEqual(1);
  });
});

describe('region embedding pooling', () => {
  const features: DinoImageFeatures = {
    patches: Array.from({ length: 256 }, (_, i) => emb(i + 1)),
    cols: 16, rows: 16, contentHash: 'h', modelId: 'dinov2-small',
  };

  it('pools only patches inside the polygon', () => {
    const quarter = [{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 0.25, y: 0.25 }, { x: 0, y: 0.25 }];
    const e = poolRegionEmbedding(features, quarter);
    expect(e).not.toBeNull();
    expect(e!.length).toBe(8);
  });

  it('returns null for a polygon covering no patch centres', () => {
    const tiny = [{ x: 0.001, y: 0.001 }, { x: 0.002, y: 0.001 }, { x: 0.002, y: 0.002 }];
    expect(poolRegionEmbedding(features, tiny)).toBeNull();
  });

  it('content hash changes with pixels, stable for identical images', () => {
    const mk = (v: number) => ({ width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(v) });
    expect(contentHashOf(mk(7))).toBe(contentHashOf(mk(7)));
    expect(contentHashOf(mk(7))).not.toBe(contentHashOf(mk(8)));
  });
});

describe('component classification benchmark', () => {
  const photos = [{ photoId: 'p1', input: 'unannotated_original' as const, labelsReviewed: true }];
  it('reports per-class precision/recall and unknown rejection separately from damage metrics', () => {
    const labels = [
      { photoId: 'p1', category: 'clay_tile', box: { x: 0, y: 0, width: 0.5, height: 0.5 } },
      { photoId: 'p1', category: 'roof_vent', box: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } },
    ];
    const predictions = [
      { photoId: 'p1', category: 'clay_tile', box: { x: 0, y: 0, width: 0.5, height: 0.5 } },
      { photoId: 'p1', category: 'unknown', box: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } },
      { photoId: 'p1', category: 'clay_tile', box: { x: 0.7, y: 0.1, width: 0.1, height: 0.1 } },
    ];
    const r = scoreComponentClassification(photos, labels, predictions);
    // clay_tile: 1 correct, 1 spurious → precision 0.5; vent: missed.
    expect(r.macroPrecision).toBeCloseTo(0.5);
    expect(r.macroRecall).toBeCloseTo(0.5);
    // The unknown prediction sits on the labeled vent → a missed component,
    // not a correct rejection.
    expect(r.unknownRejection.total).toBe(1);
    expect(r.unknownRejection.correct).toBe(0);
    expect(r.unknownRejection.missedComponents).toBe(1);
    expect(r.classifierKind).toBe('experimental_reference');
  });

  it('counts unknown over unlabeled background as a correct rejection', () => {
    const labels = [{ photoId: 'p1', category: 'clay_tile', box: { x: 0, y: 0, width: 0.5, height: 0.5 } }];
    const predictions = [{ photoId: 'p1', category: 'unknown', box: { x: 0.6, y: 0.6, width: 0.3, height: 0.3 } }];
    const r = scoreComponentClassification(photos, labels, predictions);
    expect(r.unknownRejection.correct).toBe(1);
  });

  it('requires reviewed unannotated originals', () => {
    expect(() => scoreComponentClassification(
      [{ photoId: 'p1', input: 'annotated_reference', labelsReviewed: true }], [], [],
    )).toThrow(/unannotated/);
  });
});
