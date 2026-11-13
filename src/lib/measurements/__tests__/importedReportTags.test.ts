import { describe, expect, it } from 'vitest';
import { buildImportedReportTags } from '../importedReportTags';

// Totals from the Roofr report uploaded for the 16-facet, 4,000 sqft roof.
const roofr = {
  provider: 'roofr',
  total_area_sqft: 4000,
  pitched_area_sqft: 4000,
  flat_area_sqft: 0,
  facet_count: 16,
  predominant_pitch: '6/12',
  eaves_ft: 236.33,
  valleys_ft: 92.83,
  hips_ft: 154.58,
  ridges_ft: 73.83,
  rakes_ft: 92.25,
  wall_flashing_ft: 11.58,
  step_flashing_ft: 44.75,
  transitions_ft: 0,
  parapet_walls_ft: 0,
  unspecified_ft: 69.67,
  waste_table: [{ waste_pct: 13, area_sqft: 4520, squares: 45.2 }],
};

describe('buildImportedReportTags', () => {
  it('keeps step flashing from the report', () => {
    expect(buildImportedReportTags(roofr)['lf.step']).toBe(44.75);
  });

  it('keeps wall flashing from the report', () => {
    expect(buildImportedReportTags(roofr)['lf.wall']).toBe(11.58);
  });

  it('keeps unspecified edges from the report', () => {
    expect(buildImportedReportTags(roofr)['lf.unspecified']).toBe(69.67);
  });

  it('uses eaves + rakes as the perimeter when the report has no perimeter line', () => {
    expect(buildImportedReportTags(roofr)['lf.perimeter']).toBe(328.58);
  });

  it("uses the report's own perimeter when it has one", () => {
    expect(buildImportedReportTags({ ...roofr, perimeter_ft: 328.58 })['lf.perimeter']).toBe(328.58);
  });

  it('keeps the facet count', () => {
    expect(buildImportedReportTags(roofr)['roof.faces_count']).toBe(16);
  });

  it("keeps the report's waste rows", () => {
    const tags = buildImportedReportTags(roofr);
    expect(tags['waste.13pct.sqft']).toBe(4520);
    expect(tags['waste.13pct.squares']).toBe(45.2);
  });

  it('does not invent drip edge when the report has none', () => {
    expect(buildImportedReportTags(roofr)['lf.drip_edge']).toBeUndefined();
  });
});
