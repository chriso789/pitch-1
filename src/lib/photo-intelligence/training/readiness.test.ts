import { describe, it, expect } from 'vitest';
import { trainingReadiness } from './readiness';
import type { Label } from './service';

const lbl = (id: string, cls: string[], o: Partial<Label> = {}) => ({ original_id: id, roof_system: 'clay_tile', status: 'approved', labeled_by: 'a', approved_by: 'b', no_visible_damage: cls.length === 0, regions: cls.map((c) => ({ cls: c })), ...o }) as unknown as Label;

describe('training readiness', () => {
  const originals = ['o1', 'o2', 'o3', 'o4', 'o5'].map((id, i) => ({ id, property_id: `p${i % 2}` }));
  it('counts only independently approved labels and separates categories', () => {
    const r = trainingReadiness(originals, [lbl('o1', ['broken_tile']), lbl('o2', []), lbl('o3', ['normal_shadow']), lbl('o4', ['uncertain_close_up_required']),
      lbl('o5', ['broken_tile'], { approved_by: 'a' })]).rows.find((x) => x.system === 'clay_tile')!;
    expect(r).toMatchObject({ photos: 4, damage: 1, normal: 2, hardNegative: 1, uncertain: 1, properties: 2 });
  });
  it('rep self-approval and pending labels never count', () => {
    const r = trainingReadiness(originals, [lbl('o1', ['broken_tile'], { status: 'pending' }), lbl('o2', ['broken_tile'], { approved_by: 'a' })]);
    expect(r.uniqueProperties).toBe(0);
  });
  it('tile target requires 30 examples per class from 3 properties', () => {
    const r = trainingReadiness(originals, [lbl('o1', ['broken_tile']), lbl('o2', [])]);
    expect(r.tileTarget.ready).toBe(false);
    expect(r.tileTarget.blockers).toContain('29 more approved damaged tile photos needed');
  });
});
