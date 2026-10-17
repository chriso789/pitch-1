import { describe, it, expect } from 'vitest';
import { composeReport, findUntraceableEntries, isNoDamageFinding } from '@/lib/photo-intelligence/reportModel';
import type { PhotoFinding } from '@/lib/photo-intelligence/findings';

const base: PhotoFinding = {
  id: 'f1',
  tenant_id: 't1',
  project_id: null,
  job_id: null,
  finding_ref: 'F-001',
  building_label: 'Building A',
  roof_plane: 'North slope',
  component: 'Shingles',
  material: 'Asphalt',
  visible_condition: 'Impact damage',
  condition_description: null,
  detection_source: 'manual',
  ai_confidence: null,
  severity: 'high',
  urgency: 'soon',
  water_exposure_concern: true,
  recommended_verification: null,
  limitations: 'Steep slope viewed from ladder only',
  measured_quantity: null,
  measured_unit: null,
  measurement_source: null,
  review_status: 'approved',
  approved_by: 'u1',
  approved_at: '2026-10-01T00:00:00Z',
  created_at: '2026-10-01T00:00:00Z',
};

const args = {
  branding: { companyName: "O'Brien Contracting" },
  property: { address: '7552 Navarre Pkwy', inspectedAt: '2026-10-01T00:00:00Z', inspectorName: 'C. Riegler' },
  evidenceByFinding: new Map([['f1', [{ id: 'e1', finding_id: 'f1', photo_id: 'p1', storage_path: 't1/photos/1.jpg', evidence_role: 'primary' as const, annotation: null, annotation_source: 'manual' as const }]]]),
};

describe('report composition', () => {
  it('blocks the report when any finding is not approved', () => {
    expect(() => composeReport({ ...args, findings: [{ ...base, review_status: 'pending' }] })).toThrow(/not inspector-approved/);
    expect(() => composeReport({ ...args, findings: [{ ...base, review_status: 'rejected' }] })).toThrow(/not inspector-approved/);
  });

  it('composes an approved report sorted by severity', () => {
    const low = { ...base, id: 'f2', finding_ref: 'F-002', severity: 'low' as const, building_label: 'Building A', water_exposure_concern: false };
    const report = composeReport({ ...args, findings: [low, base] });
    expect(report.buildings).toHaveLength(1);
    expect(report.buildings[0].findings.map((f) => f.severity)).toEqual(['high', 'low']);
    expect(report.priorityCounts.high).toBe(1);
    expect(report.priorityCounts.low).toBe(1);
    expect(report.waterEntryConcerns).toHaveLength(1);
    expect(report.limitations).toContain('Steep slope viewed from ladder only');
  });

  it('records no-damage areas separately from damage findings', () => {
    const clean = { ...base, id: 'f3', finding_ref: 'F-003', visible_condition: 'No visible damage', building_label: 'Building B', water_exposure_concern: false };
    expect(isNoDamageFinding(clean)).toBe(true);
    const report = composeReport({ ...args, findings: [base, clean] });
    expect(report.noDamageAreas).toHaveLength(1);
    expect(report.noDamageAreas[0]).toMatch(/Building B/);
    expect(report.buildings).toHaveLength(1); // Building B has no damage section
  });

  it('flags findings with no traceable original photo', () => {
    const report = composeReport({ ...args, findings: [base, { ...base, id: 'f4', finding_ref: 'F-004' }] });
    const untraceable = findUntraceableEntries(report);
    expect(untraceable.map((e) => e.findingRef)).toEqual(['F-004']);
  });

  it('links every rendered entry back to its finding id and original photo path', () => {
    const report = composeReport({ ...args, findings: [base] });
    const entry = report.buildings[0].findings[0];
    expect(entry.findingId).toBe('f1');
    expect(entry.evidencePhotoPaths).toEqual(['t1/photos/1.jpg']);
  });

  it('requires approval metadata to be carried, never assumed', () => {
    const report = composeReport({ ...args, findings: [base] });
    expect(report.approval).toBeNull();
    const approved = composeReport({ ...args, findings: [base], approval: { approvedBy: 'u1', approvedAt: '2026-10-02T00:00:00Z' } });
    expect(approved.approval?.approvedBy).toBe('u1');
  });
});
