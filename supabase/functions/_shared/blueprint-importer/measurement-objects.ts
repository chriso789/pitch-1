// Blueprint Importer v2 — Measurement object contracts (Phase 1).
// Side-effect-free type and helper module. No DB, no IO.

import type { TradeId } from "./trade-catalog.ts";

export type MeasurementUnit =
  | "sqft"
  | "lf"
  | "count"
  | "pitch_ratio"
  | "degrees"
  | "percent"
  | "ratio"
  | "unknown";

export type MeasurementGroup =
  | "roof_area"
  | "roof_edges"
  | "roof_flashing"
  | "roof_pitch"
  | "roof_penetrations"
  | "roof_waste"
  | "wall_area"
  | "wall_edges"
  | "wall_corners"
  | "wall_openings"
  | "wall_waste"
  | "trim"
  | "other";

export interface BlueprintMeasurementObject {
  id?: string;
  import_session_id: string;
  source_document_id?: string | null;
  trade_id: TradeId | null;
  measurement_key: string;
  measurement_group: MeasurementGroup;
  quantity: number | null;
  unit: MeasurementUnit;
  precision?: number | null;
  confidence: number; // 0..1
  source_value_raw?: string | null;
  normalized_value?: Record<string, unknown> | null;
  plan_path_id?: string | null;
  page_number?: number | null;
  metadata?: Record<string, unknown>;
}

// Canonical measurement keys — keep in sync with docs/blueprint-estimate-mapping-contract.md
export const ROOFING_MEASUREMENT_KEYS = [
  "total_roof_area_sqft",
  "pitched_roof_area_sqft",
  "flat_roof_area_sqft",
  "roof_facets_count",
  "predominant_pitch",
  "pitch_area_by_pitch",
  "eaves_lf",
  "rakes_lf",
  "eaves_plus_rakes_lf",
  "valleys_lf",
  "hips_lf",
  "ridges_lf",
  "hips_plus_ridges_lf",
  "flashing_lf",
  "step_flashing_lf",
  "parapet_lf",
  "penetrations_count",
  "penetrations_area_sqft",
  "penetrations_perimeter_lf",
  "waste_table",
] as const;

export const WALLS_SIDING_MEASUREMENT_KEYS = [
  "wall_area_sqft",
  "wall_area_with_windows_doors_sqft",
  "wall_facets_count",
  "wall_area_by_direction",
  "top_of_walls_lf",
  "bottom_of_walls_lf",
  "inside_corners_lf",
  "outside_corners_lf",
  "inside_corners_gt_90_lf",
  "outside_corners_gt_90_lf",
  "fascia_eaves_rake_lf",
  "window_door_area_sqft",
  "window_door_count",
  "window_door_perimeter_lf",
  "wall_waste_table",
] as const;

export type RoofingMeasurementKey = typeof ROOFING_MEASUREMENT_KEYS[number];
export type WallsSidingMeasurementKey = typeof WALLS_SIDING_MEASUREMENT_KEYS[number];
