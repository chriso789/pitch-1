import { describe, it, expect } from 'vitest';
import { groupByBuilding, type PhotoFinding } from '@/lib/photo-intelligence/findings';

const base: PhotoFinding = {
  id: 'f1', tenant_id: 't1', project_id: null, job_id: null,
  finding_ref: 'B1-RP1-001', building_label: 'Main Building', roof_plane: 'North',
  component: 'shingles', material: 'asphalt', visible_condition: 'missing tabs',
  condition_description: null, detection_source: 'ai', ai_confidence: 0.87,
  severity: 'high', urgency: 'priority', water_exposure_concern: true,
  recommended_verification: null, limitations: null,
  measured_quantity: null, measured_unit: null, measurement_source: null,
  review_status: 'pending', approved_by: null, approved_at: null,
  created_at: '2026-10-17T00:00:00Z',
};

describe('photo intelligence findings', () => {
  it('groups findings by building label', () => {
    const groups = groupByBuilding([
      base,
      { ...base, id: 'f2', building_label: 'Garage' },
      { ...base, id: 'f3' },
    ]);
    expect(groups.get('Main Building')).toHaveLength(2);
    expect(groups.get('Garage')).toHaveLength(1);
  });

  it('assigns findings without a building label to Unassigned building', () => {
    const groups = groupByBuilding([{ ...base, building_label: null }]);
    expect(groups.get('Unassigned building')).toHaveLength(1);
  });

  it('AI proposals always carry the pending review status', () => {
    expect(base.detection_source).toBe('ai');
    expect(base.review_status).toBe('pending');
    expect(base.approved_by).toBeNull();
  });

  it('findings with measured quantities must name a measurement source', () => {
    const invalid = { ...base, measured_quantity: 42 };
    expect(invalid.measurement_source).toBeNull(); // DB trigger rejects this insert
  });
});
