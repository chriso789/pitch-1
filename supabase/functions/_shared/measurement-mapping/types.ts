// Section-aware measurement mapping — shared types.
// Phase 1: foundation + template rules + mapping engine (no override UI).

export type SurfaceClass = "flat" | "low_slope" | "sloped" | "other" | "unknown";

export type PitchScope = "segment" | "global" | "none";

export type FeatureType =
  | "ridge" | "hip" | "valley" | "eave" | "rake" | "drip_edge"
  | "step_flashing" | "wall_flashing" | "parapet" | "gutter" | "downspout"
  | "drain" | "pipe_boot" | "vent" | "skylight" | "chimney" | "other";

export type AssignmentStatus = "assigned" | "unresolved" | "conflict" | "manual" | "skipped";

export type ReasonCode =
  | "global_only_import"
  | "missing_class_measurement"
  | "unknown_pitch"
  | "low_confidence"
  | "no_matching_segment"
  | "formula_error"
  | "rule_no_match";

export interface MeasurementSegment {
  id: string;
  tenant_id: string;
  measurement_import_id: string;
  name: string | null;
  area_sqft: number | null;
  pitch_rise_over_12: number | null;
  pitch_scope: PitchScope;
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

// Sentinel for "this class has no evidence". Differs from numeric 0.
export const UNAVAILABLE = Symbol.for("measurement_mapping.unavailable");
export type Unavailable = typeof UNAVAILABLE;
export type MaybeNumber = number | Unavailable;

export function isUnavailable(v: unknown): v is Unavailable {
  return v === UNAVAILABLE;
}

export interface ClassBucket {
  area_sqft: MaybeNumber;
  squares: MaybeNumber;
  segment_count: number;
  avg_confidence: number;
}

export interface ScopedContext {
  global: {
    roof: { total_sqft: number; squares: number };
    features: Record<string, number>;
  };
  class: Record<"flat" | "low_slope" | "sloped" | "other" | "unknown", ClassBucket>;
  section: Record<string, Record<string, number>>;
  meta: {
    has_class_split: boolean;
    aggregate_only: boolean;
    total_segments: number;
    total_features: number;
  };
}

export interface Assignment {
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

export interface MappingResult {
  measurement_import_id: string;
  calc_template_id: string;
  assignments: Assignment[];
  unresolved: Assignment[];
  conflicts: Assignment[];
  summary: {
    total_items: number;
    assigned: number;
    unresolved: number;
    conflicts: number;
    skipped: number;
  };
}
