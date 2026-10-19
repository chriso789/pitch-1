import { describe, it, expect } from 'vitest';
import {
  recognizeComponents,
  refineWithComponents,
  ROOF_COMPONENT_CLASSES,
  UNKNOWN_COMPONENT,
  type ComponentModel,
} from '@/lib/photo-intelligence/components/componentRecognition';
import { analyzePattern } from '@/lib/photo-intelligence/patternAnalysis';

const img = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(128) };

describe('component recognition layer (no model installed)', () => {
  it('declares the supported roofing component classes', () => {
    expect(ROOF_COMPONENT_CLASSES).toContain('clay_tile');
    expect(ROOF_COMPONENT_CLASSES).toContain('exposed_underlayment');
  });

  it('with no model, reports model_not_available and zero regions — never guesses', async () => {
    const out = await recognizeComponents(img);
    expect(out.status).toBe('model_not_available');
    expect(out.regions).toHaveLength(0);
    expect(out.warnings.join(' ')).toMatch(/unknown/i);
  });

  it('downgrades any model class outside the verified list to unknown with null confidence', async () => {
    const model: ComponentModel = {
      modelId: 'stub',
      verifiedClasses: ['clay_tile'],
      segment: async () => [
        { polygonNorm: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], component: 'roof_vent', confidence: 0.9 },
        { polygonNorm: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }], component: 'clay_tile', confidence: 0.8 },
      ],
    };
    const out = await recognizeComponents(img, model);
    expect(out.regions[0].component).toBe(UNKNOWN_COMPONENT);
    expect(out.regions[0].confidence).toBeNull();
    expect(out.regions[1].component).toBe('clay_tile');
  });
});

describe('component-aware refinement', () => {
  function patternWithRegion() {
    const w = 256, h = 256, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let v = 120 + ((x % 16 < 2 || y % 12 < 2) ? -60 : 40) + ((x * 7 + y * 13) % 9);
      if (x >= 96 && x < 128 && y >= 96 && y < 128) v = 20;
      d[i] = v * 1.1; d[i + 1] = v * 0.7; d[i + 2] = v * 0.5; d[i + 3] = 255;
    }
    return analyzePattern({ width: w, height: h, data: d });
  }

  it('labels regions as unmatched to any component instead of upgrading them', async () => {
    const pattern = patternWithRegion();
    const comps = await recognizeComponents(img);
    const refined = refineWithComponents(pattern, comps);
    for (const d of refined.result.detections) {
      expect(d.component).toBe('Unclassified surface');
      expect(d.damageCategory).toBe('possible_anomaly');
      expect(d.condition).toMatch(/No recognized roof component/);
      expect(d.condition).toMatch(/Not confirmed damage/);
    }
  });

  it('passes through photos with no unusual regions unchanged', async () => {
    const w = 256, h = 256, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = 120 + ((x % 16 < 2 || y % 12 < 2) ? -60 : 40) + ((x * 7 + y * 13) % 9);
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    const pattern = analyzePattern({ width: w, height: h, data: d });
    expect(pattern.status).toBe('no_unusual_regions');
    const refined = refineWithComponents(pattern, { status: 'model_not_available', regions: [], warnings: [] });
    expect(refined.result.detections).toHaveLength(0);
  });
});
