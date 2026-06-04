// Blueprint Importer v2 — Phase 7.6c pricing preflight (preview-only).
//
// HARD GUARANTEES:
//  - No DB IO inside this module (caller fetches; we operate on plain values).
//  - No customer-facing pricing math (no markup, tax, discount, totals).
//  - No catalog/labor table mutation.
//  - No promotion of `handoff_allowed` to true.
//  - Quantity-only handoff is unconditionally blocked (estimate_line_items
//    pricing columns are NOT NULL DEFAULT 0; silent zero is unsafe).
//  - Computes preview-only extended_cost ONLY when an explicit positive
//    unit_cost / labor_rate is present from a trusted source.
//  - Zero-default pricing is rejected unless binding explicitly approves it.

import type {
  BlueprintCatalogBinding,
  BlueprintCatalogTargetKind,
} from "./catalog-bindings.ts";
import type { ResolverV2RuntimeResult } from "./phase7_6b-resolver.ts";

export const PHASE_7_6C_PREFLIGHT_VERSION = "v2.0-preflight-phase-7.6c" as const;

// ---------------------------------------------------------------------------
// Status / blocker / warning vocabularies
// ---------------------------------------------------------------------------

export type CandidatePricingStatus =
  | "blocked_quantity_only_unsafe"
  | "cost_unresolved"
  | "catalog_resolved_cost_missing"
  | "catalog_resolved_cost_available"
  | "labor_rate_missing"
  | "pricing_rule_missing"
  | "ready_for_pricing_review"
  | "blocked";

export type CandidateCostStatus =
  | "not_attempted"
  | "missing"
  | "zero_unsafe"
  | "explicit_positive"
  | "explicit_zero_approved"
  | "unit_mismatch"
  | "production_rate_required"
  | "tenant_mismatch"
  | "target_inactive"
  | "target_missing"
  | "target_active_unverifiable"
  | "out_of_scope";

export const PHASE_7_6C_BLOCKER_CODES = [
  "QUANTITY_ONLY_LIVE_LINES_UNSAFE",
  "ZERO_DEFAULT_PRICING_UNSAFE",
  "PRICING_CONTRACT_REQUIRED",
  "PRICING_REQUIRED_BUT_UNAVAILABLE",
  "MATERIAL_UNIT_COST_MISSING",
  "MATERIAL_UNIT_COST_ZERO_UNSAFE",
  "MATERIAL_PRICING_RULE_MISSING",
  "CATALOG_RESOLVED_COST_MISSING",
  "CATALOG_TARGET_MISSING",
  "CATALOG_TARGET_INACTIVE",
  "CATALOG_TARGET_TENANT_MISMATCH",
  "LABOR_RATE_MISSING",
  "LABOR_RATE_INACTIVE",
  "LABOR_RATE_TENANT_MISMATCH",
  "LABOR_RATE_UNIT_MISMATCH",
  "LABOR_PRODUCTION_RATE_REQUIRED",
  "LABOR_PRICING_RULE_MISSING",
  "LABOR_RATE_ZERO_UNSAFE",
  "UNIT_CONVERSION_REQUIRED",
  "UNIT_CONVERSION_INVALID",
  "MATERIAL_ITEM_MATCH_RULES_OUT_OF_SCOPE",
  "FINAL_PRICING_NOT_ENABLED_PHASE_7_6C",
  "LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6C",
] as const;
export type Phase7_6cBlockerCode = typeof PHASE_7_6C_BLOCKER_CODES[number];

export const PHASE_7_6C_WARNING_CODES = [
  "TARGET_ACTIVE_STATUS_NOT_VERIFIABLE",
  "PREVIEW_ONLY_COST_NOT_CUSTOMER_FACING",
  "BINDING_UNIT_CONVERSION_APPLIED",
] as const;
export type Phase7_6cWarningCode = typeof PHASE_7_6C_WARNING_CODES[number];

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface PreflightCandidateInput {
  id: string;
  tenant_id: string;
  handoff_batch_id: string;
  import_session_id: string;
  source_draft_line_id: string;
  source_draft_line_type: "material" | "labor";
  trade_id: string;
  item_key: string;
  quantity: number | null | undefined;
  unit: string | null | undefined;
  deterministic_handoff_key: string;
  /** Resolver v2 result persisted by Phase 7.6b. */
  resolver_result: ResolverV2RuntimeResult | null;
  /** Prior metadata blob (preserved verbatim except for keys we own). */
  metadata?: Record<string, unknown> | null;
}

/** Target row snapshot — caller fetches with .eq tenant filters where applicable. */
export interface TargetRowSnapshot {
  table: "product_catalog" | "supplier_catalog_items" | "abc_catalog_items" | "labor_rates";
  id: string | null;
  abc_item_number?: string | null;
  tenant_id: string | null;
  /** True if the table is tenant-scoped. abc_catalog_items is global. */
  tenant_scoped: boolean;
  is_active: boolean | null;
  /** True when this table has no active/status field at all. */
  active_status_verifiable: boolean;
  /** Explicit base cost from the row, if a contract-safe field exists. */
  base_unit_cost: number | null;
  /** Unit advertised by the row, if known (e.g. supplier uom, product price_per_square). */
  target_unit: string | null;
  /** Per-hour labor rate when table = labor_rates. */
  base_rate_per_hour: number | null;
}

export interface PreflightOptions {
  /** Pricing mode of the parent handoff batch. */
  pricing_mode: "quantity_only" | "ready_for_pricing_review" | string;
  pricing_contract_version: string;
  /** Stable timestamp injected by caller. */
  now: () => string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface PreflightPreviewCost {
  unit_cost: number | null;
  quantity: number | null;
  extended_cost: number | null;
  cost_source: "binding.unit_cost" | "target.base_unit_cost" | "labor_rate.base_rate_per_hour" | null;
  /** Always true — these values are preview-only, never customer-facing. */
  preview_only: true;
}

export interface PreflightCandidateResult {
  candidate_id: string;
  preflight_version: typeof PHASE_7_6C_PREFLIGHT_VERSION;
  pricing_mode: string;
  pricing_contract_version: string;
  cost_status: CandidateCostStatus;
  pricing_status: CandidatePricingStatus;
  target_validation: {
    target_kind: BlueprintCatalogTargetKind | null;
    target_present: boolean;
    tenant_safe: boolean;
    active: boolean | null;
    active_verifiable: boolean;
    unit_compatible: boolean;
    notes: string[];
  };
  preview_cost: PreflightPreviewCost;
  blockers: Phase7_6cBlockerCode[];
  warnings: Phase7_6cWarningCode[];
  /** Phase 7.6c never promotes to true. */
  handoff_allowed: false;
  evaluated_at: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function uniq<T>(xs: T[]): T[] { return Array.from(new Set(xs)); }

function tableForKind(kind: BlueprintCatalogTargetKind | null): TargetRowSnapshot["table"] | null {
  switch (kind) {
    case "product_catalog": return "product_catalog";
    case "supplier_catalog_item": return "supplier_catalog_items";
    case "abc_catalog_item": return "abc_catalog_items";
    case "labor_rate": return "labor_rates";
    default: return null;
  }
}

function pickTrustedUnitCost(
  binding: Pick<BlueprintCatalogBinding, "unit_cost" | "cost_source_type">,
  target: TargetRowSnapshot | null,
): { unit_cost: number | null; source: PreflightPreviewCost["cost_source"] } {
  // Binding-explicit positive unit_cost is the most trusted source.
  if (typeof binding.unit_cost === "number" && binding.unit_cost > 0) {
    return { unit_cost: binding.unit_cost, source: "binding.unit_cost" };
  }
  // Otherwise, only use target row cost when cost_source_type is contract-allowed.
  if (target && binding.cost_source_type === "catalog" && typeof target.base_unit_cost === "number" && target.base_unit_cost > 0) {
    return { unit_cost: target.base_unit_cost, source: "target.base_unit_cost" };
  }
  return { unit_cost: null, source: null };
}

// ---------------------------------------------------------------------------
// Pure preflight evaluator
// ---------------------------------------------------------------------------

export function evaluatePricingPreflight(
  cand: PreflightCandidateInput,
  binding: BlueprintCatalogBinding | null,
  target: TargetRowSnapshot | null,
  opts: PreflightOptions,
): PreflightCandidateResult {
  const now = opts.now();
  const blockers: Phase7_6cBlockerCode[] = [
    "FINAL_PRICING_NOT_ENABLED_PHASE_7_6C",
    "LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6C",
  ];
  const warnings: Phase7_6cWarningCode[] = ["PREVIEW_ONLY_COST_NOT_CUSTOMER_FACING"];
  const notes: string[] = [];

  const preview: PreflightPreviewCost = {
    unit_cost: null, quantity: cand.quantity ?? null,
    extended_cost: null, cost_source: null, preview_only: true,
  };

  const baseResult = (
    cost_status: CandidateCostStatus,
    pricing_status: CandidatePricingStatus,
    extra: { target_present?: boolean; tenant_safe?: boolean; active?: boolean | null; active_verifiable?: boolean; unit_compatible?: boolean } = {},
  ): PreflightCandidateResult => ({
    candidate_id: cand.id,
    preflight_version: PHASE_7_6C_PREFLIGHT_VERSION,
    pricing_mode: opts.pricing_mode,
    pricing_contract_version: opts.pricing_contract_version,
    cost_status,
    pricing_status,
    target_validation: {
      target_kind: binding?.target_kind ?? cand.resolver_result?.matched_target_kind ?? null,
      target_present: extra.target_present ?? false,
      tenant_safe: extra.tenant_safe ?? false,
      active: extra.active ?? null,
      active_verifiable: extra.active_verifiable ?? false,
      unit_compatible: extra.unit_compatible ?? false,
      notes,
    },
    preview_cost: preview,
    blockers: uniq(blockers),
    warnings: uniq(warnings),
    handoff_allowed: false,
    evaluated_at: now,
  });

  // 1. Quantity-only mode is unconditionally unsafe.
  if (opts.pricing_mode === "quantity_only") {
    blockers.push("QUANTITY_ONLY_LIVE_LINES_UNSAFE", "PRICING_REQUIRED_BUT_UNAVAILABLE");
    notes.push("pricing_mode=quantity_only is unsafe: estimate_line_items has NOT NULL DEFAULT 0 cost columns.");
    return baseResult("not_attempted", "blocked_quantity_only_unsafe");
  }

  // 2. Resolver must have resolved a binding.
  if (!cand.resolver_result || cand.resolver_result.status !== "resolved" || !binding) {
    blockers.push("PRICING_REQUIRED_BUT_UNAVAILABLE");
    notes.push("Resolver did not produce a resolved binding for this candidate.");
    return baseResult("not_attempted", "cost_unresolved");
  }

  // 3. Forbid material_item_match_rules as a target/source (out of scope this phase).
  const usesMatchRules =
    (binding.metadata && typeof binding.metadata === "object" &&
     (binding.metadata as Record<string, unknown>).source === "material_item_match_rules");
  if (usesMatchRules) {
    blockers.push("MATERIAL_ITEM_MATCH_RULES_OUT_OF_SCOPE");
    return baseResult("out_of_scope", "blocked");
  }

  // 4. Target-kind gating.
  if (binding.target_kind === "custom_line_disabled" || binding.target_kind === "unresolved") {
    blockers.push("PRICING_REQUIRED_BUT_UNAVAILABLE", "CATALOG_TARGET_MISSING");
    return baseResult("target_missing", "blocked");
  }

  // 5. Material vs labor branches.
  if (cand.source_draft_line_type === "material") {
    return evaluateMaterial(cand, binding, target, opts, blockers, warnings, notes, preview, baseResult);
  }
  return evaluateLabor(cand, binding, target, opts, blockers, warnings, notes, preview, baseResult);
}

function evaluateMaterial(
  cand: PreflightCandidateInput,
  binding: BlueprintCatalogBinding,
  target: TargetRowSnapshot | null,
  opts: PreflightOptions,
  blockers: Phase7_6cBlockerCode[],
  warnings: Phase7_6cWarningCode[],
  notes: string[],
  preview: PreflightPreviewCost,
  baseResult: (cs: CandidateCostStatus, ps: CandidatePricingStatus, extra?: any) => PreflightCandidateResult,
): PreflightCandidateResult {
  const expectedTable = tableForKind(binding.target_kind);
  const targetPresent = !!target && (!!target.id || !!target.abc_item_number);
  if (!targetPresent) {
    blockers.push("CATALOG_TARGET_MISSING");
    return baseResult("target_missing", "blocked", { target_present: false });
  }

  // Tenant safety: only enforce when table is tenant-scoped.
  let tenantSafe = true;
  if (target!.tenant_scoped) {
    if (target!.tenant_id !== cand.tenant_id) {
      blockers.push("CATALOG_TARGET_TENANT_MISMATCH");
      tenantSafe = false;
    }
  }

  // Active status.
  let active: boolean | null = null;
  let activeVerifiable = target!.active_status_verifiable;
  if (activeVerifiable) {
    active = target!.is_active === true;
    if (!active) {
      blockers.push("CATALOG_TARGET_INACTIVE");
    }
  } else {
    warnings.push("TARGET_ACTIVE_STATUS_NOT_VERIFIABLE");
    notes.push(`Target table ${expectedTable} has no verifiable active/status field.`);
  }

  // Unit compatibility.
  const candidateUnit = cand.unit ?? binding.source_unit;
  const targetUnit = binding.target_unit ?? target!.target_unit;
  const conversionRule = binding.unit_conversion_rule ?? {};
  let unitCompatible = true;
  if (targetUnit && candidateUnit !== targetUnit) {
    if (Object.keys(conversionRule).length === 0) {
      blockers.push("UNIT_CONVERSION_REQUIRED");
      unitCompatible = false;
    } else {
      warnings.push("BINDING_UNIT_CONVERSION_APPLIED");
    }
  }

  // Cost resolution. Detect explicit zero first to surface the zero-unsafe blocker.
  const zeroBinding = typeof binding.unit_cost === "number" && binding.unit_cost === 0;
  const zeroTarget = !!target && binding.cost_source_type === "catalog" &&
    typeof target.base_unit_cost === "number" && target.base_unit_cost === 0;
  if (zeroBinding || zeroTarget) {
    blockers.push("MATERIAL_UNIT_COST_ZERO_UNSAFE", "ZERO_DEFAULT_PRICING_UNSAFE");
    return baseResult("zero_unsafe", "blocked", {
      target_present: true, tenant_safe: tenantSafe, active, active_verifiable: activeVerifiable, unit_compatible: unitCompatible,
    });
  }
  const picked = pickTrustedUnitCost(binding, target);
  if (picked.unit_cost === null) {
    blockers.push("CATALOG_RESOLVED_COST_MISSING", "MATERIAL_UNIT_COST_MISSING");
    if (binding.pricing_source_type === "unresolved" || binding.pricing_source_type === "disabled") {
      blockers.push("MATERIAL_PRICING_RULE_MISSING");
    }
    return baseResult("missing", "catalog_resolved_cost_missing", {
      target_present: true, tenant_safe: tenantSafe, active, active_verifiable: activeVerifiable, unit_compatible: unitCompatible,
    });
  }

  // Bail on hard blockers (tenant/active/unit) before producing a preview cost.
  const hardBlocked =
    !tenantSafe || (activeVerifiable && active === false) || !unitCompatible;
  if (hardBlocked) {
    return baseResult("missing", "blocked", {
      target_present: true, tenant_safe: tenantSafe, active, active_verifiable: activeVerifiable, unit_compatible: unitCompatible,
    });
  }

  // Compute preview-only extended_cost.
  if (typeof cand.quantity === "number" && cand.quantity > 0) {
    preview.unit_cost = picked.unit_cost;
    preview.cost_source = picked.source;
    preview.extended_cost = Number((cand.quantity * picked.unit_cost).toFixed(4));
  } else {
    preview.unit_cost = picked.unit_cost;
    preview.cost_source = picked.source;
    preview.extended_cost = null;
  }

  return baseResult("explicit_positive", "ready_for_pricing_review", {
    target_present: true, tenant_safe: tenantSafe, active, active_verifiable: activeVerifiable, unit_compatible: unitCompatible,
  });
}

function evaluateLabor(
  cand: PreflightCandidateInput,
  binding: BlueprintCatalogBinding,
  target: TargetRowSnapshot | null,
  opts: PreflightOptions,
  blockers: Phase7_6cBlockerCode[],
  warnings: Phase7_6cWarningCode[],
  notes: string[],
  preview: PreflightPreviewCost,
  baseResult: (cs: CandidateCostStatus, ps: CandidatePricingStatus, extra?: any) => PreflightCandidateResult,
): PreflightCandidateResult {
  if (!binding.labor_rate_id) {
    blockers.push("LABOR_RATE_MISSING", "PRICING_REQUIRED_BUT_UNAVAILABLE");
    return baseResult("missing", "labor_rate_missing");
  }
  if (!target || !target.id) {
    blockers.push("LABOR_RATE_MISSING");
    return baseResult("target_missing", "labor_rate_missing");
  }
  // Tenant safety (labor_rates is tenant-scoped).
  let tenantSafe = true;
  if (target.tenant_scoped && target.tenant_id !== cand.tenant_id) {
    blockers.push("LABOR_RATE_TENANT_MISMATCH");
    tenantSafe = false;
  }
  // Active.
  const activeVerifiable = target.active_status_verifiable;
  const active = activeVerifiable ? target.is_active === true : null;
  if (activeVerifiable && active === false) blockers.push("LABOR_RATE_INACTIVE");
  if (!activeVerifiable) warnings.push("TARGET_ACTIVE_STATUS_NOT_VERIFIABLE");

  // Unit compatibility: labor_rates is per-hour ($/hr).
  const candidateUnit = (cand.unit ?? binding.source_unit ?? "").toLowerCase();
  const hourLike = candidateUnit === "hr" || candidateUnit === "hour" || candidateUnit === "hours";
  const conversionRule = binding.unit_conversion_rule ?? {};
  let unitCompatible = false;
  if (hourLike) {
    unitCompatible = true;
  } else if (Object.keys(conversionRule).length > 0 && (conversionRule as any).production_rate_per_hour) {
    unitCompatible = true;
    warnings.push("BINDING_UNIT_CONVERSION_APPLIED");
  } else {
    blockers.push("LABOR_PRODUCTION_RATE_REQUIRED", "LABOR_RATE_UNIT_MISMATCH");
  }

  // Pricing rule presence.
  if (binding.pricing_source_type === "unresolved" || binding.pricing_source_type === "disabled") {
    blockers.push("LABOR_PRICING_RULE_MISSING");
  }

  const rate = target.base_rate_per_hour;
  if (rate === null || rate === undefined) {
    blockers.push("LABOR_RATE_MISSING");
    return baseResult("missing", "labor_rate_missing", {
      target_present: true, tenant_safe: tenantSafe, active, active_verifiable: activeVerifiable, unit_compatible: unitCompatible,
    });
  }
  if (rate === 0) {
    blockers.push("LABOR_RATE_ZERO_UNSAFE", "ZERO_DEFAULT_PRICING_UNSAFE");
    return baseResult("zero_unsafe", "blocked", {
      target_present: true, tenant_safe: tenantSafe, active, active_verifiable: activeVerifiable, unit_compatible: unitCompatible,
    });
  }

  const hardBlocked = !tenantSafe || (activeVerifiable && active === false) || !unitCompatible;
  if (hardBlocked) {
    return baseResult("missing", "blocked", {
      target_present: true, tenant_safe: tenantSafe, active, active_verifiable: activeVerifiable, unit_compatible: unitCompatible,
    });
  }

  // Preview extended cost: hours = quantity if hourLike, else quantity / production_rate_per_hour.
  if (typeof cand.quantity === "number" && cand.quantity > 0) {
    let hours: number | null = null;
    if (hourLike) hours = cand.quantity;
    else {
      const rph = Number((conversionRule as any).production_rate_per_hour);
      if (Number.isFinite(rph) && rph > 0) hours = cand.quantity / rph;
    }
    if (hours !== null) {
      preview.unit_cost = rate;
      preview.cost_source = "labor_rate.base_rate_per_hour";
      preview.quantity = Number(hours.toFixed(4));
      preview.extended_cost = Number((hours * rate).toFixed(4));
    } else {
      preview.unit_cost = rate;
      preview.cost_source = "labor_rate.base_rate_per_hour";
    }
  } else {
    preview.unit_cost = rate;
    preview.cost_source = "labor_rate.base_rate_per_hour";
  }

  return baseResult("explicit_positive", "ready_for_pricing_review", {
    target_present: true, tenant_safe: tenantSafe, active, active_verifiable: activeVerifiable, unit_compatible: unitCompatible,
  });
}

// ---------------------------------------------------------------------------
// Candidate update payload
// ---------------------------------------------------------------------------

export interface PreflightCandidateUpdate {
  cost_status: CandidateCostStatus;
  pricing_status: CandidatePricingStatus;
  handoff_allowed: false;
  handoff_blockers: Phase7_6cBlockerCode[];
  status: string;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export function buildPreflightCandidateUpdate(
  cand: PreflightCandidateInput,
  result: PreflightCandidateResult,
  currentStatus: string | undefined,
): PreflightCandidateUpdate {
  const priorMeta = cand.metadata && typeof cand.metadata === "object"
    ? { ...(cand.metadata as Record<string, unknown>) } : {};
  const metadata: Record<string, unknown> = {
    ...priorMeta,
    pricing_preflight: result,
    pricing_contract_version: result.pricing_contract_version,
    preview_cost_summary: {
      unit_cost: result.preview_cost.unit_cost,
      quantity: result.preview_cost.quantity,
      extended_cost: result.preview_cost.extended_cost,
      cost_source: result.preview_cost.cost_source,
      preview_only: true,
    },
    target_validation: result.target_validation,
    final_pricing_not_enabled_phase_7_6c: true,
    live_handoff_not_enabled_phase_7_6c: true,
  };
  // Preserve terminal candidate statuses.
  let nextStatus = currentStatus ?? "blocked";
  if (currentStatus && ["live_written", "superseded", "cancelled", "failed"].includes(currentStatus)) {
    nextStatus = currentStatus;
  } else if (result.pricing_status === "ready_for_pricing_review") {
    nextStatus = "user_review_required";
  } else {
    nextStatus = "blocked";
  }
  return {
    cost_status: result.cost_status,
    pricing_status: result.pricing_status,
    handoff_allowed: false,
    handoff_blockers: result.blockers,
    status: nextStatus,
    metadata,
    updated_at: result.evaluated_at,
  };
}

// ---------------------------------------------------------------------------
// Review flag specs
// ---------------------------------------------------------------------------

export interface PreflightReviewFlagSpec {
  import_session_id: string;
  tenant_id: string;
  related_entity_type: "material_draft_line" | "labor_draft_line";
  related_entity_id: string;
  severity: "blocker" | "warning";
  flag_code: string;
  message: string;
  blocking: boolean;
  metadata: Record<string, unknown>;
}

const PREFLIGHT_FLAG_MESSAGES: Record<string, string> = {
  QUANTITY_ONLY_LIVE_LINES_UNSAFE:
    "pricing_mode=quantity_only is unsafe; estimate_line_items pricing columns are NOT NULL DEFAULT 0.",
  ZERO_DEFAULT_PRICING_UNSAFE: "Zero-default pricing is not accepted as valid pricing.",
  PRICING_CONTRACT_REQUIRED: "A pricing contract is required for live handoff.",
  PRICING_REQUIRED_BUT_UNAVAILABLE: "Pricing is required for live handoff but is not available.",
  MATERIAL_UNIT_COST_MISSING: "Material binding has no explicit positive unit cost.",
  MATERIAL_UNIT_COST_ZERO_UNSAFE: "Material unit cost is zero and not explicitly approved.",
  MATERIAL_PRICING_RULE_MISSING: "Material binding lacks a pricing rule (pricing_source_type=unresolved/disabled).",
  CATALOG_RESOLVED_COST_MISSING: "Resolved catalog target has no contract-safe cost field.",
  CATALOG_TARGET_MISSING: "Resolved binding's target row could not be found.",
  CATALOG_TARGET_INACTIVE: "Resolved binding's target row is inactive.",
  CATALOG_TARGET_TENANT_MISMATCH: "Resolved binding's target row belongs to another tenant.",
  LABOR_RATE_MISSING: "Labor binding has no labor_rate target row.",
  LABOR_RATE_INACTIVE: "Labor binding's labor_rate is inactive.",
  LABOR_RATE_TENANT_MISMATCH: "Labor binding's labor_rate belongs to another tenant.",
  LABOR_RATE_UNIT_MISMATCH: "Candidate unit is incompatible with labor_rates (per-hour).",
  LABOR_PRODUCTION_RATE_REQUIRED: "Labor binding requires an explicit production_rate_per_hour conversion rule.",
  LABOR_PRICING_RULE_MISSING: "Labor binding lacks a pricing rule (pricing_source_type=unresolved/disabled).",
  LABOR_RATE_ZERO_UNSAFE: "Labor rate is zero and not explicitly approved.",
  UNIT_CONVERSION_REQUIRED: "Source and target units differ and no unit_conversion_rule is set on the binding.",
  UNIT_CONVERSION_INVALID: "Binding's unit_conversion_rule is invalid.",
  MATERIAL_ITEM_MATCH_RULES_OUT_OF_SCOPE: "material_item_match_rules sources are out of scope in Phase 7.6c.",
  FINAL_PRICING_NOT_ENABLED_PHASE_7_6C: "Final customer-facing pricing is intentionally disabled in Phase 7.6c.",
  LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6C: "Live handoff (Push to Estimate) is intentionally disabled in Phase 7.6c.",
  TARGET_ACTIVE_STATUS_NOT_VERIFIABLE: "Target table has no verifiable active/status field; flag for review.",
  PREVIEW_ONLY_COST_NOT_CUSTOMER_FACING: "Preview cost is internal-only and not written to estimate_line_items.",
  BINDING_UNIT_CONVERSION_APPLIED: "Binding's unit_conversion_rule was applied for preview cost.",
};

const PREFLIGHT_BLOCKING_FLAGS = new Set<string>(PHASE_7_6C_BLOCKER_CODES as readonly string[]);

export function buildPreflightReviewFlagSpecs(
  cand: PreflightCandidateInput,
  result: PreflightCandidateResult,
): PreflightReviewFlagSpec[] {
  const related = cand.source_draft_line_type === "material" ? "material_draft_line" : "labor_draft_line";
  const baseMetadata = {
    source: "pricing_preflight_v2",
    preflight_version: PHASE_7_6C_PREFLIGHT_VERSION,
    line_candidate_id: cand.id,
    handoff_batch_id: cand.handoff_batch_id,
    deterministic_handoff_key: cand.deterministic_handoff_key,
    pricing_contract_version: result.pricing_contract_version,
  };
  const specs: PreflightReviewFlagSpec[] = [];
  const seen = new Set<string>();
  const push = (code: string, severity: "blocker" | "warning") => {
    if (seen.has(code)) return;
    seen.add(code);
    specs.push({
      import_session_id: cand.import_session_id,
      tenant_id: cand.tenant_id,
      related_entity_type: related as "material_draft_line" | "labor_draft_line",
      related_entity_id: cand.source_draft_line_id,
      severity, flag_code: code,
      message: PREFLIGHT_FLAG_MESSAGES[code] ?? code,
      blocking: severity === "blocker",
      metadata: baseMetadata,
    });
  };
  for (const b of result.blockers) push(b, PREFLIGHT_BLOCKING_FLAGS.has(b) ? "blocker" : "blocker");
  for (const w of result.warnings) push(w, "warning");
  return specs;
}

// ---------------------------------------------------------------------------
// Batch summary
// ---------------------------------------------------------------------------

export interface PreflightBatchSummary {
  total: number;
  ready_for_pricing_review: number;
  blocked: number;
  blocker_counts: Record<string, number>;
  warning_counts: Record<string, number>;
  pricing_status_counts: Record<string, number>;
  cost_status_counts: Record<string, number>;
  preview_cost_total: number | null;
  preview_only: true;
  push_to_estimate_enabled: false;
  push_to_estimate_disabled_reason: string;
  final_pricing_enabled: false;
  final_pricing_disabled_reason: string;
}

export function summarizePreflightResults(results: PreflightCandidateResult[]): PreflightBatchSummary {
  const blockerCounts: Record<string, number> = {};
  const warningCounts: Record<string, number> = {};
  const pricingStatus: Record<string, number> = {};
  const costStatus: Record<string, number> = {};
  let ready = 0, blocked = 0, sum = 0, anyCost = false;
  for (const r of results) {
    pricingStatus[r.pricing_status] = (pricingStatus[r.pricing_status] ?? 0) + 1;
    costStatus[r.cost_status] = (costStatus[r.cost_status] ?? 0) + 1;
    for (const b of r.blockers) blockerCounts[b] = (blockerCounts[b] ?? 0) + 1;
    for (const w of r.warnings) warningCounts[w] = (warningCounts[w] ?? 0) + 1;
    if (r.pricing_status === "ready_for_pricing_review") ready++;
    else blocked++;
    if (typeof r.preview_cost.extended_cost === "number") {
      sum += r.preview_cost.extended_cost; anyCost = true;
    }
  }
  return {
    total: results.length,
    ready_for_pricing_review: ready,
    blocked,
    blocker_counts: blockerCounts,
    warning_counts: warningCounts,
    pricing_status_counts: pricingStatus,
    cost_status_counts: costStatus,
    preview_cost_total: anyCost ? Number(sum.toFixed(4)) : null,
    preview_only: true,
    push_to_estimate_enabled: false,
    push_to_estimate_disabled_reason:
      "Push to Estimate remains disabled. Phase 7.6c only validates pricing readiness for preview candidates; live handoff and final customer pricing are not enabled.",
    final_pricing_enabled: false,
    final_pricing_disabled_reason:
      "Final customer-facing pricing is intentionally disabled in Phase 7.6c.",
  };
}
