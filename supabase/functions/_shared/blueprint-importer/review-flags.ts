// Blueprint Importer v2 — Review flag contract (Phase 1).
// Side-effect-free.

export type ReviewFlagSeverity = "info" | "warning" | "error" | "blocker";

export type ReviewFlagRelatedEntityType =
  | "import_session"
  | "source_document"
  | "detected_trade"
  | "accepted_trade"
  | "measurement_object"
  | "template_binding"
  | "material_draft_line"
  | "labor_draft_line"
  | "plan_path";

export type ReviewFlagCode =
  | "missing_required_measurement"
  | "unsupported_trade_for_mvp"
  | "paint_without_wall_source"
  | "windows_doors_selected_as_trade"
  | "missing_plan_path"
  | "low_confidence_measurement"
  | "future_trade_requires_sheet_intelligence"
  | "formula_input_missing"
  | "template_required_assumption_missing"
  // non-blocking informational codes are allowed too; consumers should treat
  // unknown codes as warnings by default
  | (string & {});

export interface BlueprintReviewFlag {
  id?: string;
  import_session_id: string;
  related_entity_type: ReviewFlagRelatedEntityType;
  related_entity_id?: string | null;
  severity: ReviewFlagSeverity;
  flag_code: ReviewFlagCode;
  message: string;
  blocking: boolean;
  resolved?: boolean;
  resolved_by?: string | null;
  resolved_at?: string | null;
  metadata?: Record<string, unknown>;
}

const BLOCKING_FLAG_CODES = new Set<string>([
  "missing_required_measurement",
  "unsupported_trade_for_mvp",
  "paint_without_wall_source",
  "windows_doors_selected_as_trade",
  "missing_plan_path",
  "future_trade_requires_sheet_intelligence",
  "formula_input_missing",
  "template_required_assumption_missing",
]);

export function createReviewFlag(input: Omit<BlueprintReviewFlag, "blocking" | "severity"> & {
  severity?: ReviewFlagSeverity;
  blocking?: boolean;
}): BlueprintReviewFlag {
  const inferredBlocking = input.blocking ?? BLOCKING_FLAG_CODES.has(String(input.flag_code));
  const inferredSeverity: ReviewFlagSeverity =
    input.severity ?? (inferredBlocking ? "blocker" : "warning");
  return {
    ...input,
    blocking: inferredBlocking,
    severity: inferredSeverity,
    resolved: input.resolved ?? false,
  };
}
