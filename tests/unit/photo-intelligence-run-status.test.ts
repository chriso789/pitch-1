import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { classifyRun, isValidPolygon } from '@/lib/photo-intelligence/components/photoProcessing';
import { approvedToExamples } from '@/lib/photo-intelligence/components/referenceCandidates';

const sq = [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.4 }, { x: 0.1, y: 0.4 }];

describe('per-photo run status', () => {
  it('failed when the segmenter did not load', () => expect(classifyRun({ assessable: true, error: null, segmenterLoaded: false, validRegions: 3 })).toBe('failed'));
  it('failed on error', () => expect(classifyRun({ assessable: true, error: 'x', segmenterLoaded: true, validRegions: 3 })).toBe('failed'));
  it('unassessable when quality check failed', () => expect(classifyRun({ assessable: false, error: null, segmenterLoaded: true, validRegions: 2 })).toBe('unassessable'));
  it('no useful regions with zero valid outlines', () => expect(classifyRun({ assessable: true, error: null, segmenterLoaded: true, validRegions: 0 })).toBe('no_useful_regions'));
  it('completed with valid outlines', () => expect(classifyRun({ assessable: true, error: null, segmenterLoaded: true, validRegions: 1 })).toBe('completed'));
});

describe('polygon validity', () => {
  it('accepts an in-image square', () => expect(isValidPolygon(sq)).toBe(true));
  it('rejects fewer than 3 points', () => expect(isValidPolygon(sq.slice(0, 2))).toBe(false));
  it('rejects out-of-image coordinates', () => expect(isValidPolygon([...sq.slice(0, 3), { x: 1.5, y: 0.2 }])).toBe(false));
  it('rejects NaN', () => expect(isValidPolygon([{ x: NaN, y: 0 }, ...sq.slice(1)])).toBe(false));
  it('rejects a near-zero area sliver', () => expect(isValidPolygon([{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.1005 }])).toBe(false));
});

describe('approved library excludes non-approved reviews', () => {
  const base = { source_photo_id: 'p', source_property_key: 'lead:1', cls: 'clay_tile', labeled_by: 'a', created_at: '', embedding: [1, 0] };
  it('keeps only approved rows', () => {
    const ex = approvedToExamples([
      { ...base, id: '1', approved_by: 'b', review_status: 'approved' },
      { ...base, id: '2', approved_by: 'b', review_status: 'rejected' },
      { ...base, id: '3', approved_by: 'b', review_status: 'needs_correction' },
      { ...base, id: '4', approved_by: null, review_status: 'pending' },
    ]);
    expect(ex.map((e) => e.id)).toEqual(['1']);
  });
});
