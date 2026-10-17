import { describe, it, expect } from 'vitest';
import { mapAnalyzerResponse, createAiImageAnalyzerProvider, AI_IMAGE_ANALYZER_PROVIDER_ID } from '@/lib/photo-intelligence/providers/aiImageAnalyzerProvider';
import { validateDetections } from '@/lib/photo-intelligence/recognition';

const photo = { photoId: 'ph1', imageRef: 'base64…', widthPx: 2000, heightPx: 1000 };

describe('ai-image-analyzer provider adapter', () => {
  it('maps coordinated insights to validatable detections', () => {
    const result = mapAnalyzerResponse({
      insights: [{ title: 'Shingles', description: 'Missing tabs', severity: 'high', bbox: [0.1, 0.2, 0.3, 0.1] }],
      analysis_metadata: { model_used: 'gpt-4o-mini' },
    }, 'gpt-4o-mini');
    const batch = validateDetections(result, photo);
    expect(batch.proposals).toHaveLength(1);
    expect(batch.proposals[0].detectionSource).toBe('ai');
    expect(batch.proposals[0].reviewStatus).toBe('pending');
    expect(batch.proposals[0].confidence).toBeNull(); // Severity is not confidence.
  });

  it('rejects coordinate-less observations with a reason and warns — never invents geometry', () => {
    const result = mapAnalyzerResponse({ insights: ['Granule loss visible on south slope'] }, 'gpt-4o-mini');
    expect(result.warnings.some((w) => /no damage coordinates/i.test(w))).toBe(true);
    const batch = validateDetections(result, photo);
    expect(batch.proposals).toHaveLength(0);
    expect(batch.rejected).toHaveLength(1);
    expect(batch.rejected[0].reason).toMatch(/geometry/i);
  });

  it('strips error responses into warnings with zero detections', () => {
    const result = mapAnalyzerResponse({ error: 'rate limited' }, 'gpt-4o-mini');
    expect(result.detections).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/rate limited/);
  });

  it('live provider surfaces request failure as a warning, not a throw', async () => {
    const provider = createAiImageAnalyzerProvider({
      invoke: async () => ({ data: null, error: { message: 'network down' } }),
    });
    const result = await provider.analyze(photo);
    expect(result.providerId).toBe(AI_IMAGE_ANALYZER_PROVIDER_ID);
    expect(result.detections).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/network down/);
  });

  it('live provider maps a successful response end-to-end', async () => {
    const provider = createAiImageAnalyzerProvider({
      invoke: async () => ({
        data: {
          insights: [{ title: 'Ridge vent', description: 'Cracked cap', polygon: [[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]] }],
          analysis_metadata: { model_used: 'gpt-4o-mini' },
        },
        error: null,
      }),
    });
    const result = await provider.analyze(photo);
    const batch = validateDetections(result, photo);
    expect(batch.proposals).toHaveLength(1);
    expect(batch.proposals[0].annotation.kind).toBe('polygon');
    expect(batch.proposals[0].component).toBe('Ridge vent');
  });
});

import { mapAnalyzerResponse } from '@/lib/photo-intelligence/providers/aiImageAnalyzerProvider';

describe('structured detections contract (repaired service)', () => {
  it('maps model-supplied bbox detections with confidence and damage category', () => {
    const result = mapAnalyzerResponse({
      detections: [{
        component: 'shingles', condition: 'missing_shingles',
        description: 'Missing shingles on south slope', severity: 'severe',
        confidence: 0.82, bbox: [0.1, 0.2, 0.3, 0.25],
      }],
    }, 'gpt-4o-mini');
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].bboxNorm).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.25 });
    expect(result.detections[0].damageCategory).toBe('missing_shingles');
    expect(result.detections[0].confidence).toBe(0.82);
  });

  it('flags no_visible_damage detections and rejects coordinate-less detections downstream', () => {
    const withCoords = mapAnalyzerResponse({
      detections: [{ component: 'roof', condition: 'no_visible_damage', bbox: [0, 0, 1, 1], confidence: 0.9 }],
    }, 'gpt-4o-mini');
    expect(withCoords.detections[0].noVisibleDamage).toBe(true);

    const noCoords = mapAnalyzerResponse({
      detections: [{ component: 'siding', condition: 'displaced_siding', confidence: 0.7 }],
    }, 'gpt-4o-mini');
    const photo = { photoId: 'p1', imageRef: 'data:image/jpeg;base64,x' };
    const batch = validateDetections(noCoords, photo);
    expect(batch.proposals).toHaveLength(0);
    expect(batch.rejected).toHaveLength(1);
  });
});
