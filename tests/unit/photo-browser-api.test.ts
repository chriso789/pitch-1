import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../supabase/functions/_shared/router.ts', () => ({ serviceClient: () => mocks, jsonErr: (_c: unknown, code: string, error: string, status: number) => ({ code, error, status }), jsonOk: (_c: unknown, data: unknown) => ({ data }) }));
import { photoBrowserApi } from '../../supabase/functions/_shared/photo-browser-api';
const context = (actor: string | null) => ({ get: () => actor, req: { json: async () => ({}) } }) as never;
const testId = '00000000-0000-4000-8000-000000000001';
const photoId = '00000000-0000-4000-8000-000000000002';
const measured = { status: 'completed', width: 384, height: 512, invalidRegions: 0, durationMs: 46500, outlines: [{ group: 0, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }], segmenter: 'sam2.1-hiera-tiny', embedder: 'dinov2-small', error: null };
function saveContext(embedder: string) {
  return { get: () => 'actor', req: { json: async () => ({ testId, photoId, result: { ...measured, embedder } }) } } as never;
}
function mockSavedTest() {
  const stored = { ...measured, photoId, photo: 1, saveStatus: 'verified' };
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), single: vi.fn() };
  for (const name of ['select', 'eq', 'order', 'limit'] as const) chain[name].mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue({ data: { id: testId } });
  chain.single.mockResolvedValue({ data: { results: { [photoId]: stored } } });
  mocks.from.mockReturnValue(chain);
  mocks.rpc.mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: stored });
  return stored;
}
describe('private browser test authorization and selection', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects a signed-out caller before reading inventory', async () => {
    expect(await photoBrowserApi(context(null), 'start')).toMatchObject({ status: 401 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects company users and reviewers without developer access', async () => {
    mocks.rpc.mockResolvedValue({ data: false });
    expect(await photoBrowserApi(context('actor'), 'start')).toMatchObject({ status: 403 });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('freezes only ten server-authorized photos and ignores caller ownership', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: { photos: Array.from({ length: 100 }, (_, i) => ({ id: String(i), tenantId: 'authorized', propertyKey: String(i) })) } });
    const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'test' } }) }) }));
    mocks.from.mockReturnValue({ insert });
    await photoBrowserApi(context('actor'), 'start');
    expect(insert.mock.calls[0][0].selection).toHaveLength(10);
    expect(insert.mock.calls[0][0].created_by).toBe('actor');
    expect(insert.mock.calls[0][0].selection[0].tenantId).toBe('authorized');
  });
  it('saves completed SAM outlines with the executed canonical DINOv2 identity and reads them back', async () => {
    const stored = mockSavedTest();
    expect(await photoBrowserApi(saveContext('dinov2-small'), 'save')).toEqual({ data: { result: stored } });
    expect(mocks.rpc).toHaveBeenCalledWith('photo_browser_result_save', { _actor: 'actor', _test: testId, _photo: photoId, _result: measured });
  });
  it('keeps the model gate closed for a hosted URL instead of the canonical identity', async () => {
    mockSavedTest();
    expect(await photoBrowserApi(saveContext('/__l5e/assets-v1/asset/dinov2-small.onnx'), 'save')).toMatchObject({ code: 'models_required', status: 400 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});