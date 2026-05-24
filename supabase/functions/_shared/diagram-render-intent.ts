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
  ai_failed_schema: "diagnostic_only",
  ai_failed_unknown: "diagnostic_only",

  // registration blocked
  registration_blocked: "registration_blocked",
  ai_failed_target_unconfirmed: "registration_blocked",
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
  ai_failed_perimeter: "perimeter_debug_only",

  // failed-but-saved diagnostic topology/pitch buckets
  ai_failed_topology: "rejected_only",
  ai_failed_pitch: "rejected_only",
};

const REGISTRATION_FAILURE_TOKENS = [
  "target_unconfirmed",
  "target_roof_not_confirmed",
  "target_confirmation_required",
  "coordinate_registration_failed",
  "registration_field_conflict",
  "blocked_by_registration_gate",
  "source_registration_failed",
  "coordinate_mismatch",
];

function contextText(context?: Record<string, unknown>): string {
  if (!context) return "";
  const fields = [
    context.result_state,
    context.hard_fail_reason,
    context.block_customer_report_reason,
    context.registration_precedence_reason,
    context.failure_stage,
  ];
  return fields.filter((v) => v != null).map((v) => String(v).toLowerCase()).join("|");
}

function deriveContextualIntent(context?: Record<string, unknown>): DiagramRenderIntentStable | null {
  const text = contextText(context);
  if (!text) return null;
  if (REGISTRATION_FAILURE_TOKENS.some((token) => text.includes(token))) return "registration_blocked";
  if (text.includes("perimeter_shape_not_accurate") || text.includes("visual_perimeter_alignment_failed") || text.includes("perimeter_refinement_failed") || text.includes("ai_failed_perimeter")) return "perimeter_debug_only";
  if (text.includes("ai_failed_topology") || text.includes("ai_failed_pitch")) return "rejected_only";
  if (text.includes("customer_report_ready")) return "full_topology";
  if (text.includes("perimeter_only")) return "perimeter_only";
  if (text.includes("ai_failed_schema") || text.includes("ai_failed_unknown")) return "diagnostic_only";
  return null;
}

export interface DiagramRenderIntentNormalizationResult {
  normalized: DiagramRenderIntentStable;
  raw: string | null;
  warning: string | null;
  drifted: boolean;
}

export function normalizeDiagramRenderIntentForWrite(
  value: unknown,
  context?: Record<string, unknown>,
): DiagramRenderIntentNormalizationResult {
  const contextual = deriveContextualIntent(context);
  if (value == null) {
    return { normalized: contextual ?? "diagnostic_only", raw: null, warning: null, drifted: false };
  }
  const raw = String(value).trim();
  if (!raw) {
    return { normalized: contextual ?? "diagnostic_only", raw: null, warning: null, drifted: false };
  }
  const key = raw.toLowerCase();
  if (contextual && ["rejected_only", "diagnostic_only", "rejected", "failed", "debug_only", "ai_failed_source_acquisition"].includes(key)) {
    return {
      normalized: contextual,
      raw,
      warning: raw === contextual ? null : `diagram_render_intent "${raw}" refined to ${contextual} from result context`,
      drifted: raw !== contextual,
    };
  }
  const mapped = MAPPING[key];
  if (mapped) {
    return { normalized: mapped, raw, warning: null, drifted: false };
  }
  if (contextual) {
    return {
      normalized: contextual,
      raw,
      warning: `unknown diagram_render_intent "${raw}" — coerced to ${contextual} from result context`,
      drifted: true,
    };
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

export function withDiagramRenderIntentConstraintRetryPayload<T extends Record<string, unknown>>(
  payload: T,
): T {
  const failed = (payload as any).diagram_render_intent ?? null;
  const geom = (typeof payload.geometry_report_json === "object" && payload.geometry_report_json !== null && !Array.isArray(payload.geometry_report_json))
    ? { ...(payload.geometry_report_json as Record<string, unknown>) }
    : { raw_geometry_report_json: payload.geometry_report_json ?? null };
  (geom as any).insert_retry = {
    reason: "diagram_render_intent_check_violation",
    raw_diagram_render_intent: failed,
    retried_with: "diagnostic_only",
  };
  (geom as any).raw_diagram_render_intent = failed;
  (geom as any).normalized_diagram_render_intent = "diagnostic_only";
  (geom as any).diagram_render_intent = "diagnostic_only";
  return { ...payload, diagram_render_intent: "diagnostic_only", geometry_report_json: geom };
}
