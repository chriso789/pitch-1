import { describe, expect, it } from 'vitest';
import { promoteCorrectionToReference } from '@/lib/photo-intelligence/components/referenceLibrary';

describe('reference library learning loop', () => {
  it('refuses self-approved corrections before any database write', async () => {
    const r = await promoteCorrectionToReference({
      cls: 'clay_tile',
      embedding: new Float32Array([1, 0, 0]),
      sourcePhotoId: 'p1',
      sourceRegionId: 'r1',
      labeledBy: 'inspector-a',
      approvedBy: 'inspector-a',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/independent approver/);
  });

  it('refuses corrections without an embedding', async () => {
    const r = await promoteCorrectionToReference({
      cls: 'shadow',
      embedding: new Float32Array(0),
      sourcePhotoId: 'p1',
      sourceRegionId: 'r1',
      labeledBy: 'a',
      approvedBy: 'b',
    });
    expect(r.ok).toBe(false);
  });
});
