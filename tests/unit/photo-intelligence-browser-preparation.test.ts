import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSharedPhotos } from '@/lib/photo-intelligence/training/sharedPreparation';
const mocks = vi.hoisted(() => ({ read: vi.fn(), decode: vi.fn(), api: vi.fn(), propose: vi.fn() }));
vi.mock('@/lib/photo-intelligence/training/browserResults', () => ({ loadBrowserTest: mocks.read }));
vi.mock('@/lib/edgeApi', () => ({ edgeApi: mocks.api }));
vi.mock('@/lib/photo-intelligence/patternAnalysis', () => ({ loadImageForAnalysis: mocks.decode, assessQuality: () => ({ assessable: true, sharpness: 100, brightness: 100, issues: [] }) }));
vi.mock('@/lib/photo-intelligence/components/regionProposals', () => ({ proposeRegions: mocks.propose }));
vi.mock('@/lib/photo-intelligence/components/photoTriage', () => ({ differenceHash: () => null, markDuplicates: (p: unknown[]) => p }));

describe('foreground browser acceptance preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const selection = Array.from({ length: 100 }, (_, i) => ({ id: String(i), tenantId: 'company', propertyKey: `property-${i}`, photo: i + 1 }));
    mocks.read.mockResolvedValue({ photos: selection.map(p => ({ ...p, url: `https://example.test/photo-${p.id}` })) });
    mocks.decode.mockResolvedValue({ width: 256, height: 128 });
    mocks.api.mockImplementation(async (_fn, route, body) => route.endsWith('/start') ? { data: { testId: 'test', selection }, error: null } : { data: { result: { ...body.result, saveStatus: 'verified' } }, error: null });
    mocks.propose.mockResolvedValue({ imageSize: { width: 512, height: 256 }, models: { segmenter: 'sam2.1-hiera-tiny', embedder: 'dinov2-small' }, regions: [], warnings: [] });
  });
  it('processes at most ten originals without background jobs', async () => {
    const results = await prepareSharedPhotos(vi.fn());
    expect(mocks.decode).toHaveBeenCalledTimes(10);
    expect(mocks.propose).toHaveBeenCalledTimes(10);
    expect(results).toHaveLength(10);
    expect(mocks.api.mock.calls.every(c => c[1].startsWith('/photos/browser/'))).toBe(true);
  });
  it('never downloads after access or consent is withdrawn', async () => {
    mocks.read.mockResolvedValue({ photos: [] });
    const results = await prepareSharedPhotos(vi.fn());
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(results[0].status).toBe('access_unavailable');
  });
  it('persists execution failure rather than recognition success', async () => {
    mocks.propose.mockRejectedValue(new Error('Model execution failed'));
    const results = await prepareSharedPhotos(vi.fn());
    expect(results.every(r => r.status === 'failed' && r.outlines.length === 0)).toBe(true);
    expect(mocks.api.mock.calls.filter(c => c[2]?.result?.status === 'failed')).toHaveLength(10);
  });
  it('saves measured resolution and excludes invalid polygons', async () => {
    mocks.propose.mockResolvedValue({ imageSize: { width: 512, height: 256 }, models: { segmenter: 'sam2.1-hiera-tiny', embedder: 'dinov2-small' }, regions: [
      { group: 0, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      { group: 1, polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }] },
    ], warnings: [] });
    const results = await prepareSharedPhotos(vi.fn());
    expect(results[0]).toMatchObject({ width: 512, height: 256, invalidRegions: 1, saveStatus: 'verified' });
    expect(results[0].outlines).toHaveLength(1);
  });
  it('retains every partial result if one save fails', async () => {
    const original = mocks.api.getMockImplementation();
    mocks.api.mockImplementation(async (...args) => args[2]?.photoId === '0' ? { error: 'Save failed' } : original?.(...args));
    const results = await prepareSharedPhotos(vi.fn());
    expect(results).toHaveLength(10);
    expect(results[0].saveStatus).toBe('failed');
    expect(results[1].saveStatus).toBe('verified');
  });
});
