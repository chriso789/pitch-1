// Blueprint Importer v2 — Phase 6 handoff preview builder.
// Pure module. No DB, no IO except crypto.subtle for deterministic keys.
// Consumes Phase 3/4 rows + accepted trades + review flags and produces
// candidate rows ready to upsert into blueprint_estimate_line_candidates,
// plus a batch status verdict. NEVER writes to enhanced_estimates /
// estimate_line_items / proposal_tier_items.

import {
  createDeterministicBatchKey,
  createDeterministicHandoffKey,
  summarizeCandidateProvenance,
  validateCandidateCatalogGate,
  type BlueprintEstimateLineCandidate,
  type CanonicalEstimateTarget,
  type CatalogHandoffMode,
  type CatalogResolutionStatus,
  type CostStatus,
  type CustomLineMode,
  type EstimateLineCandidateStatus,
  type HandoffBatchStatus,
  type HandoffBlockerCode,
  type HandoffWarningCode,
  type PricingMode,
  type PricingStatus,
  type SourceDraftLineType,
} from "./crm-handoff.ts";
import { isFutureSupportedTrade, isMeasurementObjectOnlyTrade, type TradeId } from "./trade-catalog.ts";
import { REVIEW_FLAG_CODES } from "./review-flag-codes.ts";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface Phase6AcceptedTrade {
  id: string;
  trade_id: string;
  user_assumptions?: Record<string, unknown> | null;
}

export interface Phase6DraftRow {
  id: string;
  accepted_trade_id: string;
  template_binding_id: string | null;
  item_key: string;
  item_name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit?: string | null;
  source_measurement_ids: string[];
  plan_path_ids: string[];
  formula_key?: string | null;
  formula_inputs?: Record<string, unknown> | null;
  catalog_resolution_status?: CatalogResolutionStatus | null;
  catalog_item_id?: string | null;
  status: string; // superseded => skip
  waste_percent?: number | null;
}

export interface Phase6ReviewFlag {
  id: string;
  flag_code: string;
  severity: string;
  blocking: boolean;
  resolved: boolean;
  related_entity_type: string;
  related_entity_id: string | null;
}

export interface Phase6PlanPath {
  id: string;
  source_document_id?: string | null;
}

export interface Phase6TemplateBinding {
  id: string;
  accepted_trade_id: string;
  template_version?: string | null;
  binding_status?: string | null;
  user_assumptions?: Record<string, unknown> | null;
}

export type Phase6DraftModeFilter = "material" | "labor" | "both";

export interface BuildHandoffPreviewInput {
  tenant_id: string;
  import_session_id: string;
  handoff_batch_id: string;
  accepted_trades: Phase6AcceptedTrade[];
  template_bindings: Phase6TemplateBinding[];
  material_drafts: Phase6DraftRow[];
  labor_drafts: Phase6DraftRow[];
  plan_paths: Phase6PlanPath[];
  review_flags: Phase6ReviewFlag[];
  allowed_accepted_trade_ids?: string[] | null;
  draft_mode: Phase6DraftModeFilter;
  catalog_mode: CatalogHandoffMode;
  custom_line_mode: CustomLineMode;
  pricing_mode: PricingMode;
  paint_source_present: boolean;
}

export interface CandidateInsertRow extends Omit<BlueprintEstimateLineCandidate, "id"> {
  // server fills id; this is the upsert payload
}

export interface SkippedDraft {
  draft_id: string;
  draft_type: SourceDraftLineType;
  trade_id: string;
  reasons: HandoffBlockerCode[];
}

export interface BuildHandoffPreviewResult {
  candidates: CandidateInsertRow[];
  skipped: SkippedDraft[];
  batch_status: HandoffBatchStatus;
  blocker_summary: Record<string, number>;
  warning_summary: Record<string, number>;
  total_candidates: number;
  candidates_handoff_allowed: number;
}

// ---------------------------------------------------------------------------
// Flag-code → handoff blocker/warning mapping
// ---------------------------------------------------------------------------

const REVIEW_FLAG_TO_BLOCKER: Record<string, HandoffBlockerCode> = {
  [REVIEW_FLAG_CODES.MISSING_PLAN_PATH]: "MISSING_PLAN_PATH",
  [REVIEW_FLAG_CODES.MISSING_REQUIRED_MEASUREMENT]: "MISSING_SOURCE_MEASUREMENT_IDS",
  [REVIEW_FLAG_CODES.WINDOWS_DOORS_SELECTED_AS_TRADE]: "WINDOWS_DOORS_STANDALONE_TRADE",
  [REVIEW_FLAG_CODES.PAINT_WITHOUT_WALL_SOURCE]: "PAINT_WITHOUT_SIDING_SOURCE",
  [REVIEW_FLAG_CODES.UNSUPPORTED_TRADE_FOR_MVP]: "UNSUPPORTED_TRADE",
  [REVIEW_FLAG_CODES.FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE]: "FUTURE_SUPPORTED_TRADE",
  [REVIEW_FLAG_CODES.TEMPLATE_REQUIRED_ASSUMPTION_MISSING]: "MISSING_REQUIRED_ASSUMPTION",
  [REVIEW_FLAG_CODES.WASTE_PERCENT_REQUIRED]: "MISSING_REQUIRED_ASSUMPTION",
  [REVIEW_FLAG_CODES.FORMULA_INPUT_MISSING]: "MISSING_REQUIRED_ASSUMPTION",
  [REVIEW_FLAG_CODES.PRODUCT_SELECTION_REQUIRED]: "MISSING_REQUIRED_ASSUMPTION",
};

const REVIEW_FLAG_TO_WARNING: Record<string, HandoffWarningCode> = {
  [REVIEW_FLAG_CODES.REPORT_FIELD_VERIFICATION_REQUIRED]: "ROOF_PENETRATION_FIELD_VERIFY",
  [REVIEW_FLAG_CODES.WALL_IMAGE_OBSTRUCTION_WARNING]: "WALL_IMAGE_OBSTRUCTION",
  [REVIEW_FLAG_CODES.WALL_SOFFIT_ASSUMPTION_WARNING]: "WALL_SOFFIT_ASSUMPTION",
  [REVIEW_FLAG_CODES.ROOF_PENETRATION_FIELD_VERIFICATION_REQUIRED]: "ROOF_PENETRATION_FIELD_VERIFY",
  [REVIEW_FLAG_CODES.CATALOG_ITEM_UNRESOLVED]: "CATALOG_RESOLVED_COST_MISSING",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function pickPlanPathSourceDocs(planPathIds: string[], planPaths: Phase6PlanPath[]): string[] {
  const byId = new Map(planPaths.map((p) => [p.id, p] as const));
  const out: string[] = [];
  for (const id of planPathIds) {
    const pp = byId.get(id);
    if (pp?.source_document_id) out.push(pp.source_document_id);
  }
  return dedupe(out);
}

function flagsForDraft(
  draftId: string,
  draftType: SourceDraftLineType,
  acceptedTradeId: string,
  bindingId: string | null,
  flags: Phase6ReviewFlag[],
): { blockerIds: string[]; warningIds: string[]; blockerCodes: HandoffBlockerCode[]; warningCodes: HandoffWarningCode[] } {
  const relevant = flags.filter((f) => {
    if (f.resolved) return false;
    if (f.related_entity_type === "material_draft_line" && draftType === "material" && f.related_entity_id === draftId) return true;
    if (f.related_entity_type === "labor_draft_line" && draftType === "labor" && f.related_entity_id === draftId) return true;
    if (f.related_entity_type === "accepted_trade" && f.related_entity_id === acceptedTradeId) return true;
    if (f.related_entity_type === "template_binding" && bindingId && f.related_entity_id === bindingId) return true;
    return false;
  });
  const blockerIds: string[] = [];
  const warningIds: string[] = [];
  const blockerCodes = new Set<HandoffBlockerCode>();
  const warningCodes = new Set<HandoffWarningCode>();
  for (const f of relevant) {
    if (f.blocking) {
      blockerIds.push(f.id);
      const mapped = REVIEW_FLAG_TO_BLOCKER[f.flag_code];
      if (mapped) blockerCodes.add(mapped);
    } else {
      warningIds.push(f.id);
      const mapped = REVIEW_FLAG_TO_WARNING[f.flag_code];
      if (mapped) warningCodes.add(mapped);
    }
  }
  return {
    blockerIds: dedupe(blockerIds),
    warningIds: dedupe(warningIds),
    blockerCodes: Array.from(blockerCodes),
    warningCodes: Array.from(warningCodes),
  };
}

function derivePricingStatus(
  catalogStatus: CatalogResolutionStatus,
  draftType: SourceDraftLineType,
  pricingMode: PricingMode,
): { pricing_status: PricingStatus; cost_status: CostStatus } {
  if (draftType === "labor") {
    return { pricing_status: "labor_rate_missing", cost_status: "unavailable" };
  }
  if (catalogStatus === "matched" || catalogStatus === "manual_override") {
    return { pricing_status: pricingMode === "ready_for_pricing_review" ? "ready_for_pricing_review" : "catalog_resolved_cost_missing", cost_status: "available_from_catalog" };
  }
  return { pricing_status: "quantity_only", cost_status: "not_attempted" };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildHandoffPreview(input: BuildHandoffPreviewInput): Promise<BuildHandoffPreviewResult> {
  const acceptedById = new Map(input.accepted_trades.map((a) => [a.id, a] as const));
  const bindingByAccepted = new Map(input.template_bindings.map((b) => [b.accepted_trade_id, b] as const));

  const allowedIds = input.allowed_accepted_trade_ids
    ? new Set(input.allowed_accepted_trade_ids)
    : null;

  const candidates: CandidateInsertRow[] = [];
  const skipped: SkippedDraft[] = [];
  const blockerSummary: Record<string, number> = {};
  const warningSummary: Record<string, number> = {};
  let candidatesHandoffAllowed = 0;

  const drafts: Array<{ row: Phase6DraftRow; type: SourceDraftLineType }> = [];
  if (input.draft_mode === "material" || input.draft_mode === "both") {
    for (const r of input.material_drafts) drafts.push({ row: r, type: "material" });
  }
  if (input.draft_mode === "labor" || input.draft_mode === "both") {
    for (const r of input.labor_drafts) drafts.push({ row: r, type: "labor" });
  }

  for (const { row, type } of drafts) {
    if (row.status === "superseded") continue;
    const accepted = acceptedById.get(row.accepted_trade_id);
    if (!accepted) {
      skipped.push({ draft_id: row.id, draft_type: type, trade_id: "unknown", reasons: ["MISSING_ACCEPTED_TRADE_ID"] });
      continue;
    }
    if (allowedIds && !allowedIds.has(accepted.id)) continue;

    const tradeId = accepted.trade_id as TradeId;

    // Hard skips — cannot persist due to DB CHECK or contract.
    const hardSkipReasons: HandoffBlockerCode[] = [];
    if (tradeId === ("windows_doors" as TradeId) || isMeasurementObjectOnlyTrade(tradeId)) {
      hardSkipReasons.push("WINDOWS_DOORS_STANDALONE_TRADE");
    }
    if (isFutureSupportedTrade(tradeId)) {
      hardSkipReasons.push("FUTURE_SUPPORTED_TRADE");
    }
    if (!Array.isArray(row.plan_path_ids) || row.plan_path_ids.length === 0) {
      hardSkipReasons.push("MISSING_PLAN_PATH");
    }
    if (!Array.isArray(row.source_measurement_ids) || row.source_measurement_ids.length === 0) {
      hardSkipReasons.push("MISSING_SOURCE_MEASUREMENT_IDS");
    }
    if (hardSkipReasons.length > 0) {
      skipped.push({ draft_id: row.id, draft_type: type, trade_id: tradeId, reasons: hardSkipReasons });
      for (const r of hardSkipReasons) blockerSummary[r] = (blockerSummary[r] ?? 0) + 1;
      continue;
    }

    // Paint-specific gate
    const paintBlocker: HandoffBlockerCode[] = [];
    if (tradeId === ("paint_coatings" as TradeId) && !input.paint_source_present) {
      paintBlocker.push("PAINT_WITHOUT_SIDING_SOURCE");
    }

    const binding = bindingByAccepted.get(row.accepted_trade_id) ?? null;
    const { blockerIds, warningIds, blockerCodes: flagBlockers, warningCodes: flagWarnings } =
      flagsForDraft(row.id, type, accepted.id, binding?.id ?? null, input.review_flags);

    const catalogStatus = (row.catalog_resolution_status ?? "unresolved") as CatalogResolutionStatus;
    const catalogBlockers = validateCandidateCatalogGate(
      { catalog_resolution_status: catalogStatus },
      input.catalog_mode,
      false,
    );

    const qtyBlockers: HandoffBlockerCode[] = [];
    if (row.quantity == null || Number.isNaN(Number(row.quantity))) qtyBlockers.push("MISSING_QUANTITY");
    if (!row.unit) qtyBlockers.push("MISSING_UNIT");

    const stalenessBlockers: HandoffBlockerCode[] = [];
    if (row.status !== "ready" && row.status !== "draft") {
      // blocked drafts surface but cannot be handoff-allowed
      stalenessBlockers.push("DRAFT_ROW_SUPERSEDED");
    }

    const allBlockers = dedupe<HandoffBlockerCode>([
      ...paintBlocker,
      ...flagBlockers,
      ...catalogBlockers,
      ...qtyBlockers,
      ...stalenessBlockers,
    ]);

    for (const b of allBlockers) blockerSummary[b] = (blockerSummary[b] ?? 0) + 1;
    for (const w of flagWarnings) warningSummary[w] = (warningSummary[w] ?? 0) + 1;

    const handoffAllowed = allBlockers.length === 0;
    if (handoffAllowed) candidatesHandoffAllowed += 1;

    const sourceDocIds = pickPlanPathSourceDocs(row.plan_path_ids, input.plan_paths);

    const userAssumptions: Record<string, unknown> = {
      ...(accepted.user_assumptions ?? {}),
      ...(binding?.user_assumptions ?? {}),
    };

    const deterministic_handoff_key = await createDeterministicHandoffKey({
      tenant_id: input.tenant_id,
      import_session_id: input.import_session_id,
      accepted_trade_id: accepted.id,
      template_binding_id: binding?.id ?? row.template_binding_id ?? null,
      source_draft_line_id: row.id,
      source_draft_line_type: type,
      formula_key: row.formula_key ?? null,
      quantity: row.quantity ?? null,
      unit: row.unit ?? null,
      source_measurement_ids: row.source_measurement_ids,
      plan_path_ids: row.plan_path_ids,
      template_version: binding?.template_version ?? null,
      user_assumptions: userAssumptions,
    });

    const { pricing_status, cost_status } = derivePricingStatus(catalogStatus, type, input.pricing_mode);

    const status: EstimateLineCandidateStatus = handoffAllowed
      ? (flagWarnings.length > 0 ? "user_review_required" : "preview")
      : "blocked";

    const provenance_summary = summarizeCandidateProvenance({
      source_document_ids: sourceDocIds,
      plan_path_ids: row.plan_path_ids,
      source_measurement_ids: row.source_measurement_ids,
      formula_key: row.formula_key ?? null,
      source_draft_line_id: row.id,
      source_draft_line_type: type,
      template_binding_id: binding?.id ?? row.template_binding_id ?? null,
      accepted_trade_id: accepted.id,
    }) as unknown as Record<string, unknown>;

    candidates.push({
      tenant_id: input.tenant_id,
      handoff_batch_id: input.handoff_batch_id,
      import_session_id: input.import_session_id,
      accepted_trade_id: accepted.id,
      template_binding_id: binding?.id ?? row.template_binding_id ?? null,
      source_draft_line_id: row.id,
      source_draft_line_type: type,
      trade_id: tradeId,
      item_key: row.item_key,
      item_name: row.item_name ?? null,
      description: row.description ?? null,
      quantity: row.quantity ?? null,
      unit: row.unit ?? null,
      source_measurement_ids: row.source_measurement_ids,
      plan_path_ids: row.plan_path_ids,
      source_document_ids: sourceDocIds,
      formula_key: row.formula_key ?? null,
      formula_inputs: (row.formula_inputs ?? {}) as Record<string, unknown>,
      catalog_resolution_status: catalogStatus,
      catalog_item_id: row.catalog_item_id ?? null,
      pricing_status,
      cost_status,
      user_review_status: "pending",
      handoff_allowed: handoffAllowed,
      handoff_blockers: allBlockers,
      blocking_review_flag_ids: blockerIds,
      warning_review_flag_ids: warningIds,
      deterministic_handoff_key,
      provenance_summary,
      metadata: {
        phase: 6,
        live_handoff_not_enabled_phase_6: true,
        custom_line_mode_not_enabled_phase_6: input.custom_line_mode === "disabled",
        warning_codes: flagWarnings,
      },
      status,
    });
  }

  // Batch status verdict.
  const anyBlocked = candidates.some((c) => !c.handoff_allowed) || skipped.length > 0;
  const batchStatus: HandoffBatchStatus = candidates.length === 0
    ? "preview_created"
    : (anyBlocked ? "user_review_required" : "preview_created");

  return {
    candidates,
    skipped,
    batch_status: batchStatus,
    blocker_summary: blockerSummary,
    warning_summary: warningSummary,
    total_candidates: candidates.length,
    candidates_handoff_allowed: candidatesHandoffAllowed,
  };
}

// ---------------------------------------------------------------------------
// Batch key helper (re-exported convenience)
// ---------------------------------------------------------------------------

export interface BuildBatchKeyInput {
  tenant_id: string;
  import_session_id: string;
  target_context_type: string;
  target_context_id?: string | null;
  canonical_estimate_target_id?: string | null;
  pricing_mode: PricingMode;
  catalog_mode: CatalogHandoffMode;
  custom_line_mode: CustomLineMode;
  source_draft_hash?: string | null;
  canonical_estimate_target_table?: CanonicalEstimateTarget;
}

export async function buildHandoffBatchKey(inputs: BuildBatchKeyInput): Promise<string> {
  return await createDeterministicBatchKey({
    tenant_id: inputs.tenant_id,
    import_session_id: inputs.import_session_id,
    target_context_type: inputs.target_context_type,
    target_context_id: inputs.target_context_id ?? null,
    canonical_estimate_target_table: inputs.canonical_estimate_target_table ?? "enhanced_estimates",
    canonical_estimate_target_id: inputs.canonical_estimate_target_id ?? null,
    pricing_mode: inputs.pricing_mode,
    catalog_mode: inputs.catalog_mode,
    custom_line_mode: inputs.custom_line_mode,
    source_draft_hash: inputs.source_draft_hash ?? null,
  });
}

// ---------------------------------------------------------------------------
// Disabled-action message constants — used by UI to stay aligned with contract.
// ---------------------------------------------------------------------------

export const PHASE_6_DISABLED_MESSAGES = {
  push_to_estimate: "Push to Estimate is disabled until Phase 7 live handoff is approved.",
  final_pricing: "Final pricing is disabled in Phase 6.",
  catalog_mapping: "Catalog mapping is disabled in Phase 6.",
  custom_line: "Custom non-catalog line approval is disabled in Phase 6.",
  proposal_writes: "Proposal / work order / purchase order writes are disabled in Phase 6.",
} as const;
