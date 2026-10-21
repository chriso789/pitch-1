import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSharedPhotos } from '@/lib/photo-intelligence/training/sharedPreparation';

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), decode: vi.fn(), save: vi.fn(), propose: vi.fn() }));
vi.mock('@/lib/photo-intelligence/training/sharedInventory', () => ({ loadSharedInventory: mocks.inventory }));
vi.mock('@/lib/edgeApi', () => ({ edgeApi: mocks.save }));
vi.mock('@/lib/photo-intelligence/patternAnalysis', () => ({ loadImageForAnalysis: mocks.decode, assessQuality: () => ({ assessable: true, sharpness: 100, brightness: 100, issues: [] }) }));
vi.mock('@/lib/photo-intelligence/components/regionProposals', () => ({ proposeRegions: mocks.propose }));
vi.mock('@/lib/photo-intelligence/components/photoTriage', () => ({ differenceHash: () => null, markDuplicates: (p: unknown[]) => p, recommendForLabeling: (p: unknown[], limit: number) => p.slice(0, limit) }));

describe('foreground browser acceptance preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inventory.mockResolvedValue({ photos: Array.from({ length: 100 }, (_, i) => ({ id: String(i), tenantId: 'company', propertyKey: `property-${i}`, url: `https://example.test/photo-${i}` })) });
    mocks.decode.mockResolvedValue({});
    mocks.save.mockResolvedValue({ error: null });
    mocks.propose.mockResolvedValue({ models: { segmenter: 'sam2.1-hiera-tiny', embedder: 'dinov2-small' }, regions: [], warnings: [] });
  });
  it('processes at most ten originals without creating or waiting for background jobs', async () => {
    const results = await prepareSharedPhotos(vi.fn());
    expect(mocks.decode).toHaveBeenCalledTimes(10);
    expect(mocks.propose).toHaveBeenCalledTimes(10);
    expect(results).toHaveLength(10);
    expect(mocks.save.mock.calls.every((call) => call[1] === '/photos/save')).toBe(true);
    expect(results[0].status).toBe('no_useful_regions');
  });
  it('does not download an original after current access or consent is withdrawn', async () => {
    mocks.inventory.mockResolvedValueOnce({ photos: [{ id: 'photo', tenantId: 'company', propertyKey: 'property', url: 'https://example.test/photo' }] }).mockResolvedValue({ photos: [] });
    const results = await prepareSharedPhotos(vi.fn());
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(results[0].status).toBe('access_unavailable');
  });
  it('records execution failure instead of successful recognition when models fail', async () => {
    mocks.propose.mockRejectedValue(new Error('Model execution failed'));
    const results = await prepareSharedPhotos(vi.fn());
    expect(results.every((r) => r.status === 'failed' && r.regions === 0)).toBe(true);
    expect(mocks.save.mock.calls.filter((c) => c[2]?.status === 'failed')).toHaveLength(10);
  });
});