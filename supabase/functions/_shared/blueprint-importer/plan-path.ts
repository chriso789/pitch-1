// Blueprint Importer v2 — PlanPath provenance contract (Phase 1).
// Side-effect-free.

export type PlanPathType =
  | "report_page"
  | "blueprint_sheet"
  | "spec_section"
  | "user_entry"
  | "derived";

export interface BlueprintPlanPath {
  id?: string;
  import_session_id: string;
  source_document_id?: string | null;
  path_type: PlanPathType;
  file_name?: string | null;
  document_type?: string | null;
  provider?: string | null;
  page_number?: number | null;
  section_label?: string | null;
  table_label?: string | null;
  diagram_label?: string | null;
  source_text_excerpt?: string | null;
  source_coordinates?: Record<string, unknown> | null;
  confidence: number; // 0..1
}

/**
 * Phase 0 rule: every auto-populated material/labor line must carry a non-empty
 * PlanPath. This is the validator. Returns null when valid, or a reason string.
 */
export function validatePlanPathPresent(
  plan_path: Partial<BlueprintPlanPath> | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!plan_path) return { ok: false, reason: "plan_path is missing" };
  if (!plan_path.path_type) return { ok: false, reason: "plan_path.path_type is required" };
  const hasAnchor =
    !!plan_path.source_document_id ||
    !!plan_path.file_name ||
    !!plan_path.section_label ||
    !!plan_path.table_label ||
    !!plan_path.diagram_label ||
    !!plan_path.source_text_excerpt ||
    typeof plan_path.page_number === "number";
  if (!hasAnchor) {
    return { ok: false, reason: "plan_path needs at least one anchor (source_document_id, page_number, section_label, table_label, diagram_label, source_text_excerpt, or file_name)" };
  }
  if (typeof plan_path.confidence === "number" && (plan_path.confidence < 0 || plan_path.confidence > 1)) {
    return { ok: false, reason: "plan_path.confidence must be in [0,1]" };
  }
  return { ok: true };
}

/**
 * Trades that MUST carry a PlanPath on every measurement/draft line they emit.
 * Currently: all MVP-supported trades. Measurement-object-only trades surface
 * via measurement objects which themselves require PlanPaths.
 */
export function requiresPlanPath(_trade_id: string): boolean {
  return true;
}
