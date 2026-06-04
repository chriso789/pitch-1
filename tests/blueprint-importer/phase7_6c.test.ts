// Blueprint Importer v2 — Phase 7.6c pricing preflight tests.
// Pure-function tests against ../../supabase/functions/_shared/blueprint-importer/phase7_6c-preflight.ts
// No DB IO. No live writes. No final pricing.

import { describe, it, expect } from "vitest";
import {
  evaluatePricingPreflight,
  buildPreflightCandidateUpdate,
  buildPreflightReviewFlagSpecs,
  summarizePreflightResults,
  PHASE_7_6C_PREFLIGHT_VERSION,
  type PreflightCandidateInput,
  type TargetRowSnapshot,
} from "../../supabase/functions/_shared/blueprint-importer/phase7_6c-preflight.ts";
import type { BlueprintCatalogBinding } from "../../supabase/functions/_shared/blueprint-importer/catalog-bindings.ts";
import type { ResolverV2RuntimeResult } from "../../supabase/functions/_shared/blueprint-importer/phase7_6b-resolver.ts";

const T = "00000000-0000-0000-0000-0000000000aa";
const T2 = "00000000-0000-0000-0000-0000000000bb";
const PROD = "11111111-1111-1111-1111-111111111111";
const LABOR = "22222222-2222-2222-2222-222222222222";
const BIND = "bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const CAND = "33333333-3333-3333-3333-333333333333";
const NOW = "2026-06-04T18:00:00.000Z";
const now = () => NOW;
const OPTS = { pricing_mode: "ready_for_pricing_review" as const, pricing_contract_version: "blueprint-importer-v2", now };

function materialResolved(): ResolverV2RuntimeResult {
  return {
    resolver_version: "v2.0-runtime-phase-7.6b",
    tenant_id: T, source_candidate_id: CAND, trade_id: "roofing",
    source_item_key: "shingles", source_candidate_type: "material", source_unit: "square",
    status: "resolved", matched_binding_id: BIND,
    matched_target_kind: "product_catalog", matched_target_table: "product_catalog",
    matched_target_item_id: PROD, matched_target_abc_item_number: null,
    matched_labor_rate_id: null, matched_target_unit: "square",
    uses_unit_conversion: false, requires_user_confirmation: false,
    match_confidence: 1, blockers: [], warnings: [],
    provenance: { attempted_binding_ids: [BIND], rejected: [], resolved_at: NOW },
    binding_summary: "product_catalog:" + PROD,
  };
}

function materialCandidate(over: Partial<PreflightCandidateInput> = {}): PreflightCandidateInput {
  return {
    id: CAND, tenant_id: T, handoff_batch_id: "batch", import_session_id: "sess",
    source_draft_line_id: "draft", source_draft_line_type: "material",
    trade_id: "roofing", item_key: "shingles", quantity: 22, unit: "square",
    deterministic_handoff_key: "k1", resolver_result: materialResolved(),
    metadata: {}, ...over,
  };
}

function laborResolved(): ResolverV2RuntimeResult {
  return { ...materialResolved(), source_candidate_type: "labor",
    matched_target_kind: "labor_rate", matched_target_table: "labor_rates",
    matched_target_item_id: null, matched_target_unit: "hr",
    matched_labor_rate_id: LABOR, binding_summary: "labor_rate:" + LABOR };
}
function laborCandidate(over: Partial<PreflightCandidateInput> = {}): PreflightCandidateInput {
  return { ...materialCandidate({ source_draft_line_type: "labor", unit: "hr", resolver_result: laborResolved() }), ...over };
}

function matBinding(over: Partial<BlueprintCatalogBinding> = {}): BlueprintCatalogBinding {
  return {
    id: BIND, tenant_id: T, binding_scope: "tenant", binding_type: "material",
    trade_id: "roofing", source_candidate_type: "material",
    source_item_key: "shingles", source_unit: "square",
    target_kind: "product_catalog", target_table: "product_catalog",
    target_item_id: PROD, target_unit: "square",
    unit_conversion_rule: {}, pricing_source_type: "catalog_cost",
    cost_source_type: "catalog", status: "active",
    resolver_priority: 100, match_confidence: 1,
    requires_user_confirmation: false,
    deterministic_binding_key: "bpcb|m1", metadata: {}, ...over,
  };
}
function laborBinding(over: Partial<BlueprintCatalogBinding> = {}): BlueprintCatalogBinding {
  return matBinding({
    binding_type: "labor", source_candidate_type: "labor",
    source_item_key: "install_shingles", target_kind: "labor_rate",
    target_table: "labor_rates", target_item_id: null,
    labor_rate_id: LABOR, pricing_source_type: "labor_rate",
    cost_source_type: "labor_rate", target_unit: "hr", ...over,
  });
}

function prodTarget(over: Partial<TargetRowSnapshot> = {}): TargetRowSnapshot {
  return { table: "product_catalog", id: PROD, tenant_id: T, tenant_scoped: true,
    is_active: true, active_status_verifiable: true,
    base_unit_cost: 120, target_unit: "square", base_rate_per_hour: null, ...over };
}
function laborTarget(over: Partial<TargetRowSnapshot> = {}): TargetRowSnapshot {
  return { table: "labor_rates", id: LABOR, tenant_id: T, tenant_scoped: true,
    is_active: true, active_status_verifiable: true,
    base_unit_cost: null, target_unit: "hr", base_rate_per_hour: 65, ...over };
}

// ─── Quantity-only & resolver gating ───────────────────────────────────────

describe("Phase 7.6c — pricing mode gates", () => {
  it("blocks quantity_only as unsafe regardless of binding readiness", () => {
    const r = evaluatePricingPreflight(materialCandidate(), matBinding(), prodTarget(),
      { ...OPTS, pricing_mode: "quantity_only" });
    expect(r.pricing_status).toBe("blocked_quantity_only_unsafe");
    expect(r.blockers).toContain("QUANTITY_ONLY_LIVE_LINES_UNSAFE");
    expect(r.blockers).toContain("PRICING_REQUIRED_BUT_UNAVAILABLE");
    expect(r.handoff_allowed).toBe(false);
  });
  it("blocks when resolver did not resolve a binding", () => {
    const cand = materialCandidate({ resolver_result: { ...materialResolved(), status: "unresolved", matched_binding_id: null } });
    const r = evaluatePricingPreflight(cand, null, null, OPTS);
    expect(r.pricing_status).toBe("cost_unresolved");
    expect(r.blockers).toContain("PRICING_REQUIRED_BUT_UNAVAILABLE");
  });
  it("blocks when binding target_kind is custom_line_disabled", () => {
    const r = evaluatePricingPreflight(materialCandidate(), matBinding({ target_kind: "custom_line_disabled" }), null, OPTS);
    expect(r.blockers).toContain("CATALOG_TARGET_MISSING");
  });
  it("blocks material_item_match_rules sources as out of scope", () => {
    const r = evaluatePricingPreflight(materialCandidate(),
      matBinding({ metadata: { source: "material_item_match_rules" } }), prodTarget(), OPTS);
    expect(r.blockers).toContain("MATERIAL_ITEM_MATCH_RULES_OUT_OF_SCOPE");
    expect(r.cost_status).toBe("out_of_scope");
  });
});

// ─── Material pricing ──────────────────────────────────────────────────────

describe("Phase 7.6c — material pricing preflight", () => {
  it("computes preview extended_cost when binding.unit_cost is explicit and positive", () => {
    const r = evaluatePricingPreflight(materialCandidate(),
      matBinding({ unit_cost: 145 }), prodTarget(), OPTS);
    expect(r.pricing_status).toBe("ready_for_pricing_review");
    expect(r.cost_status).toBe("explicit_positive");
    expect(r.preview_cost.unit_cost).toBe(145);
    expect(r.preview_cost.extended_cost).toBe(22 * 145);
    expect(r.preview_cost.cost_source).toBe("binding.unit_cost");
    expect(r.preview_cost.preview_only).toBe(true);
    expect(r.handoff_allowed).toBe(false);
  });
  it("falls back to target.base_unit_cost when cost_source_type=catalog", () => {
    const r = evaluatePricingPreflight(materialCandidate(), matBinding(), prodTarget(), OPTS);
    expect(r.preview_cost.cost_source).toBe("target.base_unit_cost");
    expect(r.preview_cost.unit_cost).toBe(120);
  });
  it("blocks missing unit_cost (no binding cost, no target cost)", () => {
    const r = evaluatePricingPreflight(materialCandidate(),
      matBinding({ unit_cost: null }), prodTarget({ base_unit_cost: null }), OPTS);
    expect(r.pricing_status).toBe("catalog_resolved_cost_missing");
    expect(r.blockers).toContain("CATALOG_RESOLVED_COST_MISSING");
    expect(r.blockers).toContain("MATERIAL_UNIT_COST_MISSING");
  });
  it("blocks zero unit_cost as unsafe (not explicitly approved)", () => {
    const r = evaluatePricingPreflight(materialCandidate(),
      matBinding({ unit_cost: 0 }), prodTarget({ base_unit_cost: 0 }), OPTS);
    expect(r.blockers).toContain("MATERIAL_UNIT_COST_ZERO_UNSAFE");
    expect(r.blockers).toContain("ZERO_DEFAULT_PRICING_UNSAFE");
  });
  it("blocks missing target row", () => {
    const r = evaluatePricingPreflight(materialCandidate(), matBinding(), null, OPTS);
    expect(r.blockers).toContain("CATALOG_TARGET_MISSING");
  });
  it("blocks inactive target", () => {
    const r = evaluatePricingPreflight(materialCandidate(), matBinding(),
      prodTarget({ is_active: false }), OPTS);
    expect(r.blockers).toContain("CATALOG_TARGET_INACTIVE");
  });
  it("blocks tenant-mismatched target when table is tenant-scoped", () => {
    const r = evaluatePricingPreflight(materialCandidate(), matBinding(),
      prodTarget({ tenant_id: T2 }), OPTS);
    expect(r.blockers).toContain("CATALOG_TARGET_TENANT_MISMATCH");
  });
  it("warns when active status is not verifiable", () => {
    const r = evaluatePricingPreflight(materialCandidate(), matBinding(),
      prodTarget({ active_status_verifiable: false, is_active: null }), OPTS);
    expect(r.warnings).toContain("TARGET_ACTIVE_STATUS_NOT_VERIFIABLE");
  });
  it("blocks unit mismatch without conversion rule", () => {
    const r = evaluatePricingPreflight(materialCandidate({ unit: "sqft" }),
      matBinding({ source_unit: "sqft", target_unit: "square", unit_conversion_rule: {} }),
      prodTarget(), OPTS);
    expect(r.blockers).toContain("UNIT_CONVERSION_REQUIRED");
  });
  it("allows unit conversion when binding provides explicit rule", () => {
    const r = evaluatePricingPreflight(materialCandidate({ unit: "sqft" }),
      matBinding({ source_unit: "sqft", target_unit: "square", unit_conversion_rule: { sqft_per_square: 100 }, unit_cost: 145 }),
      prodTarget(), OPTS);
    expect(r.warnings).toContain("BINDING_UNIT_CONVERSION_APPLIED");
    expect(r.pricing_status).toBe("ready_for_pricing_review");
  });
  it("blocks pricing rule missing when binding pricing_source_type=unresolved", () => {
    const r = evaluatePricingPreflight(materialCandidate(),
      matBinding({ pricing_source_type: "unresolved", unit_cost: null }),
      prodTarget({ base_unit_cost: null }), OPTS);
    expect(r.blockers).toContain("MATERIAL_PRICING_RULE_MISSING");
  });
  it("never infers markup, tax, discount, or final price", () => {
    const r = evaluatePricingPreflight(materialCandidate(),
      matBinding({ unit_cost: 100 }), prodTarget(), OPTS);
    expect(r.blockers).toContain("FINAL_PRICING_NOT_ENABLED_PHASE_7_6C");
    expect(r.blockers).toContain("LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6C");
  });
});

// ─── Labor pricing ─────────────────────────────────────────────────────────

describe("Phase 7.6c — labor pricing preflight", () => {
  it("computes preview labor cost for hour-unit candidate with positive rate", () => {
    const r = evaluatePricingPreflight(laborCandidate({ quantity: 8 }),
      laborBinding(), laborTarget(), OPTS);
    expect(r.pricing_status).toBe("ready_for_pricing_review");
    expect(r.preview_cost.unit_cost).toBe(65);
    expect(r.preview_cost.extended_cost).toBe(8 * 65);
    expect(r.preview_cost.cost_source).toBe("labor_rate.base_rate_per_hour");
  });
  it("blocks missing labor_rate_id on binding", () => {
    const r = evaluatePricingPreflight(laborCandidate(),
      laborBinding({ labor_rate_id: null }), null, OPTS);
    expect(r.pricing_status).toBe("labor_rate_missing");
    expect(r.blockers).toContain("LABOR_RATE_MISSING");
  });
  it("blocks missing labor rate row", () => {
    const r = evaluatePricingPreflight(laborCandidate(),
      laborBinding(), null, OPTS);
    expect(r.blockers).toContain("LABOR_RATE_MISSING");
  });
  it("blocks inactive labor rate", () => {
    const r = evaluatePricingPreflight(laborCandidate(),
      laborBinding(), laborTarget({ is_active: false }), OPTS);
    expect(r.blockers).toContain("LABOR_RATE_INACTIVE");
  });
  it("blocks tenant-mismatched labor rate", () => {
    const r = evaluatePricingPreflight(laborCandidate(),
      laborBinding(), laborTarget({ tenant_id: T2 }), OPTS);
    expect(r.blockers).toContain("LABOR_RATE_TENANT_MISMATCH");
  });
  it("blocks per-hour rate when candidate unit needs production conversion and no rule exists", () => {
    const r = evaluatePricingPreflight(laborCandidate({ unit: "square" }),
      laborBinding({ source_unit: "square", unit_conversion_rule: {} }),
      laborTarget(), OPTS);
    expect(r.blockers).toContain("LABOR_PRODUCTION_RATE_REQUIRED");
    expect(r.blockers).toContain("LABOR_RATE_UNIT_MISMATCH");
  });
  it("computes preview cost when production_rate_per_hour rule exists", () => {
    const r = evaluatePricingPreflight(laborCandidate({ unit: "square", quantity: 4 }),
      laborBinding({ source_unit: "square", unit_conversion_rule: { production_rate_per_hour: 2 } }),
      laborTarget(), OPTS);
    expect(r.pricing_status).toBe("ready_for_pricing_review");
    expect(r.preview_cost.quantity).toBe(2); // 4 squares / 2 per hour = 2 hours
    expect(r.preview_cost.extended_cost).toBe(2 * 65);
  });
  it("blocks zero labor rate as unsafe", () => {
    const r = evaluatePricingPreflight(laborCandidate(),
      laborBinding(), laborTarget({ base_rate_per_hour: 0 }), OPTS);
    expect(r.blockers).toContain("LABOR_RATE_ZERO_UNSAFE");
    expect(r.blockers).toContain("ZERO_DEFAULT_PRICING_UNSAFE");
  });
  it("blocks missing pricing rule", () => {
    const r = evaluatePricingPreflight(laborCandidate(),
      laborBinding({ pricing_source_type: "unresolved" }), laborTarget(), OPTS);
    expect(r.blockers).toContain("LABOR_PRICING_RULE_MISSING");
  });
});

// ─── Candidate persistence ────────────────────────────────────────────────

describe("Phase 7.6c — candidate update payload", () => {
  it("preserves resolver metadata and persists pricing_preflight", () => {
    const cand = materialCandidate({ metadata: {
      resolver_v2_result: materialResolved(),
      binding_summary: "x",
      source_measurement_ids: ["m1"],
      plan_path_ids: ["pp1"],
      source_document_ids: ["d1"],
    } });
    const r = evaluatePricingPreflight(cand, matBinding({ unit_cost: 100 }), prodTarget(), OPTS);
    const upd = buildPreflightCandidateUpdate(cand, r, "blocked");
    expect(upd.handoff_allowed).toBe(false);
    expect(upd.metadata.resolver_v2_result).toBeDefined();
    expect((upd.metadata as any).source_measurement_ids).toEqual(["m1"]);
    expect((upd.metadata as any).plan_path_ids).toEqual(["pp1"]);
    expect((upd.metadata as any).pricing_preflight).toBeDefined();
    expect((upd.metadata as any).preview_cost_summary.preview_only).toBe(true);
    expect((upd.metadata as any).final_pricing_not_enabled_phase_7_6c).toBe(true);
    expect((upd.metadata as any).live_handoff_not_enabled_phase_7_6c).toBe(true);
    expect(upd.status).toBe("user_review_required");
  });
  it("preserves terminal candidate status (live_written)", () => {
    const cand = materialCandidate();
    const r = evaluatePricingPreflight(cand, matBinding({ unit_cost: 50 }), prodTarget(), OPTS);
    expect(buildPreflightCandidateUpdate(cand, r, "live_written").status).toBe("live_written");
  });
});

// ─── Review flag specs ────────────────────────────────────────────────────

describe("Phase 7.6c — review flag specs", () => {
  it("emits granular blockers, never collapses to generic pricing failure", () => {
    const r = evaluatePricingPreflight(materialCandidate(),
      matBinding({ unit_cost: 0 }), prodTarget({ base_unit_cost: 0 }), OPTS);
    const specs = buildPreflightReviewFlagSpecs(materialCandidate(), r);
    const codes = specs.map((s) => s.flag_code);
    expect(codes).toContain("MATERIAL_UNIT_COST_ZERO_UNSAFE");
    expect(codes).toContain("ZERO_DEFAULT_PRICING_UNSAFE");
    expect(codes).toContain("LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6C");
    for (const s of specs) {
      expect(s.metadata.source).toBe("pricing_preflight_v2");
      expect(s.metadata.preflight_version).toBe(PHASE_7_6C_PREFLIGHT_VERSION);
    }
  });
  it("is deterministic across reruns with unchanged inputs (idempotent)", () => {
    const cand = materialCandidate();
    const r1 = evaluatePricingPreflight(cand, matBinding({ unit_cost: 145 }), prodTarget(), OPTS);
    const r2 = evaluatePricingPreflight(cand, matBinding({ unit_cost: 145 }), prodTarget(), OPTS);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(JSON.stringify(buildPreflightReviewFlagSpecs(cand, r1))).toBe(JSON.stringify(buildPreflightReviewFlagSpecs(cand, r2)));
  });
  it("changes when binding cost changes", () => {
    const cand = materialCandidate();
    const r1 = evaluatePricingPreflight(cand, matBinding({ unit_cost: 100 }), prodTarget(), OPTS);
    const r2 = evaluatePricingPreflight(cand, matBinding({ unit_cost: 145 }), prodTarget(), OPTS);
    expect(r1.preview_cost.unit_cost).not.toBe(r2.preview_cost.unit_cost);
  });
});

// ─── Batch summary ────────────────────────────────────────────────────────

describe("Phase 7.6c — batch summary", () => {
  it("aggregates counts and keeps push-to-estimate disabled", () => {
    const a = evaluatePricingPreflight(materialCandidate(),
      matBinding({ unit_cost: 100 }), prodTarget(), OPTS);
    const b = evaluatePricingPreflight(materialCandidate({ id: "x2" }),
      matBinding({ unit_cost: null }), prodTarget({ base_unit_cost: null }), OPTS);
    const s = summarizePreflightResults([a, b]);
    expect(s.total).toBe(2);
    expect(s.ready_for_pricing_review).toBe(1);
    expect(s.blocked).toBe(1);
    expect(s.push_to_estimate_enabled).toBe(false);
    expect(s.final_pricing_enabled).toBe(false);
    expect(s.preview_only).toBe(true);
  });
});
