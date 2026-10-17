import { describe, it, expect } from 'vitest';
import {
  validateDetections,
  associateCrossPhoto,
  clampConfidence,
  detectionToAnnotation,
  type RecognitionResult,
  type RecognitionPhoto,
  type RecognitionProvider,
  type RawDetection,
} from '@/lib/photo-intelligence/recognition';

const photo: RecognitionPhoto = { photoId: 'p1', imageRef: 'signed://x', widthPx: 2000, heightPx: 1000 };

const good: RawDetection = {
  kind: 'bbox',
  bboxPx: { x: 400, y: 200, width: 600, height: 300 },
  component: 'Shingles',
  damageCategory: 'Impact damage',
  condition: 'Hail impacts with granule loss',
  confidence: 0.87,
  buildingLabel: 'Building A',
};

function resultWith(detections: RawDetection[]): RecognitionResult {
  return { providerId: 'test-provider', modelId: 'test-model', detections };
}

describe('recognition validation', () => {
  it('converts pixel bboxes to normalized editable geometry', () => {
    const batch = validateDetections(resultWith([good]), photo);
    expect(batch.proposals).toHaveLength(1);
    const p = batch.proposals[0];
    expect(p.annotation.kind).toBe('bbox');
    if (p.annotation.kind === 'bbox') {
      expect(p.annotation.origin).toEqual({ x: 0.2, y: 0.2 });
      expect(p.annotation.size).toEqual({ x: 0.3, y: 0.3 });
    }
    expect(p.confidence).toBeCloseTo(0.87);
  });

  it('every proposal is forced to ai + pending — never pre-approved', () => {
    const batch = validateDetections(resultWith([good]), photo);
    for (const p of batch.proposals) {
      expect(p.detectionSource).toBe('ai');
      expect(p.reviewStatus).toBe('pending');
    }
  });

  it('rejects detections missing condition or component, with reasons', () => {
    const batch = validateDetections(
      resultWith([
        { ...good, condition: '' },
        { ...good, component: undefined },
      ]),
      photo,
    );
    expect(batch.proposals).toHaveLength(0);
    expect(batch.rejected).toHaveLength(2);
    expect(batch.rejected.map((r) => r.reason)).toEqual([
      'Missing condition description',
      'Missing component identification',
    ]);
  });

  it('rejects unusable geometry instead of guessing', () => {
    const batch = validateDetections(
      resultWith([
        { ...good, kind: 'polygon', polygonPx: [{ x: 1, y: 1 }, { x: 2, y: 2 }], bboxPx: undefined },
      ]),
      photo,
    );
    expect(batch.proposals).toHaveLength(0);
    expect(batch.rejected[0].reason).toMatch(/geometry/);
  });

  it('clamps confidence and records "no visible damage" candidates', () => {
    expect(clampConfidence(1.7)).toBe(1);
    expect(clampConfidence(-2)).toBe(0);
    expect(clampConfidence('high')).toBeNull();
    const clean = validateDetections(resultWith([{ ...good, noVisibleDamage: true, damageCategory: 'No visible damage' }]), photo);
    expect(clean.proposals[0].noVisibleDamage).toBe(true);
  });

  it('converts pixel polygons using photo dimensions', () => {
    const ann = detectionToAnnotation(
      { kind: 'polygon', polygonPx: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 1000, y: 1000 }], component: 'Ridge', condition: 'Cracked ridge cap' },
      photo,
      'x',
    );
    expect(ann?.kind).toBe('polygon');
    if (ann?.kind === 'polygon') expect(ann.points[2]).toEqual({ x: 0.5, y: 1 });
  });
});

describe('cross-photo association', () => {
  it('groups the same building+component+category across photos into one finding', () => {
    const b1 = validateDetections(resultWith([good]), photo).proposals[0];
    const b2 = validateDetections(resultWith([good]), { ...photo, photoId: 'p2' }).proposals[0];
    const other = validateDetections(resultWith([{ ...good, damageCategory: 'Ponding / drainage' }]), photo).proposals[0];
    const groups = associateCrossPhoto([b1, b2, other]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.length === 2)).toEqual([0, 1]);
  });
});

describe('provider contract (test harness)', () => {
  it('a stub provider flows through validation end-to-end', async () => {
    const stub: RecognitionProvider = {
      providerId: 'stub',
      modelId: 'stub-1',
      analyze: async () => ({ ...resultWith([good]), providerId: 'stub', modelId: 'stub-1' }),
    };
    const result = await stub.analyze(photo);
    const batch = validateDetections(result, photo);
    expect(batch.proposals).toHaveLength(1);
    expect(batch.proposals[0].providerId).toBe('stub');
  });
});
