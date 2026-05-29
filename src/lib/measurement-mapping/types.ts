// Frontend types mirroring supabase/functions/_shared/measurement-mapping.
// Keep in lockstep with the Deno types. Phase 1: foundation + mapping preview.

export type SurfaceClass = "flat" | "low_slope" | "sloped" | "other" | "unknown";

export type FeatureType =
  | "ridge" | "hip" | "valley" | "eave" | "rake" | "drip_edge"
  | "step_flashing" | "wall_flashing" | "parapet" | "gutter" | "downspout"
  | "drain" | "pipe_boot" | "vent" | "skylight" | "chimney" | "other";

export type AssignmentStatus =
  | "assigned"
  | "assigned_global_fallback"
  | "unresolved"
  | "conflict"
  | "manual"
  | "skipped";

export type ReasonCode =
  | "global_only_import"
  | "global_fallback"
  | "missing_class_measurement"
  | "unknown_pitch"
  | "low_confidence"
  | "no_matching_segment"
  | "formula_error"
  | "rule_no_match"
  | "manual_split";

export interface MeasurementImport {
  id: string;
  tenant_id: string;
  roof_measurement_id: string | null;
  job_id: string | null;
  provider: string | null;
  import_status: string;
  raw_payload: unknown;
  created_at: string;
}

export interface MeasurementSegment {
  id: string;
  tenant_id: string;
  measurement_import_id: string;
  name: string | null;
  area_sqft: number | null;
  pitch_rise_over_12: number | null;
  pitch_scope: "segment" | "global" | "none";
  surface_class: SurfaceClass;
  classification_confidence: number;
  classification_reason: string | null;
  is_synthetic_split: boolean;
  is_split_residual: boolean;
  reviewed: boolean;
  archived_at: string | null;
}

export interface MeasurementFeature {
  id: string;
  tenant_id: string;
  measurement_import_id: string;
  feature_type: FeatureType;
  length_ft: number | null;
  count_value: number | null;
  primary_segment_id: string | null;
  confidence: number;
  archived_at: string | null;
}

export interface TemplateSectionRule {
  id: string;
  group_id: string;
  surface_classes: SurfaceClass[];
  feature_types: FeatureType[];
  min_pitch: number | null;
  max_pitch: number | null;
  allow_unknown: boolean;
  priority: number;
}

export interface TemplateItemRule {
  id: string;
  item_id: string;
  surface_classes: SurfaceClass[];
  feature_types: FeatureType[];
  measurement_scope: "global" | "class" | "section";
  allow_global_fallback: boolean;
  allow_unknown: boolean;
  min_confidence: number;
  exclusive_group: string | null;
}

export interface EstimateMeasurementAssignment {
  template_group_id: string;
  template_item_id: string;
  segment_ids: string[];
  feature_ids: string[];
  quantity: number | null;
  unit: string | null;
  formula_evaluated: string | null;
  confidence: number;
  status: AssignmentStatus;
  reason_code: ReasonCode | null;
  matched_by: Record<string, unknown>;
}

export interface MappingConflict extends EstimateMeasurementAssignment {
  status: "conflict";
}

export interface MappingPreviewResult {
  measurement_import_id: string;
  calc_template_id: string;
  assignments: EstimateMeasurementAssignment[];
  unresolved: EstimateMeasurementAssignment[];
  conflicts: MappingConflict[];
  summary: {
    total_items: number;
    assigned: number;
    unresolved: number;
    conflicts: number;
    skipped: number;
  };
  /** True when the call was a dry-run preview (no rows persisted). */
  dry_run?: boolean;
  /** Run id from a persist call. Null for dry-runs. */
  mapping_run_id?: string | null;
}

export interface ManualSplitPayload {
  flat?: { area_sqft: number };
  low_slope?: { area_sqft: number };
  sloped?: { area_sqft: number };
}
