// ───────────────────────────────────────────────────────────────────────
// diagram-render-intent normalizer
// ───────────────────────────────────────────────────────────────────────
//
// The `roof_measurements.diagram_render_intent` column is gated by a
// CHECK constraint that only permits the 6 stable buckets below. Newer
// runtime intents (debug/diagnostic variants emitted by the measurement
// pipeline) MUST be normalized through `normalizeDiagramRenderIntentForWrite`
// before any insert/update.
//
// If an unknown raw intent appears we:
//   - persist `diagnostic_only` to the column (DB-safe)
//   - keep the raw value inside geometry_report_json for diagnostics
//   - record a normalization warning so schema drift is visible

export type DiagramRenderIntentStable =
  | "full_topology"
  | "perimeter_only"
  | "rejected_only"
  | "diagnostic_only"
  | "registration_blocked"
  | "perimeter_debug_only";

export const STABLE_DIAGRAM_RENDER_INTENTS: ReadonlyArray<DiagramRenderIntentStable> = [
  "full_topology",
  "perimeter_only",
  "rejected_only",
  "diagnostic_only",
  "registration_blocked",
  "perimeter_debug_only",
];

const MAPPING: Record<string, DiagramRenderIntentStable> = {
  // full topology
  customer_report_ready: "full_topology",
  full: "full_topology",
  full_topology: "full_topology",

  // perimeter only (publishable)
  perimeter_only: "perimeter_only",

  // rejected (failed topology / pitch / unknown)
  rejected: "rejected_only",
  rejected_only: "rejected_only",
  failed: "rejected_only",
  internal_review: "rejected_only",

  // diagnostic-only
  diagnostic: "diagnostic_only",
  diagnostic_only: "diagnostic_only",
  debug_only: "diagnostic_only",

  // registration blocked
  registration_blocked: "registration_blocked",
  target_roof_not_confirmed: "registration_blocked",
  target_confirmation_required: "registration_blocked",
  coordinate_registration_failed: "registration_blocked",
  coordinate_registration_debug_only: "registration_blocked",
  registration_field_conflict: "registration_blocked",
  blocked_by_registration_gate: "registration_blocked",
  source_registration_failed: "registration_blocked",
  coordinate_mismatch: "registration_blocked",

  // perimeter debug only
  perimeter_debug_only: "perimeter_debug_only",
  perimeter_shape_not_accurate: "perimeter_debug_only",
  visual_perimeter_alignment_failed: "perimeter_debug_only",
  perimeter_refinement_failed: "perimeter_debug_only",
};

export interface DiagramRenderIntentNormalizationResult {
  normalized: DiagramRenderIntentStable;
  raw: string | null;
  warning: string | null;
  drifted: boolean;
}

export function normalizeDiagramRenderIntentForWrite(
  value: unknown,
  _context?: Record<string, unknown>,
): DiagramRenderIntentNormalizationResult {
  if (value == null) {
    return { normalized: "diagnostic_only", raw: null, warning: null, drifted: false };
  }
  const raw = String(value).trim();
  if (!raw) {
    return { normalized: "diagnostic_only", raw: null, warning: null, drifted: false };
  }
  const key = raw.toLowerCase();
  const mapped = MAPPING[key];
  if (mapped) {
    return { normalized: mapped, raw, warning: null, drifted: false };
  }
  return {
    normalized: "diagnostic_only",
    raw,
    warning: `unknown diagram_render_intent "${raw}" — coerced to diagnostic_only`,
    drifted: true,
  };
}

export function isStableDiagramRenderIntent(value: unknown): value is DiagramRenderIntentStable {
  return typeof value === "string" && (STABLE_DIAGRAM_RENDER_INTENTS as ReadonlyArray<string>).includes(value);
}

/**
 * Detect Postgres CHECK constraint violations for diagram_render_intent.
 * Used by safeInsertMeasurement-style retry helpers.
 */
export function isDiagramRenderIntentConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = String((error as any).message ?? "").toLowerCase();
  const code = String((error as any).code ?? "");
  return (
    msg.includes("roof_measurements_diagram_render_intent_check") ||
    (code === "23514" && msg.includes("diagram_render_intent"))
  );
}
