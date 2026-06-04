// Maps deterministic parser outputs (roof or wall) into canonical
// blueprint_measurement_objects rows ready for insert. Each row references a
// PlanPath row that is created in the same transaction; the PlanPath template
// is returned alongside so the caller can persist them together.
//
// Pure function. No DB IO.

import type { TradeId } from "./trade-catalog.ts";
import type {
  BlueprintMeasurementObject,
  MeasurementGroup,
  MeasurementUnit,
} from "./measurement-objects.ts";
import type { BlueprintPlanPath } from "./plan-path.ts";

export interface MappedMeasurement {
  measurement: Omit<BlueprintMeasurementObject, "plan_path_id" | "import_session_id" | "source_document_id"> & {
    // we attach a stable local key so the caller can wire plan_path_id after PlanPath insert
    _plan_path_key: string;
  };
  plan_path: Omit<BlueprintPlanPath, "import_session_id" | "source_document_id"> & {
    _plan_path_key: string;
  };
}

interface MapContext {
  document_type: "roof_report" | "wall_report";
  provider: string;
  file_name: string | null;
}

// --------------------------- roof mapping ---------------------------

interface RoofExtractionLike {
  total_roof_area_sqft: number | null;
  pitched_roof_area_sqft?: number | null;
  flat_roof_area_sqft?: number | null;
  roof_facets?: number | null;
  total_roof_facets?: number | null;
  predominant_pitch: string | null;
  eaves_ft: number | null;
  rakes_ft: number | null;
  valleys_ft: number | null;
  hips_ft: number | null;
  ridges_ft: number | null;
  hips_ridges_combined_ft?: number | null;
  flashing_ft?: number | null;
  wall_flashing_ft?: number | null;
  step_flashing_ft: number | null;
  parapets_ft?: number | null;
  parapet_wall_ft?: number | null;
  penetrations_count?: number | null;
  waste_table?: Record<string, number> | null;
  areas_per_pitch?: Record<string, number> | null;
}

function pp(
  key: string,
  ctx: MapContext,
  section_label: string,
  confidence: number,
): MappedMeasurement["plan_path"] {
  return {
    _plan_path_key: key,
    path_type: "report_page",
    file_name: ctx.file_name,
    document_type: ctx.document_type,
    provider: ctx.provider,
    section_label,
    confidence,
  };
}

function mo(
  measurement_key: string,
  group: MeasurementGroup,
  unit: MeasurementUnit,
  quantity: number | null,
  ctx: MapContext,
  trade_id: TradeId | null,
  section_label: string,
  raw: string | null,
  normalized: Record<string, unknown> | null,
  confidence: number,
): MappedMeasurement | null {
  if (quantity === null && !normalized) return null;
  const planKey = `${measurement_key}@${section_label}`;
  return {
    measurement: {
      _plan_path_key: planKey,
      trade_id,
      measurement_key,
      measurement_group: group,
      quantity,
      unit,
      confidence,
      source_value_raw: raw,
      normalized_value: normalized,
      metadata: {},
    },
    plan_path: pp(planKey, ctx, section_label, confidence),
  };
}

export function mapRoofExtractionToMeasurements(
  ext: RoofExtractionLike,
  ctx: MapContext,
): MappedMeasurement[] {
  const T: TradeId = "roofing";
  const SUMMARY = "Report Summary → Measurements";
  const LENGTHS = "Report Summary → Lengths";
  const FLASHING = "Report Summary → Flashing";
  const WASTE = "Report Summary → Waste Calculation Table";
  const PITCH = "Report Summary → Areas per Pitch";

  const out: (MappedMeasurement | null)[] = [];
  out.push(mo("total_roof_area_sqft", "roof_area", "sqft", ext.total_roof_area_sqft, ctx, T, SUMMARY, fmt(ext.total_roof_area_sqft), null, 0.95));
  out.push(mo("pitched_roof_area_sqft", "roof_area", "sqft", ext.pitched_roof_area_sqft ?? null, ctx, T, SUMMARY, fmt(ext.pitched_roof_area_sqft ?? null), null, 0.85));
  out.push(mo("flat_roof_area_sqft", "roof_area", "sqft", ext.flat_roof_area_sqft ?? null, ctx, T, SUMMARY, fmt(ext.flat_roof_area_sqft ?? null), null, 0.85));
  const facets = ext.roof_facets ?? ext.total_roof_facets ?? null;
  out.push(mo("roof_facets_count", "roof_area", "count", facets, ctx, T, SUMMARY, fmt(facets), null, 0.95));
  if (ext.predominant_pitch) {
    out.push(mo("predominant_pitch", "roof_pitch", "pitch_ratio", null, ctx, T, SUMMARY, ext.predominant_pitch, { pitch: ext.predominant_pitch }, 0.95));
  }
  out.push(mo("eaves_lf", "roof_edges", "lf", ext.eaves_ft, ctx, T, LENGTHS, fmt(ext.eaves_ft), null, 0.85));
  out.push(mo("rakes_lf", "roof_edges", "lf", ext.rakes_ft, ctx, T, LENGTHS, fmt(ext.rakes_ft), null, 0.85));
  out.push(mo("valleys_lf", "roof_edges", "lf", ext.valleys_ft, ctx, T, LENGTHS, fmt(ext.valleys_ft), null, 0.85));
  out.push(mo("hips_lf", "roof_edges", "lf", ext.hips_ft, ctx, T, LENGTHS, fmt(ext.hips_ft), null, 0.85));
  out.push(mo("ridges_lf", "roof_edges", "lf", ext.ridges_ft, ctx, T, LENGTHS, fmt(ext.ridges_ft), null, 0.85));
  if (ext.hips_ridges_combined_ft != null) {
    out.push(mo("hips_plus_ridges_lf", "roof_edges", "lf", ext.hips_ridges_combined_ft, ctx, T, LENGTHS, fmt(ext.hips_ridges_combined_ft), null, 0.8));
  }
  const flashing = ext.flashing_ft ?? ext.wall_flashing_ft ?? null;
  out.push(mo("flashing_lf", "roof_flashing", "lf", flashing, ctx, T, FLASHING, fmt(flashing), null, 0.75));
  out.push(mo("step_flashing_lf", "roof_flashing", "lf", ext.step_flashing_ft, ctx, T, FLASHING, fmt(ext.step_flashing_ft), null, 0.75));
  const parapet = ext.parapets_ft ?? ext.parapet_wall_ft ?? null;
  out.push(mo("parapet_lf", "roof_flashing", "lf", parapet, ctx, T, FLASHING, fmt(parapet), null, 0.7));
  out.push(mo("penetrations_count", "roof_penetrations", "count", ext.penetrations_count ?? null, ctx, T, SUMMARY, fmt(ext.penetrations_count ?? null), null, 0.6));
  if (ext.waste_table) {
    out.push(mo("waste_table", "roof_waste", "percent", null, ctx, T, WASTE, JSON.stringify(ext.waste_table), { table: ext.waste_table }, 0.85));
  }
  if (ext.areas_per_pitch) {
    out.push(mo("pitch_area_by_pitch", "roof_pitch", "sqft", null, ctx, T, PITCH, JSON.stringify(ext.areas_per_pitch), { table: ext.areas_per_pitch }, 0.85));
  }
  // Derived eaves_plus_rakes_lf when both present.
  if (ext.eaves_ft != null && ext.rakes_ft != null) {
    const derived = ext.eaves_ft + ext.rakes_ft;
    out.push(mo("eaves_plus_rakes_lf", "roof_edges", "lf", derived, ctx, T, "DERIVED: eaves + rakes", `${derived}`, { derived: true, inputs: ["eaves_lf", "rakes_lf"] }, 0.8));
  }

  return out.filter((m): m is MappedMeasurement => m !== null);
}

// --------------------------- wall mapping ---------------------------

interface WallExtractionLike {
  wall_area_sqft: number | null;
  wall_area_with_windows_doors_sqft: number | null;
  wall_facets_count: number | null;
  top_of_walls_lf: number | null;
  bottom_of_walls_lf: number | null;
  inside_corners_lf: number | null;
  outside_corners_lf: number | null;
  inside_corners_gt_90_lf: number | null;
  outside_corners_gt_90_lf: number | null;
  fascia_eaves_rake_lf: number | null;
  window_door_area_sqft: number | null;
  window_door_count: number | null;
  window_door_perimeter_lf: number | null;
  wall_area_by_direction: Record<string, number> | null;
  wall_area_by_elevation: Record<string, number> | null;
  window_door_area_by_elevation: Record<string, number> | null;
  window_door_perimeter_by_elevation: Record<string, number> | null;
  window_door_count_by_elevation: Record<string, number> | null;
  wall_waste_table: Record<string, number> | null;
}

export function mapWallExtractionToMeasurements(
  ext: WallExtractionLike,
  ctx: MapContext,
): MappedMeasurement[] {
  const WALL: TradeId = "exterior_walls_siding";
  const WD: TradeId = "windows_doors";
  const GUT: TradeId = "gutters_fascia_trim";
  const SUMMARY = "Wall Report Summary → Total Lengths & Areas";
  const ELEV = "Wall Report → Elevation Details";
  const WASTE = "Wall Report → Waste Calculation Table";

  const out: (MappedMeasurement | null)[] = [];
  out.push(mo("wall_area_sqft", "wall_area", "sqft", ext.wall_area_sqft, ctx, WALL, SUMMARY, fmt(ext.wall_area_sqft), null, 0.95));
  out.push(mo("wall_area_with_windows_doors_sqft", "wall_area", "sqft", ext.wall_area_with_windows_doors_sqft, ctx, WALL, SUMMARY, fmt(ext.wall_area_with_windows_doors_sqft), null, 0.85));
  out.push(mo("wall_facets_count", "wall_area", "count", ext.wall_facets_count, ctx, WALL, SUMMARY, fmt(ext.wall_facets_count), null, 0.95));
  out.push(mo("top_of_walls_lf", "wall_edges", "lf", ext.top_of_walls_lf, ctx, WALL, SUMMARY, fmt(ext.top_of_walls_lf), null, 0.85));
  out.push(mo("bottom_of_walls_lf", "wall_edges", "lf", ext.bottom_of_walls_lf, ctx, WALL, SUMMARY, fmt(ext.bottom_of_walls_lf), null, 0.85));
  out.push(mo("inside_corners_lf", "wall_corners", "lf", ext.inside_corners_lf, ctx, WALL, SUMMARY, fmt(ext.inside_corners_lf), null, 0.85));
  out.push(mo("outside_corners_lf", "wall_corners", "lf", ext.outside_corners_lf, ctx, WALL, SUMMARY, fmt(ext.outside_corners_lf), null, 0.85));
  out.push(mo("inside_corners_gt_90_lf", "wall_corners", "lf", ext.inside_corners_gt_90_lf, ctx, WALL, SUMMARY, fmt(ext.inside_corners_gt_90_lf), null, 0.75));
  out.push(mo("outside_corners_gt_90_lf", "wall_corners", "lf", ext.outside_corners_gt_90_lf, ctx, WALL, SUMMARY, fmt(ext.outside_corners_gt_90_lf), null, 0.75));
  out.push(mo("fascia_eaves_rake_lf", "trim", "lf", ext.fascia_eaves_rake_lf, ctx, GUT, SUMMARY, fmt(ext.fascia_eaves_rake_lf), null, 0.85));
  out.push(mo("window_door_area_sqft", "wall_openings", "sqft", ext.window_door_area_sqft, ctx, WD, SUMMARY, fmt(ext.window_door_area_sqft), null, 0.85));
  out.push(mo("window_door_count", "wall_openings", "count", ext.window_door_count, ctx, WD, SUMMARY, fmt(ext.window_door_count), null, 0.85));
  out.push(mo("window_door_perimeter_lf", "wall_openings", "lf", ext.window_door_perimeter_lf, ctx, WD, SUMMARY, fmt(ext.window_door_perimeter_lf), null, 0.85));
  if (ext.wall_area_by_direction) {
    out.push(mo("wall_area_by_direction", "wall_area", "sqft", null, ctx, WALL, SUMMARY, JSON.stringify(ext.wall_area_by_direction), { table: ext.wall_area_by_direction }, 0.8));
  }
  if (ext.wall_area_by_elevation) {
    out.push(mo("wall_area_by_elevation", "wall_area", "sqft", null, ctx, WALL, ELEV, JSON.stringify(ext.wall_area_by_elevation), { table: ext.wall_area_by_elevation }, 0.8));
  }
  if (ext.window_door_area_by_elevation) {
    out.push(mo("window_door_area_by_elevation", "wall_openings", "sqft", null, ctx, WD, ELEV, JSON.stringify(ext.window_door_area_by_elevation), { table: ext.window_door_area_by_elevation }, 0.8));
  }
  if (ext.window_door_perimeter_by_elevation) {
    out.push(mo("window_door_perimeter_by_elevation", "wall_openings", "lf", null, ctx, WD, ELEV, JSON.stringify(ext.window_door_perimeter_by_elevation), { table: ext.window_door_perimeter_by_elevation }, 0.8));
  }
  if (ext.window_door_count_by_elevation) {
    out.push(mo("window_door_count_by_elevation", "wall_openings", "count", null, ctx, WD, ELEV, JSON.stringify(ext.window_door_count_by_elevation), { table: ext.window_door_count_by_elevation }, 0.8));
  }
  if (ext.wall_waste_table) {
    out.push(mo("wall_waste_table", "wall_waste", "percent", null, ctx, WALL, WASTE, JSON.stringify(ext.wall_waste_table), { table: ext.wall_waste_table }, 0.85));
  }

  return out.filter((m): m is MappedMeasurement => m !== null);
}

function fmt(n: number | null | undefined): string | null {
  return n == null ? null : String(n);
}
