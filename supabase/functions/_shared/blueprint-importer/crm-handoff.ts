// Blueprint Importer v2 — Phase 5.5 CRM handoff contracts.
// Pure type + helper module. Side-effect-free. No DB, no IO, no estimate writes.
// Phase 5.5 ships shape only — these helpers are NOT yet invoked from runtime.

import type { TradeId } from "./trade-catalog.ts";
import { isFutureSupportedTrade, isMeasurementObjectOnlyTrade } from "./trade-catalog.ts";

// ---------------------------------------------------------------------------
// Canonical target
// ---------------------------------------------------------------------------

/** Phase 5.5 canonical CRM estimate header target. enhanced_estimates only. */
export type CanonicalEstimateTarget = "enhanced_estimates";
export const CANONICAL_ESTIMATE_TARGET: CanonicalEstimateTarget = "enhanced_estimates";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type SourceDraftLineType = "material" | "labor";

export type HandoffBatchStatus =
  | "draft"
  | "preview_requested"
  | "preview_created"
  | "user_review_required"
  | "user_approved_for_estimate"
  | "live_write_requested"
  | "live_written"
  | "superseded"
  | "cancelled"
  | "failed";

export type EstimateLineCandidateStatus =
  | "draft"
  | "preview"
  | "blocked"
  | "user_review_required"
  | "user_approved"
  | "superseded"
  | "cancelled"
  | "failed"
  | "live_written";

export type CatalogResolutionStatus =
  | "unresolved"
  | "matched"
  | "ambiguous"
  | "missing"
  | "manual_override";

export type PricingStatus =
  | "quantity_only"
  | "cost_unresolved"
  | "catalog_resolved_cost_missing"
  | "catalog_resolved_cost_available"
  | "labor_rate_missing"
  | "ready_for_pricing_review"
  | "ready_for_live_handoff"
  | "blocked";

export type CostStatus =
  | "not_attempted"
  | "unavailable"
  | "available_from_catalog"
  | "available_from_user_override";

export type UserReviewStatus = "pending" | "reviewed" | "approved" | "excluded";

export type CatalogHandoffMode =
  | "catalog_resolved_only"
  | "user_approved_custom_lines"
  | "preview_only";

export type PricingMode = "quantity_only" | "ready_for_pricing_review";

export type CustomLineMode = "disabled" | "enabled";

export type HandoffBlockerCode =
  | "MISSING_PLAN_PATH"
  | "MISSING_SOURCE_MEASUREMENT_IDS"
  | "MISSING_ACCEPTED_TRADE_ID"
  | "MISSING_SOURCE_DOCUMENT_IDS"
  | "PROVENANCE_TENANT_MISMATCH"
  | "WINDOWS_DOORS_STANDALONE_TRADE"
  | "FUTURE_SUPPORTED_TRADE"
  | "UNSUPPORTED_TRADE"
  | "PAINT_WITHOUT_SIDING_SOURCE"
  | "CATALOG_UNRESOLVED_LIVE_HANDOFF"
  | "CATALOG_TENANT_MISMATCH"
  | "CUSTOM_LINE_WITHOUT_USER_APPROVAL"
  | "CUSTOM_LINE_PROVENANCE_DROPPED"
  | "PRICING_REQUIRED_BUT_UNAVAILABLE"
  | "FINAL_PRICING_NOT_APPROVED"
  | "LABOR_RATE_LOOKUP_INPUTS_MISSING"
  | "INVENTED_PRICING_DETECTED"
  | "COMPLEXITY_MULTIPLIER_AS_PRICE"
  | "MISSING_REQUIRED_ASSUMPTION"
  | "MISSING_QUANTITY"
  | "MISSING_UNIT"
  | "DRYWALL_FRAMING_MEP_BLOCKED"
  | "TARGET_ESTIMATE_NOT_SELECTED"
  | "TARGET_ESTIMATE_TENANT_MISMATCH"
  | "TARGET_ESTIMATE_LOCKED"
  | "TARGET_HEADER_TABLE_UNDECIDED"
  | "TARGET_PROVENANCE_SURFACE_MISSING"
  | "TENANT_MISMATCH_CANDIDATE_VS_SESSION"
  | "STALE_IMPORT_SESSION"
  | "DRAFT_ROW_SUPERSEDED"
  | "DETERMINISTIC_KEY_COLLISION"
  | "EXISTING_LINE_AT_KEY_NEEDS_DECISION"
  | "USER_APPROVAL_PENDING"
  | "USER_APPROVAL_STALE"
  | "BULK_APPROVAL_WITHOUT_PER_LINE_REVIEW"
  | "FINAL_PUSH_NOT_INVOKED";

export type HandoffWarningCode =
  | "CATALOG_RESOLVED_COST_MISSING"
  | "QUANTITY_FROM_ASSUMPTION"
  | "QUANTITY_FROM_REPORT_WASTE_TABLE"
  | "QUANTITY_FROM_FORMULA_OVERRIDES_REPORT"
  | "ROOF_PENETRATION_FIELD_VERIFY"
  | "ROOF_WASTE_EXCLUDES_RIDGE_HIP_VALLEY_STARTER"
  | "ROOF_FLAT_AREA_EXCLUDED"
  | "WALL_IMAGE_OBSTRUCTION"
  | "WALL_SOFFIT_ASSUMPTION"
  | "WALL_FIELD_VERIFY_REQUIRED"
  | "PAINT_COATS_ASSUMED"
  | "GUTTER_PROFILE_ASSUMED"
  | "EAVES_RAKES_FROM_ROOF_REPORT";

// ---------------------------------------------------------------------------
// Object shapes
// ---------------------------------------------------------------------------

export interface BlueprintEstimateHandoffBatch {
  id?: string;
  tenant_id: string;
  import_session_id: string;
  target_context_type:
    | "project"
    | "opportunity"
    | "lead"
    | "estimate"
    | "contact"
    | "standalone";
  target_context_id?: string | null;
  canonical_estimate_target_table: CanonicalEstimateTarget;
  canonical_estimate_target_id?: string | null;
  status: HandoffBatchStatus;
  pricing_mode: PricingMode;
  catalog_mode: CatalogHandoffMode;
  custom_line_mode: CustomLineMode;
  created_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  deterministic_batch_key: string;
  source_draft_hash?: string | null;
  blocking_review_flag_ids: string[];
  warning_review_flag_ids: string[];
  metadata?: Record<string, unknown>;
}

export interface BlueprintEstimateLineCandidate {
  id?: string;
  tenant_id: string;
  handoff_batch_id: string;
  import_session_id: string;
  accepted_trade_id: string;
  template_binding_id?: string | null;
  source_draft_line_id: string;
  source_draft_line_type: SourceDraftLineType;
  trade_id: TradeId | string;
  item_key: string;
  item_name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit?: string | null;
  source_measurement_ids: string[];
  plan_path_ids: string[];
  source_document_ids: string[];
  formula_key?: string | null;
  formula_inputs: Record<string, unknown>;
  catalog_resolution_status: CatalogResolutionStatus;
  catalog_item_id?: string | null;
  pricing_status: PricingStatus;
  cost_status: CostStatus;
  user_review_status: UserReviewStatus;
  handoff_allowed: boolean;
  handoff_blockers: HandoffBlockerCode[];
  blocking_review_flag_ids: string[];
  warning_review_flag_ids: string[];
  deterministic_handoff_key: string;
  provenance_summary: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  status: EstimateLineCandidateStatus;
}

export interface BlueprintEstimateLineProvenance {
  id?: string;
  tenant_id: string;
  handoff_batch_id: string;
  line_candidate_id: string;
  canonical_estimate_target_table: CanonicalEstimateTarget;
  canonical_estimate_target_id?: string | null;
  live_estimate_line_item_id?: string | null;
  deterministic_handoff_key: string;
  import_session_id: string;
  accepted_trade_id: string;
  template_binding_id?: string | null;
  source_draft_line_id: string;
  source_draft_line_type: SourceDraftLineType;
  source_measurement_ids: string[];
  plan_path_ids: string[];
  source_document_ids: string[];
  formula_key?: string | null;
  formula_inputs: Record<string, unknown>;
  approved_by?: string | null;
  approved_at?: string | null;
  live_written_by?: string | null;
  live_written_at?: string | null;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Deterministic key builders (pure, no IO)
// ---------------------------------------------------------------------------

function canonicalDecimal(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "null";
  // Strip trailing zeros, fixed 6-decimal precision.
  return Number(n).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function sortedUuidList(ids: string[]): string {
  return [...ids].sort().join(",");
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DeterministicBatchKeyInputs {
  tenant_id: string;
  import_session_id: string;
  target_context_type: string;
  target_context_id?: string | null;
  canonical_estimate_target_table: CanonicalEstimateTarget;
  canonical_estimate_target_id?: string | null;
  pricing_mode: PricingMode;
  catalog_mode: CatalogHandoffMode;
  custom_line_mode: CustomLineMode;
  /** Phase 7.5: required. Stale source drafts MUST produce a different batch key. */
  source_draft_hash: string | null;
}

export async function createDeterministicBatchKey(
  inputs: DeterministicBatchKeyInputs,
): Promise<string> {
  const payload = [
    inputs.tenant_id,
    inputs.import_session_id,
    inputs.target_context_type,
    inputs.target_context_id ?? "null",
    inputs.canonical_estimate_target_table,
    inputs.canonical_estimate_target_id ?? "null",
    inputs.pricing_mode,
    inputs.catalog_mode,
    inputs.custom_line_mode,
    inputs.source_draft_hash ?? "null",
  ].join(":");
  return await sha256Hex(payload);
}

export interface DeterministicHandoffKeyInputs {
  tenant_id: string;
  import_session_id: string;
  accepted_trade_id: string;
  template_binding_id?: string | null;
  source_draft_line_id: string;
  source_draft_line_type: SourceDraftLineType;
  formula_key?: string | null;
  quantity?: number | null;
  unit?: string | null;
  source_measurement_ids: string[];
  plan_path_ids: string[];
  template_version?: string | null;
  user_assumptions?: Record<string, unknown> | null;
}

export async function createDeterministicHandoffKey(
  inputs: DeterministicHandoffKeyInputs,
): Promise<string> {
  const payload = [
    inputs.tenant_id,
    inputs.import_session_id,
    inputs.accepted_trade_id,
    inputs.template_binding_id ?? "null",
    inputs.source_draft_line_id,
    inputs.source_draft_line_type,
    inputs.formula_key ?? "null",
    canonicalDecimal(inputs.quantity ?? null),
    inputs.unit ?? "null",
    sortedUuidList(inputs.source_measurement_ids),
    sortedUuidList(inputs.plan_path_ids),
    inputs.template_version ?? "null",
    canonicalJson(inputs.user_assumptions ?? {}),
  ].join(":");
  return await sha256Hex(payload);
}

// ---------------------------------------------------------------------------
// Pure validators (return blocker codes; never throw on data, only on contract abuse)
// ---------------------------------------------------------------------------

export function validateCandidateHasPlanPath(c: Pick<BlueprintEstimateLineCandidate, "plan_path_ids">): HandoffBlockerCode[] {
  return (c.plan_path_ids?.length ?? 0) >= 1 ? [] : ["MISSING_PLAN_PATH"];
}

export function validateCandidateHasMeasurements(c: Pick<BlueprintEstimateLineCandidate, "source_measurement_ids">): HandoffBlockerCode[] {
  return (c.source_measurement_ids?.length ?? 0) >= 1 ? [] : ["MISSING_SOURCE_MEASUREMENT_IDS"];
}

export function validateCandidateTradeAllowed(c: Pick<BlueprintEstimateLineCandidate, "trade_id">): HandoffBlockerCode[] {
  const blockers: HandoffBlockerCode[] = [];
  const trade = c.trade_id as TradeId;
  if (trade === "windows_doors" || isMeasurementObjectOnlyTrade?.(trade)) {
    blockers.push("WINDOWS_DOORS_STANDALONE_TRADE");
  }
  if (isFutureSupportedTrade?.(trade)) {
    blockers.push("FUTURE_SUPPORTED_TRADE");
  }
  return blockers;
}

export function validateCandidateCatalogGate(
  c: Pick<BlueprintEstimateLineCandidate, "catalog_resolution_status">,
  mode: CatalogHandoffMode,
  userApprovedCustomLine = false,
): HandoffBlockerCode[] {
  if (c.catalog_resolution_status === "matched" || c.catalog_resolution_status === "manual_override") return [];
  if (mode === "catalog_resolved_only") return ["CATALOG_UNRESOLVED_LIVE_HANDOFF"];
  if (mode === "preview_only") return ["CATALOG_UNRESOLVED_LIVE_HANDOFF"];
  if (mode === "user_approved_custom_lines" && !userApprovedCustomLine) {
    return ["CUSTOM_LINE_WITHOUT_USER_APPROVAL"];
  }
  return [];
}

export function validateCandidateReviewGates(
  c: Pick<BlueprintEstimateLineCandidate, "blocking_review_flag_ids" | "quantity" | "unit">,
): HandoffBlockerCode[] {
  const blockers: HandoffBlockerCode[] = [];
  if ((c.blocking_review_flag_ids?.length ?? 0) > 0) {
    // Granular flag mapping is owned by the review-flag-codes module; this helper
    // only signals presence so the preview UI can prompt resolution.
  }
  if (c.quantity === null || c.quantity === undefined || Number.isNaN(c.quantity)) {
    blockers.push("MISSING_QUANTITY");
  }
  if (!c.unit) blockers.push("MISSING_UNIT");
  return blockers;
}

export interface ProvenanceSummary {
  source_document_ids: string[];
  plan_path_ids: string[];
  source_measurement_ids: string[];
  formula_key: string | null;
  draft_line_id: string;
  draft_line_type: SourceDraftLineType;
  template_binding_id: string | null;
  accepted_trade_id: string;
}

export function summarizeCandidateProvenance(
  c: Pick<
    BlueprintEstimateLineCandidate,
    | "source_document_ids"
    | "plan_path_ids"
    | "source_measurement_ids"
    | "formula_key"
    | "source_draft_line_id"
    | "source_draft_line_type"
    | "template_binding_id"
    | "accepted_trade_id"
  >,
): ProvenanceSummary {
  return {
    source_document_ids: c.source_document_ids ?? [],
    plan_path_ids: c.plan_path_ids ?? [],
    source_measurement_ids: c.source_measurement_ids ?? [],
    formula_key: c.formula_key ?? null,
    draft_line_id: c.source_draft_line_id,
    draft_line_type: c.source_draft_line_type,
    template_binding_id: c.template_binding_id ?? null,
    accepted_trade_id: c.accepted_trade_id,
  };
}

export function assertCandidateCanPreview(c: BlueprintEstimateLineCandidate): void {
  const blockers = [
    ...validateCandidateHasPlanPath(c),
    ...validateCandidateHasMeasurements(c),
    ...validateCandidateTradeAllowed(c),
  ];
  if (blockers.length > 0) {
    throw new Error(`Candidate cannot preview — blockers: ${blockers.join(",")}`);
  }
}

/**
 * Phase 5.5 contract helper — NOT used by runtime yet. Phase 7 will invoke this
 * gate at live-write time. Listed here so the contract is single-sourced.
 */
export function assertCandidateCanLiveWrite(
  c: BlueprintEstimateLineCandidate,
  batch: Pick<BlueprintEstimateHandoffBatch, "catalog_mode" | "status">,
  opts: { userApprovedCustomLine?: boolean } = {},
): void {
  const blockers: HandoffBlockerCode[] = [
    ...validateCandidateHasPlanPath(c),
    ...validateCandidateHasMeasurements(c),
    ...validateCandidateTradeAllowed(c),
    ...validateCandidateCatalogGate(c, batch.catalog_mode, opts.userApprovedCustomLine),
    ...validateCandidateReviewGates(c),
  ];
  if (c.user_review_status !== "approved") blockers.push("USER_APPROVAL_PENDING");
  if (batch.status !== "user_approved_for_estimate" && batch.status !== "live_write_requested") {
    blockers.push("FINAL_PUSH_NOT_INVOKED");
  }
  if (!c.handoff_allowed) blockers.push("USER_APPROVAL_PENDING");
  if (blockers.length > 0) {
    throw new Error(`Candidate cannot live-write — blockers: ${blockers.join(",")}`);
  }
}
