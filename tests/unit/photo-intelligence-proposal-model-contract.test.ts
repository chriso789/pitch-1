import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ features: vi.fn() }));
vi.mock('@/lib/photo-intelligence/patternAnalysis', () => ({
  loadImageForAnalysis: async () => ({ width: 384, height: 512 }),
  analyzePattern: () => ({ result: { detections: [] } }),
}));
vi.mock('@/lib/photo-intelligence/components/onnxModel', () => ({
  loadComponentModel: async () => ({ modelId: 'sam2.1-hiera-tiny', segment: async () => [] }),
  loadDinoSession: async () => ({ modelId: 'dinov2-small' }),
}));
vi.mock('@/lib/photo-intelligence/components/regionEmbedding', () => ({
  dinoFeaturesForImage: mocks.features, poolRegionEmbedding: vi.fn(),
}));
import { proposeRegions } from '@/lib/photo-intelligence/components/regionProposals';
describe('proposal execution evidence', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reports the canonical DINOv2 identity only after features execute', async () => {
    mocks.features.mockResolvedValue({ modelId: 'dinov2-small' });
    const result = await proposeRegions('private-photo', { version: 0, embeddingModelId: 'dinov2-small', examples: [] });
    expect(result.models.embedder).toBe('dinov2-small');
    expect(result.models.segmenter).toBe('sam2.1-hiera-tiny');
  });
  it('does not claim DINOv2 completed merely because a session loaded', async () => {
    mocks.features.mockResolvedValue(null);
    const result = await proposeRegions('private-photo', { version: 0, embeddingModelId: 'dinov2-small', examples: [] });
    expect(result.models.embedder).toBeNull();
  });
});