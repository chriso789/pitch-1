// Blueprint Importer v2 — Phase 7.6a catalog binding contracts.
// Pure type + helper module. Side-effect-free. No DB, no IO, no estimate writes.
// Phase 7.6a ships SHAPE ONLY — these helpers are NOT yet invoked from runtime.
// No runtime resolver lives here.

import type { TradeId } from "./trade-catalog.ts";
import { isFutureSupportedTrade, isMeasurementObjectOnlyTrade } from "./trade-catalog.ts";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type BlueprintCatalogBindingScope =
  | "tenant"
  | "template"
  | "trade"
  | "global_fallback_disabled";

export type BlueprintCatalogBindingType =
  | "material"
  | "labor"
  | "accessory"
  | "allowance";

export type BlueprintCatalogSourceCandidateType = "material" | "labor";

export type BlueprintCatalogTargetKind =
  | "product_catalog"
  | "supplier_catalog_item"
  | "abc_catalog_item"
  | "labor_rate"
  | "custom_line_disabled"
  | "unresolved";

export type BlueprintCatalogTargetTable =
  | "product_catalog"
  | "supplier_catalog_items"
  | "abc_catalog_items"
  | "labor_rates";

export type BlueprintCatalogBindingStatus =
  | "draft"
  | "active"
  | "inactive"
  | "superseded"
  | "blocked"
  | "needs_review";

export type BlueprintCatalogPricingSourceType =
  | "catalog_cost"
  | "labor_rate"
  | "manual_approved"
  | "unresolved"
  | "disabled";

export type BlueprintCatalogCostSourceType =
  | "catalog"
  | "labor_rate"
  | "fixed"
  | "unresolved"
  | "disabled";

export type BlueprintCatalogBindingEventType =
  | "created"
  | "status_changed"
  | "target_changed"
  | "pricing_changed"
  | "approved"
  | "superseded"
  | "deactivated"
  | "reactivated"
  | "blocked"
  | "note";

// Resolver v2 (contract only, no runtime here)
export type BlueprintResolverV2Status =
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "inactive_binding"
  | "inactive_target"
  | "unit_mismatch"
  | "tenant_scope_mismatch"
  | "missing_labor_rate"
  | "blocked";

export type BlueprintResolverV2BlockerCode =
  | "BLUEPRINT_CATALOG_BINDING_MISSING"
  | "BLUEPRINT_CATALOG_BINDING_AMBIGUOUS"
  | "BLUEPRINT_CATALOG_BINDING_INACTIVE"
  | "BLUEPRINT_CATALOG_TARGET_INACTIVE"
  | "BLUEPRINT_CATALOG_UNIT_MISMATCH"
  | "BLUEPRINT_LABOR_RATE_MISSING"
  | "BLUEPRINT_LABOR_RATE_INACTIVE"
  | "TENANT_COMPANY_SCOPE_UNRESOLVED"
  | "CATALOG_UNRESOLVED_LIVE_HANDOFF"
  | "CUSTOM_LINE_MODE_NOT_APPROVED";

export type BlueprintResolverV2WarningCode =
  | "BLUEPRINT_CATALOG_BINDING_NEEDS_REVIEW"
  | "BLUEPRINT_CATALOG_BINDING_LOW_CONFIDENCE"
  | "BLUEPRINT_CATALOG_BINDING_EFFECTIVE_DATE_NEAR_EXPIRY"
  | "BLUEPRINT_CATALOG_TARGET_UNIT_REQUIRES_CONVERSION";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlueprintCatalogBinding {
  id: string;
  tenant_id: string;
  binding_scope: BlueprintCatalogBindingScope;
  binding_type: BlueprintCatalogBindingType;
  trade_id: TradeId | string;
  source_candidate_type: BlueprintCatalogSourceCandidateType;
  source_item_key: string;
  source_item_name?: string | null;
  source_template_key?: string | null;
  source_template_version?: string | null;
  source_formula_key?: string | null;
  source_unit: string;
  target_kind: BlueprintCatalogTargetKind;
  target_table?: BlueprintCatalogTargetTable | null;
  target_item_id?: string | null;
  target_abc_item_number?: string | null;
  target_unit?: string | null;
  unit_conversion_rule: Record<string, unknown>;
  pricing_source_type: BlueprintCatalogPricingSourceType;
  cost_source_type: BlueprintCatalogCostSourceType;
  unit_cost?: number | null;
  labor_rate_id?: string | null;
  markup_rule_id?: string | null;
  tax_rule_id?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  status: BlueprintCatalogBindingStatus;
  resolver_priority: number;
  match_confidence: number;
  requires_user_confirmation: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  deterministic_binding_key: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface BlueprintCatalogBindingEvent {
  id: string;
  tenant_id: string;
  binding_id: string;
  event_type: BlueprintCatalogBindingEventType;
  previous_status?: BlueprintCatalogBindingStatus | null;
  next_status?: BlueprintCatalogBindingStatus | null;
  changed_by?: string | null;
  reason?: string | null;
  metadata: Record<string, unknown>;
  created_at?: string;
}

export interface BlueprintResolverV2Result {
  resolver_version: "v2.0-contract";
  tenant_id: string;
  source_candidate_id: string;
  trade_id: string;
  source_item_key: string;
  source_candidate_type: BlueprintCatalogSourceCandidateType;
  source_unit: string;
  status: BlueprintResolverV2Status;
  matched_binding_id: string | null;
  matched_target_kind: BlueprintCatalogTargetKind | null;
  matched_target_table: BlueprintCatalogTargetTable | null;
  matched_target_item_id: string | null;
  matched_labor_rate_id: string | null;
  match_confidence: number;
  blockers: BlueprintResolverV2BlockerCode[];
  warnings: BlueprintResolverV2WarningCode[];
  provenance: {
    attempted_binding_ids: string[];
    rejected: Array<{ binding_id: string; reason: string }>;
    resolved_at: string | null;
  };
}

// ---------------------------------------------------------------------------
// Deterministic binding key
// ---------------------------------------------------------------------------

/**
 * Deterministic, stable string key for a binding row. Same inputs → same key.
 * Differs whenever target/source/unit changes.
 */
export function createDeterministicBindingKey(input: {
  tenant_id: string;
  trade_id: string;
  source_candidate_type: BlueprintCatalogSourceCandidateType;
  source_item_key: string;
  source_template_key?: string | null;
  source_template_version?: string | null;
  source_unit: string;
  target_kind: BlueprintCatalogTargetKind;
  target_table?: BlueprintCatalogTargetTable | null;
  target_item_id?: string | null;
  target_abc_item_number?: string | null;
  target_unit?: string | null;
}): string {
  const parts = [
    "bpcb",
    input.tenant_id,
    input.trade_id,
    input.source_candidate_type,
    input.source_item_key,
    input.source_template_key ?? "-",
    input.source_template_version ?? "-",
    input.source_unit,
    input.target_kind,
    input.target_table ?? "-",
    input.target_item_id ?? "-",
    input.target_abc_item_number ?? "-",
    input.target_unit ?? "-",
  ];
  return parts.join("|");
}

// ---------------------------------------------------------------------------
// Validators (pure, no IO)
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateBindingShape(b: Partial<BlueprintCatalogBinding>): ValidationResult {
  const errors: string[] = [];
  if (!b.tenant_id || !UUID_RE.test(b.tenant_id)) errors.push("tenant_id_required_uuid");
  if (!b.trade_id) errors.push("trade_id_required");
  if (!b.source_item_key) errors.push("source_item_key_required");
  if (!b.source_candidate_type) errors.push("source_candidate_type_required");
  if (!b.source_unit) errors.push("source_unit_required");
  if (!b.target_kind) errors.push("target_kind_required");
  if (!b.deterministic_binding_key) errors.push("deterministic_binding_key_required");
  if (b.match_confidence !== undefined && (b.match_confidence < 0 || b.match_confidence > 1)) {
    errors.push("match_confidence_out_of_range");
  }
  if (b.trade_id === "windows_doors") errors.push("windows_doors_cannot_be_standalone_binding");
  return { ok: errors.length === 0, errors };
}

export function validateBindingTenantScope(
  b: Pick<BlueprintCatalogBinding, "tenant_id">,
  resolvedTenantId: string,
): ValidationResult {
  if (!resolvedTenantId || !UUID_RE.test(resolvedTenantId)) {
    return { ok: false, errors: ["resolved_tenant_id_invalid"] };
  }
  if (b.tenant_id !== resolvedTenantId) {
    return { ok: false, errors: ["tenant_scope_mismatch"] };
  }
  return { ok: true, errors: [] };
}

export function validateBindingTradeAllowed(
  b: Pick<BlueprintCatalogBinding, "trade_id" | "status">,
): ValidationResult {
  const errors: string[] = [];
  if (b.trade_id === "windows_doors" || isMeasurementObjectOnlyTrade(b.trade_id as TradeId)) {
    errors.push("trade_is_measurement_object_only");
  }
  if (isFutureSupportedTrade(b.trade_id as TradeId) && b.status === "active") {
    errors.push("future_supported_trade_cannot_be_active_binding");
  }
  return { ok: errors.length === 0, errors };
}

export function validateBindingUnitCompatibility(
  b: Pick<BlueprintCatalogBinding, "source_unit" | "target_unit" | "unit_conversion_rule">,
): ValidationResult {
  if (!b.target_unit) {
    // unresolved/disabled targets may omit unit
    return { ok: true, errors: [] };
  }
  if (b.source_unit === b.target_unit) return { ok: true, errors: [] };
  const rule = b.unit_conversion_rule ?? {};
  if (Object.keys(rule).length === 0) {
    return { ok: false, errors: ["unit_mismatch_no_conversion_rule"] };
  }
  return { ok: true, errors: [] };
}

export function validateBindingActiveForResolver(
  b: Pick<
    BlueprintCatalogBinding,
    | "status"
    | "target_kind"
    | "target_item_id"
    | "target_abc_item_number"
    | "labor_rate_id"
    | "source_candidate_type"
    | "pricing_source_type"
    | "cost_source_type"
  >,
): ValidationResult {
  const errors: string[] = [];
  if (b.status !== "active") errors.push("binding_not_active");
  if (b.target_kind === "unresolved") errors.push("target_kind_unresolved");
  if (b.target_kind === "custom_line_disabled") errors.push("custom_line_disabled_target");
  if (b.source_candidate_type === "material") {
    if (
      b.target_kind !== "abc_catalog_item" &&
      !b.target_item_id &&
      b.target_kind !== "custom_line_disabled" &&
      b.target_kind !== "unresolved"
    ) {
      errors.push("material_binding_requires_target_item_id");
    }
    if (b.target_kind === "abc_catalog_item" && !b.target_abc_item_number) {
      errors.push("abc_binding_requires_target_abc_item_number");
    }
  }
  if (b.source_candidate_type === "labor") {
    if (!b.labor_rate_id) errors.push("labor_binding_requires_labor_rate_id");
  }
  if (b.pricing_source_type === "unresolved") errors.push("pricing_source_unresolved");
  if (b.cost_source_type === "unresolved") errors.push("cost_source_unresolved");
  return { ok: errors.length === 0, errors };
}

export function summarizeBindingTarget(b: BlueprintCatalogBinding): string {
  if (b.target_kind === "unresolved") return "unresolved";
  if (b.target_kind === "custom_line_disabled") return "custom_line_disabled";
  if (b.target_kind === "abc_catalog_item") return `abc:${b.target_abc_item_number ?? "?"}`;
  if (b.target_kind === "labor_rate") return `labor_rate:${b.labor_rate_id ?? "?"}`;
  return `${b.target_kind}:${b.target_item_id ?? "?"}`;
}

/**
 * Contract-only assertion that a binding CAN resolve a candidate.
 * Does NOT perform DB lookups, does NOT mutate anything.
 */
export function assertBindingCanResolveCandidate(
  binding: BlueprintCatalogBinding,
  candidate: {
    tenant_id: string;
    trade_id: string;
    source_item_key: string;
    source_candidate_type: BlueprintCatalogSourceCandidateType;
    source_unit: string;
    source_template_key?: string | null;
    source_template_version?: string | null;
  },
): { ok: boolean; blockers: BlueprintResolverV2BlockerCode[] } {
  const blockers: BlueprintResolverV2BlockerCode[] = [];
  if (binding.tenant_id !== candidate.tenant_id) blockers.push("TENANT_COMPANY_SCOPE_UNRESOLVED");
  if (binding.trade_id !== candidate.trade_id) blockers.push("BLUEPRINT_CATALOG_BINDING_MISSING");
  if (binding.source_item_key !== candidate.source_item_key) {
    blockers.push("BLUEPRINT_CATALOG_BINDING_MISSING");
  }
  if (binding.source_candidate_type !== candidate.source_candidate_type) {
    blockers.push("BLUEPRINT_CATALOG_BINDING_MISSING");
  }
  if (
    candidate.source_template_key &&
    binding.source_template_key &&
    binding.source_template_key !== candidate.source_template_key
  ) {
    blockers.push("BLUEPRINT_CATALOG_BINDING_MISSING");
  }
  const active = validateBindingActiveForResolver(binding);
  if (!active.ok) blockers.push("BLUEPRINT_CATALOG_BINDING_INACTIVE");
  const unit = validateBindingUnitCompatibility({
    source_unit: candidate.source_unit,
    target_unit: binding.target_unit,
    unit_conversion_rule: binding.unit_conversion_rule,
  });
  if (!unit.ok) blockers.push("BLUEPRINT_CATALOG_UNIT_MISMATCH");
  if (candidate.source_candidate_type === "labor" && !binding.labor_rate_id) {
    blockers.push("BLUEPRINT_LABOR_RATE_MISSING");
  }
  return { ok: blockers.length === 0, blockers: Array.from(new Set(blockers)) };
}
