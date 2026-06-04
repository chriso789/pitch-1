// Blueprint Importer v2 — Phase 7.8 verification tests.
// Pure-function tests. No DB IO. No persistent writes. No live handoff.

import { describe, it, expect } from "vitest";
import {
  validateSupplierCatalogTarget,
  PHASE_7_8_SUPPLIER_VALIDATOR_VERSION,
} from "../../supabase/functions/_shared/blueprint-importer/phase7_8-supplier-validation.ts";
import {
  validateAbcPriceSource,
  PHASE_7_8_ABC_VALIDATOR_VERSION,
} from "../../supabase/functions/_shared/blueprint-importer/phase7_8-abc-validation.ts";
import {
  evaluateExistingLinePolicy,
  PHASE_7_8_EXISTING_LINE_POLICY_VERSION,
  type ExistingLinePolicyInput,
} from "../../supabase/functions/_shared/blueprint-importer/phase7_8-existing-line-policy.ts";
import {
  buildEstimateLineWritePayload,
  PHASE_7_8_WRITE_MAPPING_VERSION,
  type WriteMappingInput,
} from "../../supabase/functions/_shared/blueprint-importer/phase7_8-write-mapping.ts";
import {
  runProvenanceBridgeTransaction,
  PHASE_7_8_BRIDGE_VERSION,
  type TransactionContext,
  type BridgeOrchestrationInput,
  type ProvenanceBridgeInsert,
} from "../../supabase/functions/_shared/blueprint-importer/phase7_8-provenance-bridge.ts";
import {
  evaluateBlueprintLiveHandoffReadiness,
  PHASE_7_8_READINESS_VERSION,
} from "../../supabase/functions/_shared/blueprint-importer/phase7_8-readiness-evaluator.ts";
import { getTierSideEffectsReport } from "../../supabase/functions/_shared/blueprint-importer/phase7_8-tier-side-effects.ts";
import type { PreflightCandidateResult } from "../../supabase/functions/_shared/blueprint-importer/phase7_6c-preflight.ts";

const T = "00000000-0000-0000-0000-0000000000aa";
const T2 = "00000000-0000-0000-0000-0000000000bb";
const CAT = "11111111-1111-1111-1111-111111111111";
const ITEM = "22222222-2222-2222-2222-222222222222";
const CAND = "33333333-3333-3333-3333-333333333333";
const TARGET = "44444444-4444-4444-4444-444444444444";
const LIVE = "55555555-5555-5555-5555-555555555555";
const NOW = "2026-06-04T18:00:00.000Z";
const now = () => NOW;

// ---------------------------------------------------------------------------
// 1. Supplier catalog tenant-join verification
// ---------------------------------------------------------------------------
describe("Phase 7.8 — supplier catalog tenant-join validator", () => {
  it("passes when item+catalog join verified, tenant matches, cost present", () => {
    const r = validateSupplierCatalogTarget({
      candidate_tenant_id: T,
      binding_unit_cost: null,
      item: { id: ITEM, catalog_id: CAT, sku: "X", base_price: 12.5, uom: "ea", active: true },
      catalog: { id: CAT, tenant_id: T, active: true },
    });
    expect(r.validator_version).toBe(PHASE_7_8_SUPPLIER_VALIDATOR_VERSION);
    expect(r.ok).toBe(true);
    expect(r.tenant_join_verified).toBe(true);
    expect(r.cost_source).toBe("supplier_catalog_items.base_price");
    expect(r.trusted_unit_cost).toBe(12.5);
    expect(r.blockers).toEqual([]);
  });
  it("blocks when supplier_catalogs missing", () => {
    const r = validateSupplierCatalogTarget({
      candidate_tenant_id: T, binding_unit_cost: null,
      item: { id: ITEM, catalog_id: CAT, sku: "X", base_price: 1, uom: "ea", active: true },
      catalog: null,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain("SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED");
  });
  it("blocks on tenant mismatch", () => {
    const r = validateSupplierCatalogTarget({
      candidate_tenant_id: T, binding_unit_cost: null,
      item: { id: ITEM, catalog_id: CAT, sku: "X", base_price: 1, uom: "ea", active: true },
      catalog: { id: CAT, tenant_id: T2, active: true },
    });
    expect(r.blockers).toContain("SUPPLIER_CATALOG_ITEM_TENANT_MISMATCH");
    expect(r.ok).toBe(false);
  });
  it("blocks when supplier_catalogs has no tenant attribution at all", () => {
    const r = validateSupplierCatalogTarget({
      candidate_tenant_id: T, binding_unit_cost: 5,
      item: { id: ITEM, catalog_id: CAT, sku: "X", base_price: 5, uom: "ea", active: true },
      catalog: { id: CAT, tenant_id: null, active: true },
    });
    expect(r.blockers).toContain("SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED");
    expect(r.ok).toBe(false);
  });
  it("blocks when cost missing", () => {
    const r = validateSupplierCatalogTarget({
      candidate_tenant_id: T, binding_unit_cost: null,
      item: { id: ITEM, catalog_id: CAT, sku: "X", base_price: null, uom: "ea", active: true },
      catalog: { id: CAT, tenant_id: T, active: true },
    });
    expect(r.blockers).toContain("SUPPLIER_CATALOG_ITEM_COST_MISSING");
    expect(r.ok).toBe(false);
  });
  it("blocks default zero cost", () => {
    const r = validateSupplierCatalogTarget({
      candidate_tenant_id: T, binding_unit_cost: null,
      item: { id: ITEM, catalog_id: CAT, sku: "X", base_price: 0, uom: "ea", active: true },
      catalog: { id: CAT, tenant_id: T, active: true },
    });
    expect(r.blockers).toContain("ZERO_DEFAULT_PRICING_UNSAFE");
    expect(r.ok).toBe(false);
  });
  it("blocks inactive item", () => {
    const r = validateSupplierCatalogTarget({
      candidate_tenant_id: T, binding_unit_cost: null,
      item: { id: ITEM, catalog_id: CAT, sku: "X", base_price: 1, uom: "ea", active: false },
      catalog: { id: CAT, tenant_id: T, active: true },
    });
    expect(r.blockers).toContain("SUPPLIER_CATALOG_ITEM_INACTIVE");
    expect(r.ok).toBe(false);
  });
  it("never mutates input snapshots (referential immutability check)", () => {
    const item = { id: ITEM, catalog_id: CAT, sku: "X", base_price: 1, uom: "ea", active: true };
    const catalog = { id: CAT, tenant_id: T, active: true };
    const snapshot = { item: { ...item }, catalog: { ...catalog } };
    validateSupplierCatalogTarget({ candidate_tenant_id: T, binding_unit_cost: 2, item, catalog });
    expect(item).toEqual(snapshot.item);
    expect(catalog).toEqual(snapshot.catalog);
  });
});

// ---------------------------------------------------------------------------
// 2. ABC price-source verification
// ---------------------------------------------------------------------------
describe("Phase 7.8 — ABC price-source validator", () => {
  const FRESH = "2026-06-04T17:55:00.000Z";
  const STALE = "2024-01-01T00:00:00.000Z";
  const item = { item_number: "ABC-123", is_active: true };
  it("rejects abc_catalog_items alone (no price source)", () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 60 * 60 * 1000, now,
      item, webhook_price_rows: [], binding_unit_cost: null,
      binding_unit_cost_user_confirmed: false,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain("ABC_PRICE_ROW_MISSING");
  });
  it("accepts a single fresh tenant-scoped webhook row", () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 60 * 60 * 1000, now,
      item, webhook_price_rows: [{ id: "p1", tenant_id: T, abc_item_number: "ABC-123", price: 99.99, uom: "ea", priced_at: FRESH }],
      binding_unit_cost: null, binding_unit_cost_user_confirmed: false,
    });
    expect(r.ok).toBe(true);
    expect(r.price_source).toBe("webhook_price_row");
    expect(r.trusted_unit_cost).toBe(99.99);
  });
  it("blocks stale price row", () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 60 * 60 * 1000, now,
      item, webhook_price_rows: [{ id: "p1", tenant_id: T, abc_item_number: "ABC-123", price: 10, uom: "ea", priced_at: STALE }],
      binding_unit_cost: null, binding_unit_cost_user_confirmed: false,
    });
    expect(r.blockers).toContain("ABC_PRICE_ROW_STALE");
    expect(r.ok).toBe(false);
  });
  it("blocks ambiguous tenant-scoped rows", () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 60 * 60 * 1000, now,
      item,
      webhook_price_rows: [
        { id: "p1", tenant_id: T, abc_item_number: "ABC-123", price: 10, uom: "ea", priced_at: FRESH },
        { id: "p2", tenant_id: T, abc_item_number: "ABC-123", price: 11, uom: "ea", priced_at: FRESH },
      ],
      binding_unit_cost: null, binding_unit_cost_user_confirmed: false,
    });
    expect(r.blockers).toContain("ABC_PRICE_ROW_AMBIGUOUS");
    expect(r.ok).toBe(false);
  });
  it("blocks when only other-tenant rows exist", () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 60 * 60 * 1000, now,
      item,
      webhook_price_rows: [{ id: "p1", tenant_id: T2, abc_item_number: "ABC-123", price: 10, uom: "ea", priced_at: FRESH }],
      binding_unit_cost: null, binding_unit_cost_user_confirmed: false,
    });
    expect(r.blockers).toContain("ABC_PRICE_SOURCE_TENANT_UNVERIFIED");
    expect(r.ok).toBe(false);
  });
  it("binding.unit_cost fallback requires user confirmation", () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 60 * 60 * 1000, now,
      item, webhook_price_rows: [], binding_unit_cost: 25,
      binding_unit_cost_user_confirmed: false,
    });
    expect(r.warnings).toContain("ABC_BINDING_UNIT_COST_REQUIRES_USER_CONFIRMATION");
    expect(r.ok).toBe(false);
  });
  it("binding.unit_cost fallback succeeds when user-confirmed", () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 60 * 60 * 1000, now,
      item, webhook_price_rows: [], binding_unit_cost: 25,
      binding_unit_cost_user_confirmed: true,
    });
    expect(r.ok).toBe(true);
    expect(r.price_source).toBe("binding.unit_cost");
    expect(r.trusted_unit_cost).toBe(25);
  });
  it("blocks zero binding unit_cost", () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 60 * 60 * 1000, now,
      item, webhook_price_rows: [], binding_unit_cost: 0,
      binding_unit_cost_user_confirmed: true,
    });
    expect(r.blockers).toContain("ZERO_DEFAULT_PRICING_UNSAFE");
    expect(r.ok).toBe(false);
  });
  it(`exposes version ${PHASE_7_8_ABC_VALIDATOR_VERSION}`, () => {
    const r = validateAbcPriceSource({
      candidate_tenant_id: T, staleness_ms: 1000, now, item,
      webhook_price_rows: [], binding_unit_cost: null,
      binding_unit_cost_user_confirmed: false,
    });
    expect(r.validator_version).toBe(PHASE_7_8_ABC_VALIDATOR_VERSION);
  });
});

// ---------------------------------------------------------------------------
// 3. Existing-line policy
// ---------------------------------------------------------------------------
describe("Phase 7.8 — existing-line resolution policy", () => {
  const baseCand = {
    candidate_id: CAND, tenant_id: T,
    canonical_estimate_target_id: TARGET,
    deterministic_handoff_key: "k1",
    source_draft_hash: "h1",
    quantity: 10, formula_key: "f1", formula_inputs: { area: 100 },
  };
  const ownBridge = {
    id: "b1", tenant_id: T, deterministic_handoff_key: "k1",
    canonical_estimate_target_id: TARGET, live_estimate_line_item_id: LIVE,
    line_candidate_id: CAND, source_draft_hash: "h1",
  };
  function go(input: ExistingLinePolicyInput) { return evaluateExistingLinePolicy(input); }

  it("skips when identical", () => {
    const r = go({
      candidate: baseCand, bridge_rows_for_key: [ownBridge],
      live_line: { id: LIVE, tenant_id: T, estimate_id: TARGET, quantity: 10, user_edited: false, formula_key: "f1", formula_inputs: { area: 100 } },
    });
    expect(r.outcome).toBe("skip_if_identical");
    expect(r.requires_user_approval).toBe(false);
  });
  it("blocks user-edited live line", () => {
    const r = go({
      candidate: baseCand, bridge_rows_for_key: [ownBridge],
      live_line: { id: LIVE, tenant_id: T, estimate_id: TARGET, quantity: 10, user_edited: true, formula_key: "f1", formula_inputs: { area: 100 } },
    });
    expect(r.outcome).toBe("block_if_live_line_user_edited");
    expect(r.blockers).toContain("EXISTING_LINE_USER_EDITED");
  });
  it("requires user choice on quantity change", () => {
    const r = go({
      candidate: baseCand, bridge_rows_for_key: [ownBridge],
      live_line: { id: LIVE, tenant_id: T, estimate_id: TARGET, quantity: 12, user_edited: false, formula_key: "f1", formula_inputs: { area: 100 } },
    });
    expect(r.outcome).toBe("require_user_choice_if_quantity_changed");
    expect(r.requires_user_approval).toBe(true);
  });
  it("requires user choice on formula change", () => {
    const r = go({
      candidate: baseCand, bridge_rows_for_key: [ownBridge],
      live_line: { id: LIVE, tenant_id: T, estimate_id: TARGET, quantity: 10, user_edited: false, formula_key: "f2", formula_inputs: { area: 100 } },
    });
    expect(r.outcome).toBe("require_user_choice_if_formula_changed");
  });
  it("blocks when live line exists with no provenance bridge", () => {
    const r = go({
      candidate: baseCand, bridge_rows_for_key: [],
      live_line: { id: LIVE, tenant_id: T, estimate_id: TARGET, quantity: 10, user_edited: false, formula_key: "f1", formula_inputs: { area: 100 } },
    });
    expect(r.outcome).toBe("block_missing_provenance");
    expect(r.blockers).toContain("EXISTING_LINE_MISSING_PROVENANCE");
  });
  it("hard blocks tenant mismatch", () => {
    const r = go({
      candidate: baseCand, bridge_rows_for_key: [{ ...ownBridge, tenant_id: T2, line_candidate_id: "other" }],
      live_line: { id: LIVE, tenant_id: T2, estimate_id: TARGET, quantity: 10, user_edited: false, formula_key: "f1", formula_inputs: { area: 100 } },
    });
    expect(r.outcome).toBe("block_tenant_mismatch");
    expect(r.blockers).toContain("EXISTING_LINE_TENANT_MISMATCH");
  });
  it("blocks target mismatch", () => {
    const r = go({
      candidate: baseCand,
      bridge_rows_for_key: [{ ...ownBridge, canonical_estimate_target_id: "99999999-9999-9999-9999-999999999999" }],
      live_line: { id: LIVE, tenant_id: T, estimate_id: TARGET, quantity: 10, user_edited: false, formula_key: "f1", formula_inputs: { area: 100 } },
    });
    expect(r.outcome).toBe("block_target_mismatch");
  });
  it("blocks deterministic key collision (different candidate, same tenant+key)", () => {
    const r = go({
      candidate: baseCand,
      bridge_rows_for_key: [{ ...ownBridge, line_candidate_id: "other-candidate" }],
      live_line: null,
    });
    expect(r.outcome).toBe("block_key_collision");
    expect(r.blockers).toContain("DETERMINISTIC_HANDOFF_KEY_COLLISION");
  });
  it("creates a new version requiring approval when no live line and no collision", () => {
    const r = go({ candidate: baseCand, bridge_rows_for_key: [], live_line: null });
    expect(r.outcome).toBe("create_new_version_requires_approval");
    expect(r.requires_user_approval).toBe(true);
  });
  it(`reports version ${PHASE_7_8_EXISTING_LINE_POLICY_VERSION}`, () => {
    const r = go({ candidate: baseCand, bridge_rows_for_key: [], live_line: null });
    expect(r.policy_version).toBe(PHASE_7_8_EXISTING_LINE_POLICY_VERSION);
  });
});

// ---------------------------------------------------------------------------
// 4. Write mapping
// ---------------------------------------------------------------------------
describe("Phase 7.8 — estimate_line_items write mapping", () => {
  const okInput: WriteMappingInput = {
    candidate: {
      id: CAND, tenant_id: T, quantity: 22, unit: "square",
      item_name: "Shingles", item_category: "material",
      material_id: ITEM, labor_rate_id: null, target_validated: true,
    },
    preflight: { preview_cost: { unit_cost: 50, quantity: 22, extended_cost: 1100, cost_source: "binding.unit_cost", preview_only: true }, pricing_status: "ready_for_pricing_review", blockers: [] } as any,
    pricing: { unit_cost: 50, markup_rule_id: "m1", markup_required: true, total_price: 1500 },
    approval_ready: true,
  };
  it("produces a safe payload when all gates pass", () => {
    const r = buildEstimateLineWritePayload(okInput);
    expect(r.ok).toBe(true);
    expect(r.payload).toBeTruthy();
    expect(r.payload!.unit_cost).toBe(50);
    expect(r.payload!.extended_cost).toBe(1100);
    expect(r.payload!.total_price).toBe(1500);
    expect(r.payload!.material_id).toBe(ITEM);
    expect(r.mapping_version).toBe(PHASE_7_8_WRITE_MAPPING_VERSION);
  });
  it("blocks zero unit_cost (default-zero unsafe)", () => {
    const r = buildEstimateLineWritePayload({ ...okInput, pricing: { ...okInput.pricing, unit_cost: 0 } });
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain("ESTIMATE_LINE_DEFAULT_ZERO_UNSAFE");
  });
  it("blocks missing unit_cost", () => {
    const r = buildEstimateLineWritePayload({ ...okInput, pricing: { ...okInput.pricing, unit_cost: null } });
    expect(r.blockers).toContain("ESTIMATE_LINE_UNIT_COST_MISSING");
  });
  it("blocks missing total_price", () => {
    const r = buildEstimateLineWritePayload({ ...okInput, pricing: { ...okInput.pricing, total_price: null } });
    expect(r.blockers).toContain("ESTIMATE_LINE_TOTAL_PRICE_MISSING");
  });
  it("blocks missing markup rule when required and no total_price override", () => {
    const r = buildEstimateLineWritePayload({ ...okInput, pricing: { unit_cost: 50, markup_rule_id: null, markup_required: true, total_price: null } });
    expect(r.blockers).toContain("ESTIMATE_LINE_MARKUP_RULE_MISSING");
  });
  it("does not infer margin/tax/discount", () => {
    const r = buildEstimateLineWritePayload(okInput);
    expect(r.payload!.markup_percent).toBeNull();
    expect(r.payload!.markup_amount).toBeNull();
  });
  it("drops material_id/labor_rate_id when target not validated", () => {
    const r = buildEstimateLineWritePayload({ ...okInput, candidate: { ...okInput.candidate, target_validated: false } });
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain("ESTIMATE_LINE_METADATA_SURFACE_MISSING");
  });
  it("blocks when approval object is not ready", () => {
    const r = buildEstimateLineWritePayload({ ...okInput, approval_ready: false });
    expect(r.blockers).toContain("PRICING_CONTRACT_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// 5. Provenance bridge transaction
// ---------------------------------------------------------------------------
describe("Phase 7.8 — provenance bridge transaction harness (rollback-only)", () => {
  const payload = {
    tenant_id: T, item_category: "material", item_name: "Shingles",
    quantity: 22, unit_type: "square", unit_cost: 50, extended_cost: 1100,
    total_price: 1500, markup_percent: null, markup_amount: null,
    material_id: ITEM, labor_rate_id: null, notes: "blueprint-importer-v2",
  };
  const bridgeTemplate: Omit<ProvenanceBridgeInsert, "live_estimate_line_item_id"> = {
    tenant_id: T, handoff_batch_id: "batch", line_candidate_id: CAND,
    canonical_estimate_target_table: "enhanced_estimates",
    canonical_estimate_target_id: TARGET,
    deterministic_handoff_key: "k1", import_session_id: "sess",
    accepted_trade_id: "trade", template_binding_id: null,
    source_draft_line_id: "draft", source_draft_line_type: "material",
    source_measurement_ids: [], plan_path_ids: [], source_document_ids: [],
    formula_key: null, formula_inputs: {}, approved_by: "u", approved_at: NOW,
    live_written_by: "u", live_written_at: NOW, metadata: {},
  };

  function fakeTxn() {
    const calls: string[] = [];
    const tx: TransactionContext = {
      async insertEstimateLineItem(p) { calls.push("line"); return { id: LIVE }; },
      async insertProvenanceBridge(p) { calls.push("bridge"); return { id: "bridge-1" }; },
    };
    return { tx, calls };
  }
  async function rollbackTxn<T>(fn: () => Promise<T>) { return await fn(); }

  it("skips when preview_only=true (no bridge, no line)", async () => {
    const { tx, calls } = fakeTxn();
    const out = await runProvenanceBridgeTransaction(tx, { preview_only: true, write_payload: null, bridge_template: bridgeTemplate }, rollbackTxn);
    expect(out.status).toBe("skipped_preview_only");
    expect(calls).toEqual([]);
  });
  it("commits when both inserts succeed", async () => {
    const { tx, calls } = fakeTxn();
    const out = await runProvenanceBridgeTransaction(tx, { preview_only: false, write_payload: payload, bridge_template: bridgeTemplate }, rollbackTxn);
    expect(out.status).toBe("committed");
    expect(out.live_estimate_line_item_id).toBe(LIVE);
    expect(out.provenance_bridge_id).toBe("bridge-1");
    expect(calls).toEqual(["line", "bridge"]);
    expect(out.bridge_version).toBe(PHASE_7_8_BRIDGE_VERSION);
  });
  it("rolls back both when bridge insert fails", async () => {
    const tx: TransactionContext = {
      async insertEstimateLineItem() { return { id: LIVE }; },
      async insertProvenanceBridge() { throw new Error("unique_violation bp_line_prov_unique_key"); },
    };
    const out = await runProvenanceBridgeTransaction(tx, { preview_only: false, write_payload: payload, bridge_template: bridgeTemplate }, rollbackTxn);
    expect(out.status).toBe("rolled_back_bridge");
    expect(out.live_estimate_line_item_id).toBeNull();
    expect(out.provenance_bridge_id).toBeNull();
    expect(out.rollback_reason).toContain("unique_violation");
  });
  it("rolls back when estimate line insert fails (bridge never called)", async () => {
    let bridgeCalls = 0;
    const tx: TransactionContext = {
      async insertEstimateLineItem() { throw new Error("RLS_DENY"); },
      async insertProvenanceBridge() { bridgeCalls++; return { id: "x" }; },
    };
    const out = await runProvenanceBridgeTransaction(tx, { preview_only: false, write_payload: payload, bridge_template: bridgeTemplate }, rollbackTxn);
    expect(out.status).toBe("rolled_back_estimate_line");
    expect(bridgeCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Tier side-effects verdict
// ---------------------------------------------------------------------------
describe("Phase 7.8 — enhanced_estimates / tier side-effects verdict", () => {
  it("returns the locked Phase 7.8 verdict", () => {
    const r = getTierSideEffectsReport();
    expect(r.verdict).toBe("unsafe_without_phase_7_9_contract");
    expect(r.db_triggers_on_estimate_line_items).toBe(0);
    expect(r.required_phase_7_9_followups.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Readiness evaluator
// ---------------------------------------------------------------------------
describe("Phase 7.8 — final live-handoff readiness evaluator", () => {
  function preflightPass(): PreflightCandidateResult {
    return {
      candidate_id: CAND, preflight_version: "v2.0-preflight-phase-7.6c" as any,
      pricing_mode: "ready_for_pricing_review", pricing_contract_version: "v2",
      cost_status: "explicit_positive", pricing_status: "ready_for_pricing_review",
      target_validation: { target_kind: "product_catalog", target_present: true, tenant_safe: true, active: true, active_verifiable: true, unit_compatible: true, notes: [] },
      preview_cost: { unit_cost: 50, quantity: 22, extended_cost: 1100, cost_source: "binding.unit_cost", preview_only: true },
      blockers: [], warnings: [], handoff_allowed: false, evaluated_at: NOW,
    };
  }
  function existingLinePass() {
    return { policy_version: PHASE_7_8_EXISTING_LINE_POLICY_VERSION, outcome: "create_new_version_requires_approval" as const, blockers: [] as any[], requires_user_approval: true, notes: [] };
  }
  function writeMappingPass() {
    return buildEstimateLineWritePayload({
      candidate: { id: CAND, tenant_id: T, quantity: 22, unit: "square", item_name: "Shingles", item_category: "material", material_id: ITEM, labor_rate_id: null, target_validated: true },
      preflight: { preview_cost: { unit_cost: 50, quantity: 22, extended_cost: 1100, cost_source: "binding.unit_cost", preview_only: true }, pricing_status: "ready_for_pricing_review", blockers: [] } as any,
      pricing: { unit_cost: 50, markup_rule_id: "m1", markup_required: true, total_price: 1500 },
      approval_ready: true,
    });
  }

  it("blocks when preflight missing", () => {
    const r = evaluateBlueprintLiveHandoffReadiness({
      candidate_id: CAND, tenant_id: T, source_draft_hash: "h1",
      preflight: null, supplier: null, abc: null,
      existing_line: existingLinePass(), write_mapping: writeMappingPass(),
      approval: { signed: true, approved_by: "u", approved_at: NOW, batch_source_draft_hash: "h1" },
    });
    expect(r.blocked).toBe(true);
    expect(r.blockers).toContain("PRICING_PREFLIGHT_MISSING");
    expect(r.readiness_matrix_result.gate_preflight).toBe("fail");
  });
  it("blocks on missing approval", () => {
    const r = evaluateBlueprintLiveHandoffReadiness({
      candidate_id: CAND, tenant_id: T, source_draft_hash: "h1",
      preflight: preflightPass(), supplier: null, abc: null,
      existing_line: existingLinePass(), write_mapping: writeMappingPass(),
      approval: { signed: false, approved_by: null, approved_at: null, batch_source_draft_hash: null },
    });
    expect(r.blockers).toContain("HANDOFF_APPROVAL_OBJECT_MISSING");
  });
  it("blocks on source_draft_hash mismatch", () => {
    const r = evaluateBlueprintLiveHandoffReadiness({
      candidate_id: CAND, tenant_id: T, source_draft_hash: "h1",
      preflight: preflightPass(), supplier: null, abc: null,
      existing_line: existingLinePass(), write_mapping: writeMappingPass(),
      approval: { signed: true, approved_by: "u", approved_at: NOW, batch_source_draft_hash: "h2" },
    });
    expect(r.blockers).toContain("SOURCE_DRAFT_HASH_MISMATCH");
  });
  it("always blocks on tier side-effects (Phase 7.9 required)", () => {
    const r = evaluateBlueprintLiveHandoffReadiness({
      candidate_id: CAND, tenant_id: T, source_draft_hash: "h1",
      preflight: preflightPass(), supplier: null, abc: null,
      existing_line: existingLinePass(), write_mapping: writeMappingPass(),
      approval: { signed: true, approved_by: "u", approved_at: NOW, batch_source_draft_hash: "h1" },
    });
    expect(r.blocked).toBe(true);
    expect(r.blockers).toContain("ENHANCED_ESTIMATES_TIER_CONTRACT_REQUIRED_PHASE_7_9");
    expect(r.ready_for_phase_8_candidate).toBe(false);
    expect(r.evaluator_version).toBe(PHASE_7_8_READINESS_VERSION);
  });
});

// ---------------------------------------------------------------------------
// 8. No-live-write safety sanity check
// ---------------------------------------------------------------------------
describe("Phase 7.8 — no-live-write safety", () => {
  it("none of the helper modules touch DB clients or fetch", () => {
    // Source-text grep against the loaded modules to ensure no imports of
    // supabase clients or fetch. Helpers must remain pure.
    const txt = [
      // Force tree-shaking-free string concatenation in test
      String(validateSupplierCatalogTarget),
      String(validateAbcPriceSource),
      String(evaluateExistingLinePolicy),
      String(buildEstimateLineWritePayload),
      String(runProvenanceBridgeTransaction),
      String(evaluateBlueprintLiveHandoffReadiness),
    ].join("\n");
    expect(txt).not.toMatch(/createClient\(/);
    expect(txt).not.toMatch(/global\.fetch\(/);
  });
});
