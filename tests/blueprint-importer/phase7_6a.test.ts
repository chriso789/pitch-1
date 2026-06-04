// Phase 7.6a — Catalog binding schema + resolver v2 contract tests.
// Pure functions, no DB.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  createDeterministicBindingKey,
  validateBindingShape,
  validateBindingTenantScope,
  validateBindingTradeAllowed,
  validateBindingUnitCompatibility,
  validateBindingActiveForResolver,
  summarizeBindingTarget,
  assertBindingCanResolveCandidate,
  type BlueprintCatalogBinding,
} from "../../supabase/functions/_shared/blueprint-importer/catalog-bindings.ts";

const T = "00000000-0000-0000-0000-0000000000aa";
const T2 = "00000000-0000-0000-0000-0000000000bb";
const P = "11111111-1111-1111-1111-111111111111";
const L = "22222222-2222-2222-2222-222222222222";

function activeMaterialBinding(over: Partial<BlueprintCatalogBinding> = {}): BlueprintCatalogBinding {
  return {
    id: "33333333-3333-3333-3333-333333333301",
    tenant_id: T,
    binding_scope: "tenant",
    binding_type: "material",
    trade_id: "roofing",
    source_candidate_type: "material",
    source_item_key: "shingles_architectural_30yr",
    source_unit: "square",
    target_kind: "product_catalog",
    target_table: "product_catalog",
    target_item_id: P,
    target_unit: "square",
    unit_conversion_rule: {},
    pricing_source_type: "catalog_cost",
    cost_source_type: "catalog",
    status: "active",
    resolver_priority: 100,
    match_confidence: 0.99,
    requires_user_confirmation: false,
    deterministic_binding_key: "bpcb|x",
    metadata: {},
    ...over,
  } as BlueprintCatalogBinding;
}

describe("Phase 7.6a — deterministic binding key", () => {
  const baseArgs = {
    tenant_id: T,
    trade_id: "roofing",
    source_candidate_type: "material" as const,
    source_item_key: "shingles_architectural_30yr",
    source_unit: "square",
    target_kind: "product_catalog" as const,
    target_table: "product_catalog" as const,
    target_item_id: P,
    target_unit: "square",
  };
  it("is stable for the same inputs", () => {
    expect(createDeterministicBindingKey(baseArgs)).toBe(createDeterministicBindingKey({ ...baseArgs }));
  });
  it("changes when source_item_key changes", () => {
    expect(createDeterministicBindingKey(baseArgs))
      .not.toBe(createDeterministicBindingKey({ ...baseArgs, source_item_key: "other_key" }));
  });
  it("changes when source_unit changes", () => {
    expect(createDeterministicBindingKey(baseArgs))
      .not.toBe(createDeterministicBindingKey({ ...baseArgs, source_unit: "bundle" }));
  });
  it("changes when target_item_id changes", () => {
    expect(createDeterministicBindingKey(baseArgs))
      .not.toBe(createDeterministicBindingKey({ ...baseArgs, target_item_id: L }));
  });
  it("changes when target_kind changes", () => {
    expect(createDeterministicBindingKey(baseArgs))
      .not.toBe(createDeterministicBindingKey({ ...baseArgs, target_kind: "abc_catalog_item" }));
  });
});

describe("Phase 7.6a — shape + tenant + trade validators", () => {
  it("windows_doors is rejected as standalone trade", () => {
    const r = validateBindingShape(activeMaterialBinding({ trade_id: "windows_doors" }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("windows_doors_cannot_be_standalone_binding");
  });
  it("future_supported trade cannot be active", () => {
    const r = validateBindingTradeAllowed(activeMaterialBinding({ trade_id: "drywall", status: "active" }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("future_supported_trade_cannot_be_active_binding");
  });
  it("future_supported trade is fine in draft", () => {
    const r = validateBindingTradeAllowed(activeMaterialBinding({ trade_id: "drywall", status: "draft" }));
    expect(r.ok).toBe(true);
  });
  it("tenant scope mismatch is blocked", () => {
    const r = validateBindingTenantScope(activeMaterialBinding(), T2);
    expect(r.ok).toBe(false);
  });
  it("match_confidence out of range fails shape", () => {
    const r = validateBindingShape(activeMaterialBinding({ match_confidence: 1.5 }));
    expect(r.errors).toContain("match_confidence_out_of_range");
  });
});

describe("Phase 7.6a — unit compatibility + active-for-resolver", () => {
  it("equal units pass", () => {
    expect(validateBindingUnitCompatibility(activeMaterialBinding()).ok).toBe(true);
  });
  it("mismatched units without conversion rule fail", () => {
    const r = validateBindingUnitCompatibility(activeMaterialBinding({ target_unit: "bundle" }));
    expect(r.ok).toBe(false);
  });
  it("mismatched units with conversion rule pass", () => {
    const r = validateBindingUnitCompatibility(activeMaterialBinding({ target_unit: "bundle", unit_conversion_rule: { ratio: 3 } }));
    expect(r.ok).toBe(true);
  });
  it("unresolved target blocks resolver", () => {
    const r = validateBindingActiveForResolver(activeMaterialBinding({ target_kind: "unresolved" }));
    expect(r.ok).toBe(false);
  });
  it("custom_line_disabled target blocks resolver", () => {
    const r = validateBindingActiveForResolver(activeMaterialBinding({ target_kind: "custom_line_disabled" }));
    expect(r.ok).toBe(false);
  });
  it("inactive status blocks resolver", () => {
    const r = validateBindingActiveForResolver(activeMaterialBinding({ status: "inactive" }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("binding_not_active");
  });
  it("labor binding without labor_rate_id blocks resolver", () => {
    const r = validateBindingActiveForResolver(activeMaterialBinding({
      source_candidate_type: "labor", target_kind: "labor_rate", target_table: "labor_rates",
      target_item_id: null, labor_rate_id: null,
    }));
    expect(r.errors).toContain("labor_binding_requires_labor_rate_id");
  });
  it("active material binding with target_item_id passes", () => {
    expect(validateBindingActiveForResolver(activeMaterialBinding()).ok).toBe(true);
  });
  it("summarizeBindingTarget reports kind", () => {
    expect(summarizeBindingTarget(activeMaterialBinding())).toContain("product_catalog");
  });
});

describe("Phase 7.6a — assertBindingCanResolveCandidate", () => {
  const candidate = {
    tenant_id: T,
    trade_id: "roofing",
    source_item_key: "shingles_architectural_30yr",
    source_candidate_type: "material" as const,
    source_unit: "square",
  };
  it("passes for matching active binding", () => {
    expect(assertBindingCanResolveCandidate(activeMaterialBinding(), candidate).ok).toBe(true);
  });
  it("fails on tenant mismatch", () => {
    const r = assertBindingCanResolveCandidate(activeMaterialBinding({ tenant_id: T2 }), candidate);
    expect(r.blockers).toContain("TENANT_COMPANY_SCOPE_UNRESOLVED");
  });
  it("fails on item_key mismatch", () => {
    const r = assertBindingCanResolveCandidate(activeMaterialBinding({ source_item_key: "other" }), candidate);
    expect(r.blockers).toContain("BLUEPRINT_CATALOG_BINDING_MISSING");
  });
  it("fails on unit mismatch", () => {
    const r = assertBindingCanResolveCandidate(activeMaterialBinding({ target_unit: "bundle" }), candidate);
    expect(r.blockers).toContain("BLUEPRINT_CATALOG_UNIT_MISMATCH");
  });
  it("labor candidate without labor_rate_id flags blocker", () => {
    const r = assertBindingCanResolveCandidate(
      activeMaterialBinding({
        source_candidate_type: "labor", target_kind: "labor_rate", target_table: "labor_rates",
        target_item_id: null, labor_rate_id: null,
      }),
      { ...candidate, source_candidate_type: "labor" },
    );
    expect(r.blockers).toContain("BLUEPRINT_LABOR_RATE_MISSING");
  });
});

describe("Phase 7.6a — examples conform to schema (smoke)", () => {
  const dir = "docs/examples/blueprint-importer/catalog-bindings";
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  it("has 12 example files", () => {
    expect(files.length).toBe(12);
  });
  for (const f of files) {
    it(`${f} has required keys`, () => {
      const obj = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      for (const k of [
        "id","tenant_id","binding_scope","binding_type","trade_id",
        "source_candidate_type","source_item_key","source_unit","target_kind",
        "pricing_source_type","cost_source_type","status",
        "resolver_priority","match_confidence","requires_user_confirmation",
        "deterministic_binding_key","metadata",
      ]) {
        expect(obj).toHaveProperty(k);
      }
      expect(obj.trade_id).not.toBe("windows_doors");
      expect(obj.match_confidence).toBeGreaterThanOrEqual(0);
      expect(obj.match_confidence).toBeLessThanOrEqual(1);
    });
  }
});
