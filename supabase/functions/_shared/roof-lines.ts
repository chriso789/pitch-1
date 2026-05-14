// Patent-aligned typed RoofLine model.
// Rule 3: Report totals come exclusively from typed roof_lines whose
// `can_be_customer_reported = true`. Untyped or `unknown` lines are
// debug-only and must not contribute to ridges_lf / hips_lf / valleys_lf /
// eaves_lf / rakes_lf.

export type RoofLineAttribute =
  | 'perimeter'
  | 'eave'
  | 'rake'
  | 'ridge'
  | 'hip'
  | 'valley'
  | 'step_flashing'
  | 'wall_flashing'
  | 'common'
  | 'unknown';

export type RoofLineSource =
  | 'dsm'
  | 'solar'
  | 'mask_contour'
  | 'user_override'
  | 'inferred'
  | 'vendor';

export interface RoofLine {
  id: string;
  measurement_id: string;
  layer_id: 'layer1_perimeter' | 'layer2_structural';
  geometry_px: Array<[number, number]>;
  geometry_geo?: Array<[number, number]> | null;
  length_lf: number;
  non_dimensional_attribute: RoofLineAttribute;
  source: RoofLineSource;
  confidence: number;
  adjacent_plane_ids: string[];
  can_be_customer_reported: boolean;
}

export interface ReportableTotals {
  ridges_lf: number;
  hips_lf: number;
  valleys_lf: number;
  eaves_lf: number;
  rakes_lf: number;
  perimeter_lf: number;
  step_flashing_lf: number;
  wall_flashing_lf: number;
  unknown_lf: number;
}

const REPORTABLE_ATTRS: RoofLineAttribute[] = [
  'perimeter', 'eave', 'rake', 'ridge', 'hip', 'valley',
  'step_flashing', 'wall_flashing',
];

export function buildRoofLine(
  partial: Omit<RoofLine, 'can_be_customer_reported'> & {
    can_be_customer_reported?: boolean;
  },
): RoofLine {
  const reportable = partial.can_be_customer_reported ??
    (REPORTABLE_ATTRS.includes(partial.non_dimensional_attribute) &&
     partial.confidence >= 0.5 &&
     partial.length_lf > 0);
  return { ...partial, can_be_customer_reported: reportable };
}

/**
 * Aggregate typed-line totals. ONLY lines with `can_be_customer_reported=true`
 * contribute. Unknown / low-confidence lines are summed into `unknown_lf` for
 * diagnostics only.
 */
export function aggregateLineTotalsByAttribute(lines: RoofLine[]): ReportableTotals {
  const totals: ReportableTotals = {
    ridges_lf: 0, hips_lf: 0, valleys_lf: 0, eaves_lf: 0, rakes_lf: 0,
    perimeter_lf: 0, step_flashing_lf: 0, wall_flashing_lf: 0, unknown_lf: 0,
  };
  for (const line of lines) {
    if (!line.can_be_customer_reported) {
      totals.unknown_lf += line.length_lf;
      continue;
    }
    switch (line.non_dimensional_attribute) {
      case 'ridge': totals.ridges_lf += line.length_lf; break;
      case 'hip': totals.hips_lf += line.length_lf; break;
      case 'valley': totals.valleys_lf += line.length_lf; break;
      case 'eave': totals.eaves_lf += line.length_lf; break;
      case 'rake': totals.rakes_lf += line.length_lf; break;
      case 'perimeter': totals.perimeter_lf += line.length_lf; break;
      case 'step_flashing': totals.step_flashing_lf += line.length_lf; break;
      case 'wall_flashing': totals.wall_flashing_lf += line.length_lf; break;
      default: totals.unknown_lf += line.length_lf;
    }
  }
  return totals;
}

/**
 * Verifies every reportable total has typed-line backing. If a total is
 * derived from non-typed sources (legacy edge list), this returns false and
 * the caller MUST gate the report with `untyped_edge_totals_blocked`.
 */
export function totalsHaveTypedBacking(
  reported: Partial<ReportableTotals>,
  typed: ReportableTotals,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const key of Object.keys(reported) as Array<keyof ReportableTotals>) {
    const r = reported[key] ?? 0;
    if (r > 0 && (typed[key] ?? 0) <= 0) missing.push(key);
  }
  return { ok: missing.length === 0, missing };
}
