// Blueprint Importer v2 — Phase 7.6b deterministic binding resolver (runtime).
//
// Pure, side-effect-free logic. Reads candidates + bindings, returns:
//   - per-candidate resolver v2 result
//   - candidate-update payloads (no IO here)
//   - review-flag specs (no IO here)
//
// HARD GUARANTEES:
//  - No DB IO inside this module — gluing happens in the document-worker route.
//  - No pricing, no margin/tax/discount math.
//  - No mutation of product_catalog / labor_rates / supplier_catalog_items /
//    abc_catalog_items / material_item_match_rules.
//  - No fuzzy / AI / first-row-wins matching — bindings only.
//  - `handoff_allowed` for every candidate stays false.
//  - `pricing_status` never moves to a "live-ready" value.

import {
  type BlueprintCatalogBinding,
  type BlueprintCatalogTargetKind,
  type BlueprintCatalogTargetTable,
  type BlueprintResolverV2BlockerCode,
  type BlueprintResolverV2Status,
  validateBindingActiveForResolver,
  validateBindingUnitCompatibility,
  summarizeBindingTarget,
} from "./catalog-bindings.ts";
import { isFutureSupportedTrade, isMeasurementObjectOnlyTrade, type TradeId } from "./trade-catalog.ts";

export const PHASE_7_6B_RESOLVER_VERSION = "v2.0-runtime-phase-7.6b" as const;

/** Phase 7.6b runtime warning codes (additive to the v2 contract warnings). */
export const PHASE_7_6B_RUNTIME_WARNING_CODES = {
  BINDING_REQUIRES_USER_CONFIRMATION: "BINDING_REQUIRES_USER_CONFIRMATION",
  BINDING_TARGET_TABLE_NOT_STRONGLY_FK_ENFORCED: "BINDING_TARGET_TABLE_NOT_STRONGLY_FK_ENFORCED",
  BINDING_USES_UNIT_CONVERSION: "BINDING_USES_UNIT_CONVERSION",
  BINDING_TARGET_COST_UNVERIFIED: "BINDING_TARGET_COST_UNVERIFIED",
  PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B: "PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B",
  LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6B: "LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6B",
} as const;

export type Phase7_6bWarningCode =
  | "BLUEPRINT_CATALOG_BINDING_NEEDS_REVIEW"
  | "BLUEPRINT_CATALOG_BINDING_LOW_CONFIDENCE"
  | "BLUEPRINT_CATALOG_BINDING_EFFECTIVE_DATE_NEAR_EXPIRY"
  | "BLUEPRINT_CATALOG_TARGET_UNIT_REQUIRES_CONVERSION"
  | keyof typeof PHASE_7_6B_RUNTIME_WARNING_CODES;

// ---------------------------------------------------------------------------
// Candidate descriptor (subset of blueprint_estimate_line_candidates row)
// ---------------------------------------------------------------------------

export interface ResolverCandidate {
  id: string;
  tenant_id: string;
  handoff_batch_id: string;
  import_session_id: string;
  trade_id: string;
  source_draft_line_id: string;
  source_draft_line_type: "material" | "labor";
  item_key: string;
  item_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  formula_key?: string | null;
  catalog_resolution_status?: string;
  catalog_item_id?: string | null;
  pricing_status?: string;
  cost_status?: string;
  user_review_status?: string;
  handoff_allowed?: boolean;
  handoff_blockers?: unknown;
  blocking_review_flag_ids?: string[] | null;
  warning_review_flag_ids?: string[] | null;
  deterministic_handoff_key: string;
  metadata?: Record<string, unknown> | null;
  status?: string;
  source_template_key?: string | null;
  source_template_version?: string | null;
}

// ---------------------------------------------------------------------------
// Per-candidate resolver result
// ---------------------------------------------------------------------------

export interface ResolverV2RuntimeResult {
  resolver_version: typeof PHASE_7_6B_RESOLVER_VERSION;
  tenant_id: string;
  source_candidate_id: string;
  trade_id: string;
  source_item_key: string;
  source_candidate_type: "material" | "labor";
  source_unit: string;
  status: BlueprintResolverV2Status;
  matched_binding_id: string | null;
  matched_target_kind: BlueprintCatalogTargetKind | null;
  matched_target_table: BlueprintCatalogTargetTable | null;
  matched_target_item_id: string | null;
  matched_target_abc_item_number: string | null;
  matched_labor_rate_id: string | null;
  matched_target_unit: string | null;
  uses_unit_conversion: boolean;
  requires_user_confirmation: boolean;
  match_confidence: number;
  blockers: BlueprintResolverV2BlockerCode[];
  warnings: Phase7_6bWarningCode[];
  provenance: {
    attempted_binding_ids: string[];
    rejected: Array<{ binding_id: string; reason: string }>;
    resolved_at: string | null;
  };
  /** Human-readable summary, safe to surface in UI. */
  binding_summary: string | null;
}

export interface MatchOptions {
  /** Stable timestamp injected by caller — keeps result byte-stable across reruns. */
  now: () => string;
}

// ---------------------------------------------------------------------------
// Pure binding matcher
// ---------------------------------------------------------------------------

function templateKeyCompatible(
  binding: BlueprintCatalogBinding,
  candidate: ResolverCandidate,
): boolean {
  if (binding.source_template_key && candidate.source_template_key) {
    if (binding.source_template_key !== candidate.source_template_key) return false;
  }
  if (binding.source_template_version && candidate.source_template_version) {
    if (binding.source_template_version !== candidate.source_template_version) return false;
  }
  return true;
}

function formulaKeyCompatible(
  binding: BlueprintCatalogBinding,
  candidate: ResolverCandidate,
): boolean {
  if (binding.source_formula_key && candidate.formula_key) {
    return binding.source_formula_key === candidate.formula_key;
  }
  return true;
}

function baseSelectorMatch(
  binding: BlueprintCatalogBinding,
  candidate: ResolverCandidate,
): boolean {
  if (binding.tenant_id !== candidate.tenant_id) return false;
  if (binding.trade_id !== candidate.trade_id) return false;
  if (binding.source_item_key !== candidate.item_key) return false;
  if (binding.source_candidate_type !== candidate.source_draft_line_type) return false;
  if (binding.source_unit !== (candidate.unit ?? binding.source_unit)) {
    // unit mismatch is captured as a binding-validity step below — not a selector reject
  }
  if (!templateKeyCompatible(binding, candidate)) return false;
  if (!formulaKeyCompatible(binding, candidate)) return false;
  return true;
}

interface BindingValidity {
  binding: BlueprintCatalogBinding;
  active: boolean;
  inactive_reason: string | null;
  unit_ok: boolean;
  uses_unit_conversion: boolean;
  labor_rate_ok: boolean;
}

function evaluateBinding(
  binding: BlueprintCatalogBinding,
  candidate: ResolverCandidate,
): BindingValidity {
  const activeResult = validateBindingActiveForResolver({
    status: binding.status,
    target_kind: binding.target_kind,
    target_item_id: binding.target_item_id ?? null,
    target_abc_item_number: binding.target_abc_item_number ?? null,
    labor_rate_id: binding.labor_rate_id ?? null,
    source_candidate_type: binding.source_candidate_type,
    pricing_source_type: binding.pricing_source_type,
    cost_source_type: binding.cost_source_type,
  });
  const candidateUnit = candidate.unit ?? binding.source_unit;
  const unitResult = validateBindingUnitCompatibility({
    source_unit: candidateUnit,
    target_unit: binding.target_unit,
    unit_conversion_rule: binding.unit_conversion_rule,
  });
  const usesUnitConversion = !!binding.target_unit &&
    candidateUnit !== binding.target_unit &&
    Object.keys(binding.unit_conversion_rule ?? {}).length > 0;
  const laborRateOk = binding.source_candidate_type === "labor" ? !!binding.labor_rate_id : true;
  return {
    binding,
    active: activeResult.ok,
    inactive_reason: activeResult.ok ? null : activeResult.errors.join(","),
    unit_ok: unitResult.ok,
    uses_unit_conversion: usesUnitConversion,
    labor_rate_ok: laborRateOk,
  };
}

function emptyResult(
  candidate: ResolverCandidate,
  status: BlueprintResolverV2Status,
  blockers: BlueprintResolverV2BlockerCode[],
  warnings: Phase7_6bWarningCode[],
  attempted: string[],
  rejected: Array<{ binding_id: string; reason: string }>,
  now: string,
): ResolverV2RuntimeResult {
  return {
    resolver_version: PHASE_7_6B_RESOLVER_VERSION,
    tenant_id: candidate.tenant_id,
    source_candidate_id: candidate.id,
    trade_id: candidate.trade_id,
    source_item_key: candidate.item_key,
    source_candidate_type: candidate.source_draft_line_type,
    source_unit: candidate.unit ?? "",
    status,
    matched_binding_id: null,
    matched_target_kind: null,
    matched_target_table: null,
    matched_target_item_id: null,
    matched_target_abc_item_number: null,
    matched_labor_rate_id: null,
    matched_target_unit: null,
    uses_unit_conversion: false,
    requires_user_confirmation: false,
    match_confidence: 0,
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    provenance: { attempted_binding_ids: attempted, rejected, resolved_at: null },
    binding_summary: null,
  };
}

/**
 * Deterministic, pure resolver. Input bindings should already be tenant-scoped
 * by the caller (route handler enforces `.eq('tenant_id', resolvedTenantId)`).
 * The function still revalidates tenant scope to refuse cross-tenant leaks.
 */
export function resolveCandidateAgainstBindings(
  candidate: ResolverCandidate,
  bindings: BlueprintCatalogBinding[],
  opts: MatchOptions,
): ResolverV2RuntimeResult {
  const now = opts.now();
  const globalWarnings: Phase7_6bWarningCode[] = [
    "PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B",
    "LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6B",
  ];

  // Trade-level guards.
  if (candidate.trade_id === "windows_doors") {
    return emptyResult(candidate, "blocked",
      ["BLUEPRINT_CATALOG_BINDING_MISSING"],
      globalWarnings,
      [], [], now);
  }
  if (isMeasurementObjectOnlyTrade(candidate.trade_id as TradeId)) {
    return emptyResult(candidate, "blocked",
      ["BLUEPRINT_CATALOG_BINDING_MISSING"],
      globalWarnings,
      [], [], now);
  }
  if (isFutureSupportedTrade(candidate.trade_id as TradeId)) {
    return emptyResult(candidate, "blocked",
      ["BLUEPRINT_CATALOG_BINDING_MISSING", "CATALOG_UNRESOLVED_LIVE_HANDOFF"],
      globalWarnings,
      [], [], now);
  }

  // Cross-tenant safety (defense in depth — should already be filtered).
  const tenantClean = bindings.filter((b) => b.tenant_id === candidate.tenant_id);
  if (tenantClean.length !== bindings.length) {
    return emptyResult(candidate, "tenant_scope_mismatch",
      ["TENANT_COMPANY_SCOPE_UNRESOLVED"],
      globalWarnings,
      bindings.map((b) => b.id), [], now);
  }

  // Selector match.
  const selectorMatches = tenantClean.filter((b) => baseSelectorMatch(b, candidate));
  const attempted = selectorMatches.map((b) => b.id);

  if (selectorMatches.length === 0) {
    return emptyResult(candidate, "unresolved",
      ["BLUEPRINT_CATALOG_BINDING_MISSING", "CATALOG_UNRESOLVED_LIVE_HANDOFF"],
      globalWarnings,
      [], [], now);
  }

  // Evaluate each selector match.
  const evaluated = selectorMatches.map((b) => evaluateBinding(b, candidate));

  const validActives = evaluated.filter((e) =>
    e.active && e.unit_ok && e.labor_rate_ok &&
    e.binding.target_kind !== "custom_line_disabled" &&
    e.binding.target_kind !== "unresolved",
  );
  const inactives = evaluated.filter((e) => !e.active);
  const unitMismatches = evaluated.filter((e) => e.active && !e.unit_ok);
  const laborMissing = evaluated.filter((e) =>
    e.active && e.unit_ok && !e.labor_rate_ok,
  );
  const customLineDisabled = evaluated.find((e) =>
    e.active && e.binding.target_kind === "custom_line_disabled",
  );

  // No valid actives — choose the most descriptive failure.
  if (validActives.length === 0) {
    const rejected: Array<{ binding_id: string; reason: string }> = [];
    for (const e of evaluated) {
      if (!e.active) rejected.push({ binding_id: e.binding.id, reason: `inactive:${e.inactive_reason ?? "unknown"}` });
      else if (!e.unit_ok) rejected.push({ binding_id: e.binding.id, reason: "unit_mismatch_no_conversion_rule" });
      else if (!e.labor_rate_ok) rejected.push({ binding_id: e.binding.id, reason: "labor_rate_missing" });
      else if (e.binding.target_kind === "custom_line_disabled") {
        rejected.push({ binding_id: e.binding.id, reason: "custom_line_disabled" });
      } else if (e.binding.target_kind === "unresolved") {
        rejected.push({ binding_id: e.binding.id, reason: "target_kind_unresolved" });
      }
    }
    let status: BlueprintResolverV2Status = "unresolved";
    const blockers: BlueprintResolverV2BlockerCode[] = ["CATALOG_UNRESOLVED_LIVE_HANDOFF"];
    if (customLineDisabled) {
      status = "blocked";
      blockers.push("CUSTOM_LINE_MODE_NOT_APPROVED", "BLUEPRINT_CATALOG_BINDING_INACTIVE");
    } else if (laborMissing.length > 0) {
      status = "missing_labor_rate";
      blockers.push("BLUEPRINT_LABOR_RATE_MISSING");
    } else if (unitMismatches.length > 0) {
      status = "unit_mismatch";
      blockers.push("BLUEPRINT_CATALOG_UNIT_MISMATCH");
    } else if (inactives.length > 0) {
      // Distinguish inactive binding vs. inactive target shape.
      const targetInactive = inactives.find((e) => e.inactive_reason?.includes("target"));
      if (targetInactive) {
        status = "inactive_target";
        blockers.push("BLUEPRINT_CATALOG_TARGET_INACTIVE");
      } else {
        status = "inactive_binding";
        blockers.push("BLUEPRINT_CATALOG_BINDING_INACTIVE");
      }
    } else {
      blockers.push("BLUEPRINT_CATALOG_BINDING_MISSING");
    }
    return emptyResult(candidate, status, blockers, globalWarnings, attempted, rejected, now);
  }

  if (validActives.length > 1) {
    return emptyResult(candidate, "ambiguous",
      ["BLUEPRINT_CATALOG_BINDING_AMBIGUOUS", "CATALOG_UNRESOLVED_LIVE_HANDOFF"],
      globalWarnings,
      attempted,
      validActives.slice(1).map((e) => ({ binding_id: e.binding.id, reason: "ambiguous_additional_active_binding" })),
      now);
  }

  // Exactly one valid active binding.
  const winner = validActives[0];
  const b = winner.binding;
  const warnings: Phase7_6bWarningCode[] = [...globalWarnings];
  if (b.requires_user_confirmation) warnings.push("BINDING_REQUIRES_USER_CONFIRMATION");
  if (winner.uses_unit_conversion) {
    warnings.push("BINDING_USES_UNIT_CONVERSION", "BLUEPRINT_CATALOG_TARGET_UNIT_REQUIRES_CONVERSION");
  }
  if (b.target_kind === "abc_catalog_item") {
    // ABC items use external item numbers, not a strongly-FK-enforced internal id.
    warnings.push("BINDING_TARGET_TABLE_NOT_STRONGLY_FK_ENFORCED");
  }
  if (b.cost_source_type !== "catalog" && b.cost_source_type !== "labor_rate") {
    warnings.push("BINDING_TARGET_COST_UNVERIFIED");
  }
  if (b.match_confidence < 0.7) warnings.push("BLUEPRINT_CATALOG_BINDING_LOW_CONFIDENCE");
  if (b.effective_to) {
    const tEnd = Date.parse(b.effective_to);
    const nowMs = Date.parse(now);
    if (!Number.isNaN(tEnd) && tEnd - nowMs < 1000 * 60 * 60 * 24 * 14) {
      warnings.push("BLUEPRINT_CATALOG_BINDING_EFFECTIVE_DATE_NEAR_EXPIRY");
    }
  }

  return {
    resolver_version: PHASE_7_6B_RESOLVER_VERSION,
    tenant_id: candidate.tenant_id,
    source_candidate_id: candidate.id,
    trade_id: candidate.trade_id,
    source_item_key: candidate.item_key,
    source_candidate_type: candidate.source_draft_line_type,
    source_unit: candidate.unit ?? b.source_unit,
    status: "resolved",
    matched_binding_id: b.id,
    matched_target_kind: b.target_kind,
    matched_target_table: b.target_table ?? null,
    matched_target_item_id: b.target_item_id ?? null,
    matched_target_abc_item_number: b.target_abc_item_number ?? null,
    matched_labor_rate_id: b.labor_rate_id ?? null,
    matched_target_unit: b.target_unit ?? null,
    uses_unit_conversion: winner.uses_unit_conversion,
    requires_user_confirmation: !!b.requires_user_confirmation,
    match_confidence: b.match_confidence ?? 1,
    blockers: [],
    warnings: Array.from(new Set(warnings)),
    provenance: {
      attempted_binding_ids: attempted,
      rejected: evaluated
        .filter((e) => e.binding.id !== b.id)
        .map((e) => ({ binding_id: e.binding.id, reason: !e.active ? "inactive" : !e.unit_ok ? "unit_mismatch" : !e.labor_rate_ok ? "labor_rate_missing" : "rejected" })),
      resolved_at: now,
    },
    binding_summary: summarizeBindingTarget(b),
  };
}

// ---------------------------------------------------------------------------
// Candidate update payload (pure)
// ---------------------------------------------------------------------------

export interface CandidateUpdatePayload {
  catalog_resolution_status: "matched" | "ambiguous" | "missing" | "unresolved";
  catalog_item_id: string | null;
  pricing_status: string;
  handoff_allowed: false;
  handoff_blockers: BlueprintResolverV2BlockerCode[];
  status: string;
  metadata: Record<string, unknown>;
  updated_at: string;
}

/**
 * Maps resolver runtime status to the existing DB CHECK constraint values for
 * `catalog_resolution_status` (matched / ambiguous / missing / unresolved /
 * manual_override). Granular reason lives in metadata.resolver_v2_result.status.
 */
export function mapResolverStatusToDbCatalogStatus(
  status: BlueprintResolverV2Status,
): "matched" | "ambiguous" | "missing" | "unresolved" {
  switch (status) {
    case "resolved": return "matched";
    case "ambiguous": return "ambiguous";
    case "unresolved": return "missing";
    case "inactive_binding":
    case "inactive_target":
    case "unit_mismatch":
    case "missing_labor_rate":
    case "tenant_scope_mismatch":
    case "blocked":
    default:
      return "unresolved";
  }
}

/**
 * Maps resolver runtime status to a phase-7.6b-safe `pricing_status` value.
 * Phase 7.6b never returns a "live-ready" value — that comes in 7.6c+.
 */
export function mapResolverStatusToPricingStatus(
  status: BlueprintResolverV2Status,
  currentPricing: string | undefined,
): string {
  // Never promote to ready_for_live_handoff or ready_for_pricing_review here.
  if (currentPricing === "ready_for_live_handoff" || currentPricing === "ready_for_pricing_review") {
    return "cost_unresolved";
  }
  switch (status) {
    case "resolved": return "cost_unresolved";
    case "unresolved":
    case "ambiguous":
    case "inactive_binding":
    case "inactive_target":
    case "unit_mismatch":
    case "missing_labor_rate":
    case "tenant_scope_mismatch":
    case "blocked":
    default:
      return currentPricing === "quantity_only" ? "quantity_only" : "cost_unresolved";
  }
}

/**
 * Compute the candidate-level workflow status. Preserves prior `live_written`,
 * `superseded`, `cancelled`, `failed` (those are terminal).
 */
function nextCandidateStatus(
  current: string | undefined,
  result: ResolverV2RuntimeResult,
): string {
  if (current && ["live_written", "superseded", "cancelled", "failed"].includes(current)) {
    return current;
  }
  if (result.blockers.length > 0) return "blocked";
  if (result.warnings.length > 0) return "user_review_required";
  return "preview";
}

export function buildCandidateUpdate(
  candidate: ResolverCandidate,
  result: ResolverV2RuntimeResult,
  now: string,
): CandidateUpdatePayload {
  // Only attach a catalog_item_id when target is a real internal UUID (not ABC or labor).
  const catalogItemId =
    result.status === "resolved" &&
    result.matched_target_item_id &&
    result.matched_target_kind !== "abc_catalog_item" &&
    result.matched_target_kind !== "labor_rate"
      ? result.matched_target_item_id
      : null;

  const priorMeta = candidate.metadata && typeof candidate.metadata === "object"
    ? { ...(candidate.metadata as Record<string, unknown>) }
    : {};

  const metadata: Record<string, unknown> = {
    ...priorMeta,
    resolver_version: PHASE_7_6B_RESOLVER_VERSION,
    resolver_v2_result: result,
    binding_summary: result.binding_summary,
    pricing_preflight_not_enabled_phase_7_6b: true,
    live_handoff_not_enabled_phase_7_6b: true,
    custom_line_mode_not_enabled_phase_7_6b: true,
    resolver_warning_codes: result.warnings,
    resolver_blocker_codes: result.blockers,
  };

  return {
    catalog_resolution_status: mapResolverStatusToDbCatalogStatus(result.status),
    catalog_item_id: catalogItemId,
    pricing_status: mapResolverStatusToPricingStatus(result.status, candidate.pricing_status),
    handoff_allowed: false,
    handoff_blockers: result.blockers,
    status: nextCandidateStatus(candidate.status, result),
    metadata,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Review flag specs (pure)
// ---------------------------------------------------------------------------

export interface ReviewFlagSpec {
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

const FLAG_MESSAGES: Record<string, string> = {
  BLUEPRINT_CATALOG_BINDING_MISSING:
    "No active blueprint_catalog_binding matches this candidate. Create a binding before live handoff.",
  BLUEPRINT_CATALOG_BINDING_AMBIGUOUS:
    "More than one active binding matches this candidate. Resolve ambiguity before live handoff.",
  BLUEPRINT_CATALOG_BINDING_INACTIVE:
    "Matched binding is not active (draft / inactive / superseded / blocked / needs_review).",
  BLUEPRINT_CATALOG_TARGET_INACTIVE:
    "Matched binding points at an inactive target row.",
  BLUEPRINT_CATALOG_UNIT_MISMATCH:
    "Binding source and target units differ and no unit_conversion_rule is set.",
  BLUEPRINT_LABOR_RATE_MISSING:
    "Labor binding is missing a labor_rate_id reference.",
  BLUEPRINT_LABOR_RATE_INACTIVE:
    "Labor binding's labor_rate target is inactive.",
  TENANT_COMPANY_SCOPE_UNRESOLVED:
    "Tenant/company scope is unresolved for this candidate. See blueprint-tenant-company-catalog-reconciliation.md.",
  CATALOG_UNRESOLVED_LIVE_HANDOFF:
    "Catalog resolution incomplete — live handoff (Push to Estimate) remains blocked.",
  CUSTOM_LINE_MODE_NOT_APPROVED:
    "Binding target is custom_line_disabled — custom non-catalog approval is not enabled in Phase 7.6b.",
  BINDING_REQUIRES_USER_CONFIRMATION:
    "Matched binding requires explicit user confirmation before live handoff.",
  BINDING_USES_UNIT_CONVERSION:
    "Matched binding will apply a unit conversion rule between source and target units.",
  BINDING_TARGET_TABLE_NOT_STRONGLY_FK_ENFORCED:
    "Binding target is an external catalog (e.g. ABC) without a strong internal foreign key.",
  BINDING_TARGET_COST_UNVERIFIED:
    "Matched binding's cost source is not catalog/labor_rate — cost is not verified.",
  PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B:
    "Pricing preflight is intentionally disabled in Phase 7.6b.",
  LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6B:
    "Live handoff (Push to Estimate) is intentionally disabled in Phase 7.6b.",
  BLUEPRINT_CATALOG_BINDING_LOW_CONFIDENCE:
    "Matched binding has a low confidence score — review before live handoff.",
  BLUEPRINT_CATALOG_BINDING_EFFECTIVE_DATE_NEAR_EXPIRY:
    "Matched binding's effective_to is within 14 days — binding may expire soon.",
  BLUEPRINT_CATALOG_TARGET_UNIT_REQUIRES_CONVERSION:
    "Matched binding target unit differs from source unit — conversion rule will apply.",
  BLUEPRINT_CATALOG_BINDING_NEEDS_REVIEW:
    "Matched binding is marked needs_review.",
};

/** Always-blocking codes (must keep handoff_allowed=false). */
const BLOCKING_FLAGS = new Set<string>([
  "BLUEPRINT_CATALOG_BINDING_MISSING",
  "BLUEPRINT_CATALOG_BINDING_AMBIGUOUS",
  "BLUEPRINT_CATALOG_BINDING_INACTIVE",
  "BLUEPRINT_CATALOG_TARGET_INACTIVE",
  "BLUEPRINT_CATALOG_UNIT_MISMATCH",
  "BLUEPRINT_LABOR_RATE_MISSING",
  "BLUEPRINT_LABOR_RATE_INACTIVE",
  "TENANT_COMPANY_SCOPE_UNRESOLVED",
  "CATALOG_UNRESOLVED_LIVE_HANDOFF",
  "CUSTOM_LINE_MODE_NOT_APPROVED",
]);

export function buildReviewFlagSpecs(
  candidate: ResolverCandidate,
  result: ResolverV2RuntimeResult,
): ReviewFlagSpec[] {
  const relatedEntityType: ReviewFlagSpec["related_entity_type"] =
    candidate.source_draft_line_type === "material" ? "material_draft_line" : "labor_draft_line";
  const baseMetadata = {
    source: "resolver_v2",
    resolver_version: PHASE_7_6B_RESOLVER_VERSION,
    line_candidate_id: candidate.id,
    handoff_batch_id: candidate.handoff_batch_id,
    deterministic_handoff_key: candidate.deterministic_handoff_key,
    matched_binding_id: result.matched_binding_id,
  };
  const specs: ReviewFlagSpec[] = [];
  const seen = new Set<string>();
  const push = (code: string, severity: "blocker" | "warning") => {
    if (seen.has(code)) return;
    seen.add(code);
    specs.push({
      import_session_id: candidate.import_session_id,
      tenant_id: candidate.tenant_id,
      related_entity_type: relatedEntityType,
      related_entity_id: candidate.source_draft_line_id,
      severity,
      flag_code: code,
      message: FLAG_MESSAGES[code] ?? code,
      blocking: severity === "blocker",
      metadata: baseMetadata,
    });
  };
  for (const b of result.blockers) push(b, BLOCKING_FLAGS.has(b) ? "blocker" : "blocker");
  for (const w of result.warnings) push(w, "warning");
  return specs;
}

// ---------------------------------------------------------------------------
// Aggregate batch summary (pure)
// ---------------------------------------------------------------------------

export interface ResolverBatchSummary {
  total: number;
  by_status: Record<BlueprintResolverV2Status, number>;
  resolved: number;
  blocked: number;
  ambiguous: number;
  missing: number;
  blocker_counts: Record<string, number>;
  warning_counts: Record<string, number>;
  handoff_still_blocked: true;
  push_to_estimate_enabled: false;
  push_to_estimate_disabled_reason: string;
}

export function summarizeResolverResults(results: ResolverV2RuntimeResult[]): ResolverBatchSummary {
  const byStatus: Record<string, number> = {
    resolved: 0, unresolved: 0, ambiguous: 0,
    inactive_binding: 0, inactive_target: 0, unit_mismatch: 0,
    tenant_scope_mismatch: 0, missing_labor_rate: 0, blocked: 0,
  };
  const blockerCounts: Record<string, number> = {};
  const warningCounts: Record<string, number> = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    for (const b of r.blockers) blockerCounts[b] = (blockerCounts[b] ?? 0) + 1;
    for (const w of r.warnings) warningCounts[w] = (warningCounts[w] ?? 0) + 1;
  }
  return {
    total: results.length,
    by_status: byStatus as ResolverBatchSummary["by_status"],
    resolved: byStatus.resolved,
    blocked: byStatus.blocked,
    ambiguous: byStatus.ambiguous,
    missing: byStatus.unresolved,
    blocker_counts: blockerCounts,
    warning_counts: warningCounts,
    handoff_still_blocked: true,
    push_to_estimate_enabled: false,
    push_to_estimate_disabled_reason:
      "Push to Estimate remains disabled. Phase 7.6b only resolves preview candidates to approved blueprint catalog bindings; pricing preflight and live handoff are not enabled.",
  };
}
