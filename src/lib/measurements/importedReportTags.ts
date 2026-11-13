// Turns the numbers read from an uploaded measurement report (Roofr, EagleView,
// Xactimate, ...) into the saved measurement fields estimates use.
// Every total the report provides is kept; nothing is estimated or invented.

import type { Json } from '@/integrations/supabase/types';

export interface ImportedReportParsed {
  provider?: string | null;
  address?: string | null;
  total_area_sqft?: number | null;
  pitched_area_sqft?: number | null;
  flat_area_sqft?: number | null;
  facet_count?: number | null;
  predominant_pitch?: string | null;
  ridges_ft?: number | null;
  hips_ft?: number | null;
  valleys_ft?: number | null;
  rakes_ft?: number | null;
  eaves_ft?: number | null;
  drip_edge_ft?: number | null;
  perimeter_ft?: number | null;
  step_flashing_ft?: number | null;
  wall_flashing_ft?: number | null;
  transitions_ft?: number | null;
  parapet_walls_ft?: number | null;
  unspecified_ft?: number | null;
  squares?: number | null;
  pitches?: Array<{ pitch: string; area_sqft: number }> | null;
  waste_table?: Array<{ waste_pct: number; area_sqft: number | null; squares: number | null }> | null;
}

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export function importedPerimeterFt(parsed: ImportedReportParsed): number {
  const explicit = num(parsed.perimeter_ft);
  if (explicit > 0) return round2(explicit);
  return round2(num(parsed.eaves_ft) + num(parsed.rakes_ft));
}

export function buildImportedReportTags(
  parsed: ImportedReportParsed,
  opts: { provider?: string | null; importedAt?: string; originalReportId?: string | null } = {},
): { [key: string]: Json } {
  const area = num(parsed.total_area_sqft);
  const squares = area / 100;
  const ridge = num(parsed.ridges_ft);
  const hip = num(parsed.hips_ft);
  const valley = num(parsed.valleys_ft);
  const eave = num(parsed.eaves_ft);
  const rake = num(parsed.rakes_ft);
  const step = num(parsed.step_flashing_ft);
  const wall = num(parsed.wall_flashing_ft);
  const perimeter = importedPerimeterFt(parsed);
  const provider = opts.provider || parsed.provider || 'unknown';

  const tags: { [key: string]: Json } = {
    'roof.plan_area': area,
    'roof.total_sqft': area,
    'roof.squares': squares,
    'roof.pitched_area': num(parsed.pitched_area_sqft ?? parsed.total_area_sqft),
    'roof.flat_area': num(parsed.flat_area_sqft),
    'flat_section_sqft': num(parsed.flat_area_sqft),
    'roof.predominant_pitch': parsed.predominant_pitch || '6/12',
    'roof.faces_count': num(parsed.facet_count),
    'lf.ridge': ridge,
    'lf.hip': hip,
    'lf.valley': valley,
    'lf.rake': rake,
    'lf.eave': eave,
    'lf.step': step,
    'lf.step_flashing': step,
    'lf.wall': wall,
    'lf.wall_flashing': wall,
    'lf.transition': num(parsed.transitions_ft),
    'lf.parapet': num(parsed.parapet_walls_ft),
    'lf.unspecified': num(parsed.unspecified_ft),
    'lf.perimeter': perimeter,
    'lf.eave_rake_total': round2(eave + rake),
    'lf.ridge_hip_total': round2(ridge + hip),
    'lf.valley_step_total': round2(valley + step),
    'source': `imported_${provider}`,
    'imported_at': opts.importedAt || new Date().toISOString(),
  };

  const dripEdge = num(parsed.drip_edge_ft);
  if (dripEdge > 0) tags['lf.drip_edge'] = dripEdge;
  if (opts.originalReportId) tags['original_report_id'] = opts.originalReportId;
  if (parsed.pitches?.length) tags['roof.area_by_pitch'] = parsed.pitches as Json;

  for (const row of parsed.waste_table ?? []) {
    if (!row || row.area_sqft == null) continue;
    const key = `waste.${row.waste_pct}pct`;
    tags[`${key}.sqft`] = num(row.area_sqft);
    tags[`${key}.squares`] = row.squares != null ? num(row.squares) : num(row.area_sqft) / 100;
  }

  return tags;
}

/** Same totals in the older lead-details format some screens still read. */
export function buildImportedComprehensiveMeasurements(parsed: ImportedReportParsed, provider?: string | null) {
  const area = num(parsed.total_area_sqft);
  return {
    roof_area_sq_ft: parsed.total_area_sqft,
    total_area_sqft: parsed.total_area_sqft,
    pitched_area_sqft: parsed.pitched_area_sqft,
    flat_area_sqft: parsed.flat_area_sqft,
    predominant_pitch: parsed.predominant_pitch,
    facet_count: parsed.facet_count,
    ridges_lf: parsed.ridges_ft,
    hips_lf: parsed.hips_ft,
    valleys_lf: parsed.valleys_ft,
    rakes_lf: parsed.rakes_ft,
    eaves_lf: parsed.eaves_ft,
    drip_edge_lf: parsed.drip_edge_ft,
    perimeter_lf: importedPerimeterFt(parsed),
    step_flashing_lf: parsed.step_flashing_ft,
    wall_flashing_lf: parsed.wall_flashing_ft,
    transitions_lf: parsed.transitions_ft,
    parapet_walls_lf: parsed.parapet_walls_ft,
    unspecified_lf: parsed.unspecified_ft,
    waste_table: parsed.waste_table,
    source: `imported_${provider || parsed.provider || 'unknown'}`,
    imported_at: new Date().toISOString(),
    roof_squares: area / 100,
    total_squares: area / 100,
  };
}
