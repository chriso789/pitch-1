/**
 * Measurement Artifact Envelope — canonical TypeScript contract.
 *
 * Phase 2 contract layer. This file defines types and lightweight helpers
 * for the measurement-pipeline artifact envelope. It does NOT wrap or
 * modify any live skill / executor / export endpoint. Adoption happens
 * in later phases (DB persistence → validate_geometry → exports → reports).
 *
 * Authoritative spec: docs/measurement-artifact-envelope.md
 * JSON schema:        docs/schemas/measurement-artifact-envelope.schema.json
 * Python twin:        worker/app/artifacts/envelope.py
 */

export const MEASUREMENT_ENVELOPE_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const MEASUREMENT_ARTIFACT_TYPES = [
  "source_surface_data",
  "dsm",
  "dtm",
  "chm",
  "roof_points",
  "roof_mask",
  "roof_perimeter",
  "roof_planes",
  "ridge_segments",
  "hip_segments",
  "valley_segments",
  "eave_segments",
  "rake_segments",
  "pitch_measurements",
  "roof_area_measurements",
  "geometry_quality_score",
  "geojson_export",
  "report_export",
] as const;
export type MeasurementArtifactType = (typeof MEASUREMENT_ARTIFACT_TYPES)[number];

export const MEASUREMENT_ARTIFACT_STAGES = [
  "ingest",
  "generate_dsm",
  "generate_dtm",
  "generate_chm",
  "isolate_roof_points",
  "refine_roof_perimeter",
  "fit_roof_planes",
  "detect_ridges",
  "detect_hips",
  "detect_valleys",
  "detect_eaves",
  "detect_rakes",
  "calculate_pitch",
  "calculate_roof_area",
  "geometry_quality_score",
  "validate_geometry",
  "export_geojson",
  "export_report",
] as const;
export type MeasurementArtifactStage = (typeof MEASUREMENT_ARTIFACT_STAGES)[number];

export const MEASUREMENT_ARTIFACT_STATUSES = [
  "created",
  "partial",
  "complete",
  "validation_pending",
  "validated",
  "rejected",
  "exportable",
  "reportable",
  "failed",
] as const;
export type MeasurementArtifactStatus = (typeof MEASUREMENT_ARTIFACT_STATUSES)[number];

export type ProducerKind = "worker" | "control_plane" | "external";
export type CoordinateFrameType =
  | "source"
  | "project_metric"
  | "raster_grid"
  | "export_geojson"
  | "report_display";
export type CoordinateFrameStatus = "complete" | "partial" | "unknown";
export type ZConvention = "ellipsoidal_m" | "orthometric_m" | "relative_m" | "none" | null;
export type GeometryType =
  | "raster"
  | "point_cloud"
  | "polygon"
  | "multipolygon"
  | "linestring"
  | "multilinestring"
  | "plane_set"
  | "export_document"
  | "none";
export type ValidationStatus = "pending" | "passed" | "failed" | "skipped";
export type IssueSeverity = "info" | "warning" | "error" | "blocker";
export type ReportVisibility = "customer" | "internal" | "debug" | "hidden";
export type MapVisibility = "always" | "on_zoom" | "hidden";
export type StorageType = "supabase_storage" | "s3" | "inline" | "external";

// ---------------------------------------------------------------------------
// Block interfaces
// ---------------------------------------------------------------------------

export interface MeasurementCoordinateFrame {
  frame_id: string;
  frame_type: CoordinateFrameType;
  crs: string | null;
  origin?: number[] | null;
  axis_orientation?: string | null;
  units: string;
  has_z: boolean;
  z_convention?: ZConvention;
  transform_to_source?: Record<string, unknown> | null;
  transform_to_local?: Record<string, unknown> | null;
  transform_to_raster?: Record<string, unknown> | null;
  transform_to_export?: Record<string, unknown> | null;
  precision?: { xy_m?: number; z_m?: number } | null;
  status: CoordinateFrameStatus;
}

export interface MeasurementUnits {
  horizontal_distance: string;
  vertical_distance: string;
  area: string;
  slope: string;
  pitch: string;
  angle: string;
  raster_resolution: string;
  confidence: string;
  quality_score: string;
}

export interface MeasurementGeometryBlock {
  geometry_type: GeometryType;
  coordinate_frame: string;
  dimensions?: { width_px?: number; height_px?: number } | null;
  bbox?: number[] | null;
  value?: unknown;
  storage_ref?: string | null;
  precision?: Record<string, number> | null;
  no_data_policy?: { sentinel?: number; mask_band?: string | null } | null;
}

export interface MeasurementQualityBlock {
  overall_score: number;
  confidence?: number;
  component_scores?: Record<string, number>;
  completeness?: number;
  coordinate_integrity?: number;
  geometry_validity?: number;
  plane_fit_quality?: number;
  segment_consistency?: number;
  warnings_count: number;
  blockers_count: number;
}

export interface MeasurementArtifactIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  object_type?: string | null;
  object_id?: string | null;
  source_skill?: string | null;
  blocking: boolean;
  suggested_fix?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MeasurementValidationBlock {
  validation_status: ValidationStatus;
  validated_at?: string | null;
  validator_version?: string | null;
  errors: MeasurementArtifactIssue[];
  warnings: MeasurementArtifactIssue[];
  blockers: MeasurementArtifactIssue[];
  export_allowed: boolean;
  report_allowed: boolean;
}

export interface MeasurementLineageBlock {
  input_artifact_ids: string[];
  source_files?: string[];
  source_job_id?: string | null;
  parameters: Record<string, unknown>;
  skill_version: string;
  code_version?: string | null;
  runtime?: { language: "python" | "typescript"; version: string } | null;
  created_by: ProducerKind;
  dependencies?: string[];
}

export interface MeasurementStorageBlock {
  storage_type: StorageType;
  uri?: string | null;
  bucket?: string | null;
  path?: string | null;
  mime_type?: string | null;
  checksum?: { algo: string; value: string } | null;
  byte_size?: number | null;
  compression?: "none" | "gzip" | "zstd" | null;
  encoding?: string | null;
}

export interface MeasurementDisplayBlock {
  display_units?: Record<string, string>;
  rounding_rules?: Record<string, number>;
  labels?: Record<string, string>;
  report_visibility?: ReportVisibility;
  map_visibility?: MapVisibility;
}

export interface MeasurementProducer {
  kind: ProducerKind;
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface MeasurementArtifactEnvelope<TData = Record<string, unknown>> {
  schema_version: string;
  envelope_version: number;
  artifact_id: string;
  job_id: string;
  parent_artifact_ids: string[];
  artifact_type: MeasurementArtifactType;
  stage: MeasurementArtifactStage;
  source_skill: string;
  producer: MeasurementProducer;
  status: MeasurementArtifactStatus;
  created_at: string;
  coordinate_frame: MeasurementCoordinateFrame;
  units: MeasurementUnits;
  geometry: MeasurementGeometryBlock;
  data: TData;
  quality: MeasurementQualityBlock;
  validation: MeasurementValidationBlock;
  lineage: MeasurementLineageBlock;
  warnings: MeasurementArtifactIssue[];
  errors: MeasurementArtifactIssue[];
  storage?: MeasurementStorageBlock;
  display?: MeasurementDisplayBlock;
}

// ---------------------------------------------------------------------------
// Helpers (lightweight, no new dependencies)
// ---------------------------------------------------------------------------

/** RFC4122 v4 UUID. Uses crypto.randomUUID when available, falls back manually. */
export function createArtifactId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback (rare; Deno/Edge runtimes always have crypto.randomUUID).
  const rnd = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${rnd(8)}-${rnd(4)}-4${rnd(3)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${rnd(3)}-${rnd(12)}`;
}

export const DEFAULT_MEASUREMENT_UNITS: MeasurementUnits = {
  horizontal_distance: "m",
  vertical_distance: "m",
  area: "m^2",
  slope: "deg",
  pitch: "rise_per_12",
  angle: "deg",
  raster_resolution: "m_per_px",
  confidence: "ratio_0_1",
  quality_score: "ratio_0_1",
};

export interface CreateBaseEnvelopeInput {
  job_id: string;
  artifact_type: MeasurementArtifactType;
  stage: MeasurementArtifactStage;
  source_skill: string;
  producer: MeasurementProducer;
  parent_artifact_ids?: string[];
  coordinate_frame?: Partial<MeasurementCoordinateFrame>;
  units?: Partial<MeasurementUnits>;
  geometry?: Partial<MeasurementGeometryBlock>;
  data?: Record<string, unknown>;
  lineage?: Partial<MeasurementLineageBlock>;
}

export function createBaseArtifactEnvelope(
  input: CreateBaseEnvelopeInput,
): MeasurementArtifactEnvelope {
  const coord: MeasurementCoordinateFrame = {
    frame_id: "unknown",
    frame_type: "project_metric",
    crs: null,
    units: "m",
    has_z: false,
    status: "unknown",
    ...input.coordinate_frame,
  };
  return {
    schema_version: MEASUREMENT_ENVELOPE_SCHEMA_VERSION,
    envelope_version: 1,
    artifact_id: createArtifactId(),
    job_id: input.job_id,
    parent_artifact_ids: input.parent_artifact_ids ?? [],
    artifact_type: input.artifact_type,
    stage: input.stage,
    source_skill: input.source_skill,
    producer: input.producer,
    status: "created",
    created_at: new Date().toISOString(),
    coordinate_frame: coord,
    units: { ...DEFAULT_MEASUREMENT_UNITS, ...input.units },
    geometry: {
      geometry_type: "none",
      coordinate_frame: coord.frame_id,
      ...input.geometry,
    },
    data: input.data ?? {},
    quality: { overall_score: 0, warnings_count: 0, blockers_count: 0 },
    validation: {
      validation_status: "pending",
      errors: [],
      warnings: [],
      blockers: [],
      export_allowed: false,
      report_allowed: false,
    },
    lineage: {
      input_artifact_ids: input.parent_artifact_ids ?? [],
      parameters: {},
      skill_version: input.producer.version,
      created_by: input.producer.kind,
      ...input.lineage,
    },
    warnings: [],
    errors: [],
  };
}

/** Lightweight structural check. Returns list of missing/invalid field paths (empty = ok). */
export function isMeasurementArtifactEnvelope(value: unknown): value is MeasurementArtifactEnvelope {
  return validateMeasurementArtifactEnvelope(value).length === 0;
}

export function validateMeasurementArtifactEnvelope(value: unknown): string[] {
  const errs: string[] = [];
  if (!value || typeof value !== "object") return ["root: not an object"];
  const v = value as Record<string, unknown>;
  const required: Array<[string, (x: unknown) => boolean]> = [
    ["schema_version", (x) => typeof x === "string"],
    ["envelope_version", (x) => typeof x === "number" && Number.isInteger(x) && x >= 1],
    ["artifact_id", (x) => typeof x === "string"],
    ["job_id", (x) => typeof x === "string"],
    ["parent_artifact_ids", Array.isArray],
    ["artifact_type", (x) => typeof x === "string" && (MEASUREMENT_ARTIFACT_TYPES as readonly string[]).includes(x)],
    ["stage", (x) => typeof x === "string" && (MEASUREMENT_ARTIFACT_STAGES as readonly string[]).includes(x)],
    ["source_skill", (x) => typeof x === "string"],
    ["producer", (x) => !!x && typeof x === "object"],
    ["status", (x) => typeof x === "string" && (MEASUREMENT_ARTIFACT_STATUSES as readonly string[]).includes(x)],
    ["created_at", (x) => typeof x === "string"],
    ["coordinate_frame", (x) => !!x && typeof x === "object"],
    ["units", (x) => !!x && typeof x === "object"],
    ["geometry", (x) => !!x && typeof x === "object"],
    ["data", (x) => !!x && typeof x === "object"],
    ["quality", (x) => !!x && typeof x === "object"],
    ["validation", (x) => !!x && typeof x === "object"],
    ["lineage", (x) => !!x && typeof x === "object"],
    ["warnings", Array.isArray],
    ["errors", Array.isArray],
  ];
  for (const [k, ok] of required) if (!ok(v[k])) errs.push(k);
  return errs;
}

export interface MeasurementArtifactEnvelopeSummary {
  artifact_id: string;
  artifact_type: MeasurementArtifactType;
  stage: MeasurementArtifactStage;
  status: MeasurementArtifactStatus;
  overall_score: number;
  warnings_count: number;
  blockers_count: number;
  validation_status: ValidationStatus;
  export_allowed: boolean;
  report_allowed: boolean;
}

export function summarizeArtifactEnvelope(
  env: MeasurementArtifactEnvelope,
): MeasurementArtifactEnvelopeSummary {
  return {
    artifact_id: env.artifact_id,
    artifact_type: env.artifact_type,
    stage: env.stage,
    status: env.status,
    overall_score: env.quality.overall_score,
    warnings_count: env.quality.warnings_count,
    blockers_count: env.quality.blockers_count,
    validation_status: env.validation.validation_status,
    export_allowed: env.validation.export_allowed,
    report_allowed: env.validation.report_allowed,
  };
}

export function makeIssue(
  severity: IssueSeverity,
  code: string,
  message: string,
  extra: Partial<MeasurementArtifactIssue> = {},
): MeasurementArtifactIssue {
  return {
    severity,
    code,
    message,
    blocking: severity === "blocker",
    ...extra,
  };
}
