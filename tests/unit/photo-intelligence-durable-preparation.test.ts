import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { loadReferenceLibrary, promoteCorrectionToReference } from '@/lib/photo-intelligence/components/referenceLibrary';

describe('safe shared reference distribution', () => {
  it('loads the server-approved library without exposing customer provenance', async () => {
    rpc.mockResolvedValueOnce({ data: { version: 4, embeddingModelId: 'dinov2-small', examples: [{ id: 'opaque-example', cls: 'clay_tile', embedding: Array(384).fill(0.1), libraryVersion: 4 }] }, error: null });
    const result = await loadReferenceLibrary();
    expect(rpc).toHaveBeenCalledWith('photo_shared_reference_inference');
    expect(result.examples).toHaveLength(1);
    expect(result.version).toBe(4);
    expect(result.examples[0].sourcePhotoId).toBe('shared:opaque-example');
    expect(result.examples[0].approvedBy).toBe('server-verified-independent-review');
  });
  it('rejects mismatched model embeddings rather than mixing spaces', async () => {
    rpc.mockResolvedValueOnce({ data: { version: 1, embeddingModelId: 'other', examples: [{ embedding: Array(384).fill(1) }] }, error: null });
    expect((await loadReferenceLibrary()).examples).toHaveLength(0);
  });
  it('refuses browser-supplied approval even when two identifiers differ', async () => {
    const result = await promoteCorrectionToReference({ cls: 'clay_tile', embedding: new Float32Array(384), sourcePhotoId: 'p', sourceRegionId: 'r', labeledBy: 'a', approvedBy: 'b' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('independent review');
  });
});