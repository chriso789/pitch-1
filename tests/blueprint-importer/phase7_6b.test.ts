// Blueprint Importer v2 — Phase 7.6b deterministic binding resolver tests.
// Pure-function tests against ../../supabase/functions/_shared/blueprint-importer/phase7_6b-resolver.ts
// Verifies binding match hierarchy, candidate update payloads, review flag specs,
// and idempotency. No DB IO.

import { describe, it, expect } from "vitest";
import {
  resolveCandidateAgainstBindings,
  buildCandidateUpdate,
  buildReviewFlagSpecs,
  summarizeResolverResults,
  mapResolverStatusToDbCatalogStatus,
  mapResolverStatusToPricingStatus,
  PHASE_7_6B_RESOLVER_VERSION,
  type ResolverCandidate,
} from "../../supabase/functions/_shared/blueprint-importer/phase7_6b-resolver.ts";
import type { BlueprintCatalogBinding } from "../../supabase/functions/_shared/blueprint-importer/catalog-bindings.ts";

const T = "00000000-0000-0000-0000-0000000000aa";
const T2 = "00000000-0000-0000-0000-0000000000bb";
const PROD = "11111111-1111-1111-1111-111111111111";
const PROD2 = "11111111-1111-1111-1111-111111111122";
const LABOR = "22222222-2222-2222-2222-222222222222";
const CAND_ID = "33333333-3333-3333-3333-333333333333";
const DRAFT_ID = "44444444-4444-4444-4444-444444444444";
const BATCH = "55555555-5555-5555-5555-555555555555";
const SESSION = "66666666-6666-6666-6666-666666666666";
const NOW = "2026-06-04T18:00:00.000Z";
const now = () => NOW;

function materialCandidate(over: Partial<ResolverCandidate> = {}): ResolverCandidate {
  return {
    id: CAND_ID,
    tenant_id: T,
    handoff_batch_id: BATCH,
    import_session_id: SESSION,
    trade_id: "roofing",
    source_draft_line_id: DRAFT_ID,
    source_draft_line_type: "material",
    item_key: "shingles_architectural_30yr",
    unit: "square",
    quantity: 22.5,
    deterministic_handoff_key: "candkey-1",
    metadata: {},
    pricing_status: "quantity_only",
    cost_status: "not_attempted",
    handoff_allowed: false,
    handoff_blockers: [],
    status: "blocked",
    ...over,
  };
}

function laborCandidate(over: Partial<ResolverCandidate> = {}): ResolverCandidate {
  return materialCandidate({
    source_draft_line_type: "labor",
    item_key: "install_shingles_per_square",
    unit: "square",
    ...over,
  });
}

function activeMaterialBinding(over: Partial<BlueprintCatalogBinding> = {}): BlueprintCatalogBinding {
  return {
    id: "bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
    tenant_id: T,
    binding_scope: "tenant",
    binding_type: "material",
    trade_id: "roofing",
    source_candidate_type: "material",
    source_item_key: "shingles_architectural_30yr",
    source_unit: "square",
    target_kind: "product_catalog",
    target_table: "product_catalog",
    target_item_id: PROD,
    target_unit: "square",
    unit_conversion_rule: {},
    pricing_source_type: "catalog_cost",
    cost_source_type: "catalog",
    status: "active",
    resolver_priority: 100,
    match_confidence: 1,
    requires_user_confirmation: false,
    deterministic_binding_key: "bpcb|m1",
    metadata: {},
    ...over,
  };
}

function activeLaborBinding(over: Partial<BlueprintCatalogBinding> = {}): BlueprintCatalogBinding {
  return {
    ...activeMaterialBinding(),
    id: "bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
    binding_type: "labor",
    source_candidate_type: "labor",
    source_item_key: "install_shingles_per_square",
    target_kind: "labor_rate",
    target_table: "labor_rates",
    target_item_id: null,
    labor_rate_id: LABOR,
    pricing_source_type: "labor_rate",
    cost_source_type: "labor_rate",
    deterministic_binding_key: "bpcb|l1",
    ...over,
  };
}

// --- Resolver basics ----------------------------------------------------------

describe("Phase 7.6b resolver — material match", () => {
  it("resolves a material candidate by exactly one active binding", () => {
    const r = resolveCandidateAgainstBindings(materialCandidate(), [activeMaterialBinding()], { now });
    expect(r.status).toBe("resolved");
    expect(r.matched_binding_id).toBe("bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb1");
    expect(r.matched_target_item_id).toBe(PROD);
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toContain("PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B");
    expect(r.warnings).toContain("LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6B");
  });

  it("missing binding → unresolved + BLUEPRINT_CATALOG_BINDING_MISSING", () => {
    const r = resolveCandidateAgainstBindings(materialCandidate(), [], { now });
    expect(r.status).toBe("unresolved");
    expect(r.blockers).toContain("BLUEPRINT_CATALOG_BINDING_MISSING");
    expect(r.blockers).toContain("CATALOG_UNRESOLVED_LIVE_HANDOFF");
  });

  it("two active matches → ambiguous", () => {
    const r = resolveCandidateAgainstBindings(materialCandidate(), [
      activeMaterialBinding(),
      activeMaterialBinding({
        id: "bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb3",
        target_item_id: PROD2,
        deterministic_binding_key: "bpcb|m2",
      }),
    ], { now });
    expect(r.status).toBe("ambiguous");
    expect(r.blockers).toContain("BLUEPRINT_CATALOG_BINDING_AMBIGUOUS");
  });

  it("inactive binding → inactive_binding + blocker", () => {
    const r = resolveCandidateAgainstBindings(materialCandidate(), [activeMaterialBinding({ status: "inactive" })], { now });
    expect(r.status).toBe("inactive_binding");
    expect(r.blockers).toContain("BLUEPRINT_CATALOG_BINDING_INACTIVE");
  });

  it("unit mismatch (no conversion rule) → unit_mismatch", () => {
    const r = resolveCandidateAgainstBindings(
      materialCandidate({ unit: "square" }),
      [activeMaterialBinding({ source_unit: "square", target_unit: "bundle", unit_conversion_rule: {} })],
      { now },
    );
    expect(r.status).toBe("unit_mismatch");
    expect(r.blockers).toContain("BLUEPRINT_CATALOG_UNIT_MISMATCH");
  });

  it("unit conversion rule present → resolved + BINDING_USES_UNIT_CONVERSION warning", () => {
    const r = resolveCandidateAgainstBindings(
      materialCandidate(),
      [activeMaterialBinding({ target_unit: "bundle", unit_conversion_rule: { factor: 3 } })],
      { now },
    );
    expect(r.status).toBe("resolved");
    expect(r.uses_unit_conversion).toBe(true);
    expect(r.warnings).toContain("BINDING_USES_UNIT_CONVERSION");
    expect(r.warnings).toContain("BLUEPRINT_CATALOG_TARGET_UNIT_REQUIRES_CONVERSION");
  });

  it("requires_user_confirmation → resolved + warning", () => {
    const r = resolveCandidateAgainstBindings(
      materialCandidate(),
      [activeMaterialBinding({ requires_user_confirmation: true })],
      { now },
    );
    expect(r.status).toBe("resolved");
    expect(r.warnings).toContain("BINDING_REQUIRES_USER_CONFIRMATION");
  });

  it("ABC target → resolved with FK-weak warning, no catalog_item_id mapped", () => {
    const r = resolveCandidateAgainstBindings(
      materialCandidate(),
      [activeMaterialBinding({
        target_kind: "abc_catalog_item",
        target_table: "abc_catalog_items",
        target_item_id: null,
        target_abc_item_number: "ABC-1234",
      })],
      { now },
    );
    expect(r.status).toBe("resolved");
    expect(r.warnings).toContain("BINDING_TARGET_TABLE_NOT_STRONGLY_FK_ENFORCED");
    const upd = buildCandidateUpdate(materialCandidate(), r, NOW);
    expect(upd.catalog_item_id).toBeNull();
  });

  it("template_key mismatch is rejected by selector", () => {
    const r = resolveCandidateAgainstBindings(
      materialCandidate({ source_template_key: "roof.shingles.v2" }),
      [activeMaterialBinding({ source_template_key: "roof.shingles.v1" })],
      { now },
    );
    expect(r.status).toBe("unresolved");
  });
});

describe("Phase 7.6b resolver — labor match", () => {
  it("resolves labor candidate with labor_rate_id", () => {
    const r = resolveCandidateAgainstBindings(laborCandidate(), [activeLaborBinding()], { now });
    expect(r.status).toBe("resolved");
    expect(r.matched_labor_rate_id).toBe(LABOR);
  });

  it("missing labor_rate_id → missing_labor_rate", () => {
    const r = resolveCandidateAgainstBindings(
      laborCandidate(),
      [activeLaborBinding({ labor_rate_id: null })],
      { now },
    );
    expect(r.status).toBe("missing_labor_rate");
    expect(r.blockers).toContain("BLUEPRINT_LABOR_RATE_MISSING");
  });

  it("missing labor binding → unresolved", () => {
    const r = resolveCandidateAgainstBindings(laborCandidate(), [], { now });
    expect(r.status).toBe("unresolved");
    expect(r.blockers).toContain("BLUEPRINT_CATALOG_BINDING_MISSING");
  });
});

// --- Trade guards -------------------------------------------------------------

describe("Phase 7.6b resolver — trade guards", () => {
  it("windows_doors trade is always blocked", () => {
    const r = resolveCandidateAgainstBindings(
      materialCandidate({ trade_id: "windows_doors" }),
      [activeMaterialBinding({ trade_id: "windows_doors" })],
      { now },
    );
    expect(r.status).toBe("blocked");
  });

  it("future-supported trade is blocked", () => {
    const r = resolveCandidateAgainstBindings(
      materialCandidate({ trade_id: "drywall" }),
      [activeMaterialBinding({ trade_id: "drywall" })],
      { now },
    );
    expect(r.status).toBe("blocked");
  });
});

// --- Tenant scoping -----------------------------------------------------------

describe("Phase 7.6b resolver — tenant safety", () => {
  it("cross-tenant binding (defense in depth) yields tenant_scope_mismatch", () => {
    const r = resolveCandidateAgainstBindings(
      materialCandidate(),
      [activeMaterialBinding({ tenant_id: T2 })],
      { now },
    );
    expect(r.status).toBe("tenant_scope_mismatch");
    expect(r.blockers).toContain("TENANT_COMPANY_SCOPE_UNRESOLVED");
  });
});

// --- Candidate update payload --------------------------------------------------

describe("Phase 7.6b resolver — candidate update payload", () => {
  it("resolved → catalog_resolution_status=matched, handoff_allowed=false, status=user_review_required (warnings present)", () => {
    const cand = materialCandidate();
    const r = resolveCandidateAgainstBindings(cand, [activeMaterialBinding()], { now });
    const upd = buildCandidateUpdate(cand, r, NOW);
    expect(upd.catalog_resolution_status).toBe("matched");
    expect(upd.catalog_item_id).toBe(PROD);
    expect(upd.handoff_allowed).toBe(false);
    expect(upd.pricing_status).toBe("cost_unresolved");
    expect(upd.status).toBe("user_review_required");
    expect((upd.metadata as any).resolver_version).toBe(PHASE_7_6B_RESOLVER_VERSION);
    expect((upd.metadata as any).live_handoff_not_enabled_phase_7_6b).toBe(true);
  });

  it("missing → catalog_resolution_status=missing, status=blocked", () => {
    const cand = materialCandidate();
    const r = resolveCandidateAgainstBindings(cand, [], { now });
    const upd = buildCandidateUpdate(cand, r, NOW);
    expect(upd.catalog_resolution_status).toBe("missing");
    expect(upd.status).toBe("blocked");
    expect(upd.handoff_allowed).toBe(false);
    expect(upd.catalog_item_id).toBeNull();
  });

  it("ambiguous → catalog_resolution_status=ambiguous", () => {
    const cand = materialCandidate();
    const r = resolveCandidateAgainstBindings(cand, [
      activeMaterialBinding(),
      activeMaterialBinding({ id: "bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb9", target_item_id: PROD2, deterministic_binding_key: "bpcb|m9" }),
    ], { now });
    const upd = buildCandidateUpdate(cand, r, NOW);
    expect(upd.catalog_resolution_status).toBe("ambiguous");
    expect(upd.handoff_allowed).toBe(false);
  });

  it("never returns ready_for_live_handoff pricing_status", () => {
    const cand = materialCandidate({ pricing_status: "ready_for_live_handoff" });
    const r = resolveCandidateAgainstBindings(cand, [activeMaterialBinding()], { now });
    const upd = buildCandidateUpdate(cand, r, NOW);
    expect(upd.pricing_status).toBe("cost_unresolved");
    expect(upd.pricing_status).not.toBe("ready_for_live_handoff");
    expect(upd.pricing_status).not.toBe("ready_for_pricing_review");
  });

  it("preserves prior metadata keys (provenance, warnings)", () => {
    const cand = materialCandidate({ metadata: { phase: 6, warning_codes: ["MATERIAL_POPULATION_NOT_ENABLED_PHASE_3"], provenance_marker: 1 } });
    const r = resolveCandidateAgainstBindings(cand, [activeMaterialBinding()], { now });
    const upd = buildCandidateUpdate(cand, r, NOW);
    expect((upd.metadata as any).phase).toBe(6);
    expect((upd.metadata as any).warning_codes).toEqual(["MATERIAL_POPULATION_NOT_ENABLED_PHASE_3"]);
    expect((upd.metadata as any).provenance_marker).toBe(1);
    expect((upd.metadata as any).resolver_v2_result).toBeDefined();
  });
});

// --- Review flag specs --------------------------------------------------------

describe("Phase 7.6b resolver — review flag specs", () => {
  it("missing binding emits BLUEPRINT_CATALOG_BINDING_MISSING + CATALOG_UNRESOLVED_LIVE_HANDOFF blockers", () => {
    const cand = materialCandidate();
    const r = resolveCandidateAgainstBindings(cand, [], { now });
    const specs = buildReviewFlagSpecs(cand, r);
    const codes = specs.map((s) => s.flag_code);
    expect(codes).toContain("BLUEPRINT_CATALOG_BINDING_MISSING");
    expect(codes).toContain("CATALOG_UNRESOLVED_LIVE_HANDOFF");
    expect(codes).toContain("PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B");
    expect(codes).toContain("LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6B");
    const blockerSpec = specs.find((s) => s.flag_code === "BLUEPRINT_CATALOG_BINDING_MISSING");
    expect(blockerSpec?.severity).toBe("blocker");
    expect(blockerSpec?.blocking).toBe(true);
    expect(blockerSpec?.metadata.source).toBe("resolver_v2");
  });

  it("resolved candidate only emits warnings, no blockers", () => {
    const cand = materialCandidate();
    const r = resolveCandidateAgainstBindings(cand, [activeMaterialBinding()], { now });
    const specs = buildReviewFlagSpecs(cand, r);
    expect(specs.every((s) => s.severity === "warning")).toBe(true);
  });

  it("dedupes repeated codes per candidate", () => {
    const cand = materialCandidate();
    const r = resolveCandidateAgainstBindings(cand, [], { now });
    const specs = buildReviewFlagSpecs(cand, r);
    const codes = specs.map((s) => s.flag_code);
    const unique = new Set(codes);
    expect(codes.length).toBe(unique.size);
  });

  it("related_entity_type matches source_draft_line_type", () => {
    const matSpec = buildReviewFlagSpecs(materialCandidate(), resolveCandidateAgainstBindings(materialCandidate(), [], { now }));
    const labSpec = buildReviewFlagSpecs(laborCandidate(), resolveCandidateAgainstBindings(laborCandidate(), [], { now }));
    expect(matSpec[0].related_entity_type).toBe("material_draft_line");
    expect(labSpec[0].related_entity_type).toBe("labor_draft_line");
  });
});

// --- Idempotency --------------------------------------------------------------

describe("Phase 7.6b resolver — idempotency", () => {
  it("re-running with same inputs produces byte-stable resolver output", () => {
    const cand = materialCandidate();
    const b = [activeMaterialBinding()];
    const r1 = resolveCandidateAgainstBindings(cand, b, { now });
    const r2 = resolveCandidateAgainstBindings(cand, b, { now });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
  });

  it("re-running produces same review flag specs (no duplicates across runs)", () => {
    const cand = materialCandidate();
    const r1 = resolveCandidateAgainstBindings(cand, [], { now });
    const r2 = resolveCandidateAgainstBindings(cand, [], { now });
    expect(JSON.stringify(buildReviewFlagSpecs(cand, r1))).toEqual(JSON.stringify(buildReviewFlagSpecs(cand, r2)));
  });

  it("changing binding changes resolver output", () => {
    const cand = materialCandidate();
    const r1 = resolveCandidateAgainstBindings(cand, [activeMaterialBinding({ target_item_id: PROD })], { now });
    const r2 = resolveCandidateAgainstBindings(cand, [activeMaterialBinding({ target_item_id: PROD2, deterministic_binding_key: "bpcb|m2" })], { now });
    expect(r1.matched_target_item_id).not.toEqual(r2.matched_target_item_id);
  });
});

// --- No-mutation safety -------------------------------------------------------

describe("Phase 7.6b resolver — no-mutation safety", () => {
  it("does not mutate input candidate", () => {
    const cand = materialCandidate({ metadata: { keep: true } });
    const snapshot = JSON.stringify(cand);
    resolveCandidateAgainstBindings(cand, [activeMaterialBinding()], { now });
    buildCandidateUpdate(cand, resolveCandidateAgainstBindings(cand, [activeMaterialBinding()], { now }), NOW);
    buildReviewFlagSpecs(cand, resolveCandidateAgainstBindings(cand, [activeMaterialBinding()], { now }));
    expect(JSON.stringify(cand)).toEqual(snapshot);
  });

  it("does not mutate input bindings array", () => {
    const bindings = [activeMaterialBinding()];
    const snapshot = JSON.stringify(bindings);
    resolveCandidateAgainstBindings(materialCandidate(), bindings, { now });
    expect(JSON.stringify(bindings)).toEqual(snapshot);
  });
});

// --- Mapper helpers -----------------------------------------------------------

describe("Phase 7.6b resolver — DB mapping helpers", () => {
  it("mapResolverStatusToDbCatalogStatus collapses granular statuses safely", () => {
    expect(mapResolverStatusToDbCatalogStatus("resolved")).toBe("matched");
    expect(mapResolverStatusToDbCatalogStatus("ambiguous")).toBe("ambiguous");
    expect(mapResolverStatusToDbCatalogStatus("unresolved")).toBe("missing");
    expect(mapResolverStatusToDbCatalogStatus("inactive_binding")).toBe("unresolved");
    expect(mapResolverStatusToDbCatalogStatus("unit_mismatch")).toBe("unresolved");
    expect(mapResolverStatusToDbCatalogStatus("missing_labor_rate")).toBe("unresolved");
    expect(mapResolverStatusToDbCatalogStatus("tenant_scope_mismatch")).toBe("unresolved");
    expect(mapResolverStatusToDbCatalogStatus("blocked")).toBe("unresolved");
  });

  it("mapResolverStatusToPricingStatus never returns live-ready values", () => {
    const inputs = [
      "resolved", "unresolved", "ambiguous", "inactive_binding",
      "inactive_target", "unit_mismatch", "missing_labor_rate",
      "tenant_scope_mismatch", "blocked",
    ] as const;
    for (const s of inputs) {
      const v = mapResolverStatusToPricingStatus(s, "quantity_only");
      expect(v).not.toBe("ready_for_live_handoff");
      expect(v).not.toBe("ready_for_pricing_review");
    }
  });
});

// --- Batch summary ------------------------------------------------------------

describe("Phase 7.6b resolver — batch summary", () => {
  it("aggregates counts and flags push_to_estimate disabled", () => {
    const candResolved = materialCandidate({ id: "33333333-3333-3333-3333-333333333334", deterministic_handoff_key: "k2" });
    const candMissing = materialCandidate({ id: "33333333-3333-3333-3333-333333333335", deterministic_handoff_key: "k3" });
    const r1 = resolveCandidateAgainstBindings(candResolved, [activeMaterialBinding()], { now });
    const r2 = resolveCandidateAgainstBindings(candMissing, [], { now });
    const s = summarizeResolverResults([r1, r2]);
    expect(s.resolved).toBe(1);
    expect(s.missing).toBe(1);
    expect(s.handoff_still_blocked).toBe(true);
    expect(s.push_to_estimate_enabled).toBe(false);
    expect(s.push_to_estimate_disabled_reason).toMatch(/Push to Estimate remains disabled/);
  });
});
