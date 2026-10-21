import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../supabase/functions/_shared/router.ts', () => ({ serviceClient: () => mocks, jsonErr: (_c: unknown, code: string, error: string, status: number) => ({ code, error, status }), jsonOk: (_c: unknown, data: unknown) => ({ data }) }));
import { photoBrowserApi } from '../../supabase/functions/_shared/photo-browser-api';
const context = (actor: string | null) => ({ get: () => actor, req: { json: async () => ({}) } }) as never;
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
});