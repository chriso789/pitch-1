import { describe, expect, it } from 'vitest';
import { currentSharedConsent, validSharedPolygon } from '../../supabase/functions/_shared/training-photo-validation';
import { recommendForLabeling } from '@/lib/photo-intelligence/components/photoTriage';

describe('authorized existing-photo preparation', () => {
  const consent = { status: 'opted_in', terms_version: 'pitch-photo-training-v1', authorized_by: 'admin', authorized_at: '2026-10-20', withdrawn_at: null };
  it('requires explicit current consent and accepted terms', () => {
    expect(currentSharedConsent(consent)).toBe(true);
    for (const changed of [{ status: 'not_enrolled' }, { status: 'withdrawn' }, { terms_version: 'other' }, { withdrawn_at: '2026-10-20' }, { authorized_by: null }]) expect(currentSharedConsent({ ...consent, ...changed })).toBe(false);
    expect(currentSharedConsent(null)).toBe(false);
  });
  it('selects at most 100 across properties, not just the largest property', () => {
    const photos = Array.from({ length: 234 }, (_, i) => ({ id: String(i), propertyKey: `property:${i % 11}`, hash: null, sharpness: i, assessable: true, issues: [], duplicateOf: null }));
    const selected = recommendForLabeling(photos, 100);
    expect(selected).toHaveLength(100);
    expect(new Set(selected.map((p) => p.propertyKey)).size).toBe(11);
  });
  it('rejects invalid outline geometry rather than treating it as recognition', () => {
    expect(validSharedPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(true);
    expect(validSharedPolygon([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }])).toBe(false);
    expect(validSharedPolygon([{ x: 0, y: 0 }, { x: .0001, y: 0 }, { x: 0, y: .0001 }])).toBe(false);
  });
});