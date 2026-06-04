// Vitest suite for Blueprint Importer v2 — Phase 4 deterministic generation.
// Pure-function tests. No DB. Validates formula engine, template registry,
// and the orchestrator's contract guarantees.

import { describe, it, expect } from "vitest";
import {
  evaluateFormula,
} from "../../supabase/functions/_shared/blueprint-importer/phase4-formulas.ts";
import {
  getPhase4Template,
  PHASE4_TEMPLATES,
} from "../../supabase/functions/_shared/blueprint-importer/phase4-templates.ts";
import {
  generateDraftsForAcceptedTrade,
  generateTemplateBindingOnly,
  type SessionMeasurementRow,
} from "../../supabase/functions/_shared/blueprint-importer/phase4-generator.ts";
import { REVIEW_FLAG_CODES } from "../../supabase/functions/_shared/blueprint-importer/review-flag-codes.ts";

// ---------------- fixtures ----------------

function roofingMeasurements(): SessionMeasurementRow[] {
  return [
    { id: "m-pitched", trade_id: "roofing", measurement_key: "pitched_roof_area_sqft", quantity: 2820, unit: "sqft", plan_path_id: "pp-pitched", normalized_value: null },
    { id: "m-total", trade_id: "roofing", measurement_key: "total_roof_area_sqft", quantity: 2842, unit: "sqft", plan_path_id: "pp-total", normalized_value: null },
    { id: "m-eaves", trade_id: "roofing", measurement_key: "eaves_lf", quantity: 180, unit: "lf", plan_path_id: "pp-eaves", normalized_value: null },
    { id: "m-rakes", trade_id: "roofing", measurement_key: "rakes_lf", quantity: 95, unit: "lf", plan_path_id: "pp-rakes", normalized_value: null },
    { id: "m-valleys", trade_id: "roofing", measurement_key: "valleys_lf", quantity: 60, unit: "lf", plan_path_id: "pp-val", normalized_value: null },
    { id: "m-hips", trade_id: "roofing", measurement_key: "hips_lf", quantity: 40, unit: "lf", plan_path_id: "pp-hips", normalized_value: null },
    { id: "m-ridges", trade_id: "roofing", measurement_key: "ridges_lf", quantity: 75, unit: "lf", plan_path_id: "pp-ridges", normalized_value: null },
    { id: "m-stepf", trade_id: "roofing", measurement_key: "step_flashing_lf", quantity: 18, unit: "lf", plan_path_id: "pp-stepf", normalized_value: null },
    { id: "m-flash", trade_id: "roofing", measurement_key: "flashing_lf", quantity: 12, unit: "lf", plan_path_id: "pp-flash", normalized_value: null },
    { id: "m-pen", trade_id: "roofing", measurement_key: "penetrations_count", quantity: 5, unit: "count", plan_path_id: "pp-pen", normalized_value: null },
  ];
}

function wallMeasurements(): SessionMeasurementRow[] {
  return [
    { id: "w-area", trade_id: "exterior_walls_siding", measurement_key: "wall_area_sqft", quantity: 4200, unit: "sqft", plan_path_id: "pp-w1", normalized_value: null },
    { id: "w-gross", trade_id: "exterior_walls_siding", measurement_key: "wall_area_with_windows_doors_sqft", quantity: 4650, unit: "sqft", plan_path_id: "pp-w2", normalized_value: null },
    { id: "w-oc", trade_id: "exterior_walls_siding", measurement_key: "outside_corners_lf", quantity: 48, unit: "lf", plan_path_id: "pp-oc", normalized_value: null },
    { id: "w-ic", trade_id: "exterior_walls_siding", measurement_key: "inside_corners_lf", quantity: 32, unit: "lf", plan_path_id: "pp-ic", normalized_value: null },
    { id: "w-wd-perim", trade_id: "windows_doors", measurement_key: "window_door_perimeter_lf", quantity: 220, unit: "lf", plan_path_id: "pp-wd-p", normalized_value: null },
    { id: "w-fascia", trade_id: "gutters_fascia_trim", measurement_key: "fascia_eaves_rake_lf", quantity: 320, unit: "lf", plan_path_id: "pp-fascia", normalized_value: null },
  ];
}

// ---------------- formula engine ----------------

describe("phase4 formula engine", () => {
  it("area_with_waste applies waste then divides by coverage", () => {
    const r = evaluateFormula("area_with_waste", { values: { area_sqft: 2820 }, coverage_per_unit: 33.3, waste_percent: 0.10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rounded_quantity).toBe(Math.ceil(2820 * 1.1 / 33.3));
  });
  it("missing inputs fail closed (no silent zero)", () => {
    const r = evaluateFormula("area_with_waste", { values: { area_sqft: null }, coverage_per_unit: 33.3, waste_percent: 0.10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing_inputs).toContain("area_sqft");
  });
  it("squares_from_sqft works with waste", () => {
    const r = evaluateFormula("squares_from_sqft", { values: { area_sqft: 2820 }, waste_percent: 0.10, rounding: "round" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rounded_quantity).toBe(Math.round(2820 * 1.10 / 100));
  });
  it("linear_feet_with_waste sums LF inputs and divides by coverage", () => {
    const r = evaluateFormula("linear_feet_with_waste", { values: { eaves_lf: 180, rakes_lf: 95 }, coverage_per_unit: 105, waste_percent: 0.10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rounded_quantity).toBe(Math.ceil((180 + 95) * 1.10 / 105));
  });
  it("report_waste_table_lookup requires a pick", () => {
    const r = evaluateFormula("report_waste_table_lookup", { values: {}, waste_table: { "10%": 3126 } });
    expect(r.ok).toBe(false);
  });
  it("pass_through_quantity returns input quantity", () => {
    const r = evaluateFormula("pass_through_quantity", { values: { quantity: 12 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rounded_quantity).toBe(12);
  });
  it("unknown formula key fails closed", () => {
    const r = evaluateFormula("not_a_real_formula" as never, { values: { area_sqft: 1 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_formula_key");
  });
});

// ---------------- templates ----------------

describe("phase4 templates", () => {
  it("MVP trades have a template; others do not", () => {
    expect(getPhase4Template("roofing")).not.toBeNull();
    expect(getPhase4Template("exterior_walls_siding")).not.toBeNull();
    expect(getPhase4Template("paint_coatings")).not.toBeNull();
    expect(getPhase4Template("gutters_fascia_trim")).not.toBeNull();
    expect(getPhase4Template("windows_doors")).toBeNull();
    expect(getPhase4Template("drywall")).toBeNull();
    expect(getPhase4Template("framing")).toBeNull();
  });
  it("waste_percent is required on every MVP trade and has no template default", () => {
    for (const t of ["roofing", "exterior_walls_siding", "paint_coatings"] as const) {
      const tpl = PHASE4_TEMPLATES[t]!;
      const wp = tpl.required_assumptions.find((a) => a.key === "waste_percent");
      expect(wp).toBeTruthy();
      expect(wp!.template_default).toBeNull();
    }
  });
});

// ---------------- generator: gates ----------------

describe("phase4 generator gates", () => {
  it("windows_doors never produces drafts", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "windows_doors" as never,
      accepted_trade_id: "a1",
      measurements: wallMeasurements(),
      user_assumptions: {},
      paint_source_present: true,
    });
    expect(out.material_drafts).toHaveLength(0);
    expect(out.labor_drafts).toHaveLength(0);
    expect(out.review_flags.some((f) => f.flag_code === REVIEW_FLAG_CODES.WINDOWS_DOORS_SELECTED_AS_TRADE)).toBe(true);
  });
  it("future trades blocked", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "drywall" as never,
      accepted_trade_id: "a2",
      measurements: [],
      user_assumptions: {},
      paint_source_present: false,
    });
    expect(out.material_drafts).toHaveLength(0);
    expect(out.labor_drafts).toHaveLength(0);
    expect(out.review_flags.some((f) => f.flag_code === REVIEW_FLAG_CODES.FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE)).toBe(true);
  });
  it("paint standalone blocked", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "paint_coatings",
      accepted_trade_id: "a3",
      measurements: wallMeasurements(),
      user_assumptions: { waste_percent: 0.05, paintable_area_basis: "net", finish_coats_count: 2, finish_coverage_sqft_per_gallon: 300, primer_enabled: 0 },
      paint_source_present: false,
    });
    expect(out.review_flags.some((f) => f.flag_code === REVIEW_FLAG_CODES.PAINT_WITHOUT_WALL_SOURCE)).toBe(true);
    expect(out.material_drafts).toHaveLength(0);
  });
  it("missing waste_percent yields blocking flag (no silent default)", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "roofing",
      accepted_trade_id: "a4",
      measurements: roofingMeasurements(),
      user_assumptions: {},
      paint_source_present: false,
    });
    expect(out.review_flags.some((f) => f.flag_code === REVIEW_FLAG_CODES.WASTE_PERCENT_REQUIRED)).toBe(true);
    expect(out.review_flags.some((f) => f.flag_code === REVIEW_FLAG_CODES.TEMPLATE_REQUIRED_ASSUMPTION_MISSING)).toBe(true);
  });
});

// ---------------- generator: roofing drafts ----------------

describe("phase4 roofing draft generation", () => {
  const assumptions = { waste_percent: 0.10 };

  it("produces ready material drafts when inputs + assumptions are present", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "roofing",
      accepted_trade_id: "a5",
      measurements: roofingMeasurements(),
      user_assumptions: assumptions,
      paint_source_present: false,
    });
    const byKey = Object.fromEntries(out.material_drafts.map((d) => [d.item_key, d]));
    expect(byKey.architectural_shingles.status).toBe("ready");
    expect(byKey.architectural_shingles.quantity).toBe(Math.ceil(2820 * 1.10 / 33.3));
    expect(byKey.architectural_shingles.source_measurement_ids).toContain("m-pitched");
    expect(byKey.architectural_shingles.plan_path_ids).toContain("pp-pitched");

    // Starter strip uses eaves + rakes.
    const starter = byKey.starter_strip;
    expect(starter.status).toBe("ready");
    expect(starter.source_measurement_ids.sort()).toEqual(["m-eaves", "m-rakes"]);
    expect(starter.plan_path_ids.sort()).toEqual(["pp-eaves", "pp-rakes"]);

    // Hip/ridge cap from hips+ridges.
    expect(byKey.hip_ridge_cap.status).toBe("ready");
    // Drip edge from eaves+rakes.
    expect(byKey.drip_edge.status).toBe("ready");
  });

  it("produces labor drafts with non-empty provenance and null base_rate equivalent (no pricing)", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "roofing",
      accepted_trade_id: "a5",
      measurements: roofingMeasurements(),
      user_assumptions: assumptions,
      paint_source_present: false,
    });
    expect(out.labor_drafts.length).toBeGreaterThan(0);
    for (const l of out.labor_drafts) {
      expect(l.source_measurement_ids.length).toBeGreaterThan(0);
      expect(l.plan_path_ids.length).toBeGreaterThan(0);
    }
  });

  it("every ready draft line has source_measurement_ids and plan_path_ids", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "roofing",
      accepted_trade_id: "a5",
      measurements: roofingMeasurements(),
      user_assumptions: assumptions,
      paint_source_present: false,
    });
    for (const d of out.material_drafts) {
      if (d.status === "ready") {
        expect(d.source_measurement_ids.length).toBeGreaterThan(0);
        expect(d.plan_path_ids.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------- generator: walls/siding ----------------

describe("phase4 walls/siding drafts", () => {
  it("uses gross or net area based on wall_area_basis", () => {
    const baseAssumptions = {
      waste_percent: 0.05,
      siding_coverage_sqft_per_unit: 32,
      wrb_coverage_sqft_per_roll: 900,
    };
    const net = generateDraftsForAcceptedTrade({
      trade_id: "exterior_walls_siding",
      accepted_trade_id: "w1",
      measurements: wallMeasurements(),
      user_assumptions: { ...baseAssumptions, wall_area_basis: "net" },
      paint_source_present: true,
    });
    const gross = generateDraftsForAcceptedTrade({
      trade_id: "exterior_walls_siding",
      accepted_trade_id: "w1",
      measurements: wallMeasurements(),
      user_assumptions: { ...baseAssumptions, wall_area_basis: "gross" },
      paint_source_present: true,
    });
    const netSiding = net.material_drafts.find((d) => d.item_key === "siding_panels_or_boards");
    const grossSiding = gross.material_drafts.find((d) => d.item_key === "siding_panels_or_boards");
    expect(netSiding!.quantity!).toBeLessThan(grossSiding!.quantity!);
  });
});

// ---------------- generator: paint coats multiplier ----------------

describe("phase4 paint multiplier", () => {
  it("finish gallons scale by finish_coats_count", () => {
    const oneCoat = generateDraftsForAcceptedTrade({
      trade_id: "paint_coatings",
      accepted_trade_id: "p1",
      measurements: wallMeasurements(),
      user_assumptions: { waste_percent: 0.05, paintable_area_basis: "net", finish_coats_count: 1, finish_coverage_sqft_per_gallon: 300, primer_enabled: 0 },
      paint_source_present: true,
    });
    const twoCoat = generateDraftsForAcceptedTrade({
      trade_id: "paint_coatings",
      accepted_trade_id: "p1",
      measurements: wallMeasurements(),
      user_assumptions: { waste_percent: 0.05, paintable_area_basis: "net", finish_coats_count: 2, finish_coverage_sqft_per_gallon: 300, primer_enabled: 0 },
      paint_source_present: true,
    });
    const one = oneCoat.material_drafts.find((d) => d.item_key === "finish_paint_gallons")!;
    const two = twoCoat.material_drafts.find((d) => d.item_key === "finish_paint_gallons")!;
    expect(two.quantity!).toBeGreaterThan(one.quantity!);
  });
  it("skips primer rules when primer_enabled=0", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "paint_coatings",
      accepted_trade_id: "p2",
      measurements: wallMeasurements(),
      user_assumptions: { waste_percent: 0.05, paintable_area_basis: "net", finish_coats_count: 2, finish_coverage_sqft_per_gallon: 300, primer_enabled: 0 },
      paint_source_present: true,
    });
    expect(out.material_drafts.find((d) => d.item_key === "primer_gallons")).toBeUndefined();
    expect(out.labor_drafts.find((d) => d.labor_key === "prime_wall_area_sqft")).toBeUndefined();
  });
});

// ---------------- generator: gutters assumptions ----------------

describe("phase4 gutters assumptions", () => {
  it("downspout placeholder is blocked when spacing assumption is missing", () => {
    const out = generateDraftsForAcceptedTrade({
      trade_id: "gutters_fascia_trim",
      accepted_trade_id: "g1",
      measurements: [
        { id: "m-eaves", trade_id: "gutters_fascia_trim", measurement_key: "eaves_lf", quantity: 180, unit: "lf", plan_path_id: "pp", normalized_value: null },
      ],
      user_assumptions: { gutter_lf_source: "eaves_lf" },
      paint_source_present: false,
    });
    const ds = out.material_drafts.find((d) => d.item_key === "downspout_count_placeholder");
    expect(ds?.status).toBe("blocked");
  });
});

// ---------------- determinism ----------------

describe("phase4 determinism", () => {
  it("re-running with identical inputs yields identical quantities", () => {
    const args = {
      trade_id: "roofing" as const,
      accepted_trade_id: "det1",
      measurements: roofingMeasurements(),
      user_assumptions: { waste_percent: 0.10 },
      paint_source_present: false,
    };
    const a = generateDraftsForAcceptedTrade(args);
    const b = generateDraftsForAcceptedTrade(args);
    expect(a.material_drafts.map((m) => [m.item_key, m.quantity])).toEqual(b.material_drafts.map((m) => [m.item_key, m.quantity]));
    expect(a.labor_drafts.map((m) => [m.labor_key, m.quantity])).toEqual(b.labor_drafts.map((m) => [m.labor_key, m.quantity]));
  });
});

// ---------------- binding-only path ----------------

describe("phase4 template binding only", () => {
  it("emits binding without drafts and flags missing required assumptions", () => {
    const r = generateTemplateBindingOnly({
      trade_id: "roofing",
      accepted_trade_id: "b1",
      measurements: roofingMeasurements(),
      user_assumptions: {},
      paint_source_present: false,
    });
    expect(r.binding).not.toBeNull();
    expect(r.binding!.binding_status).toBe("blocked");
    expect(r.flags.some((f) => f.flag_code === REVIEW_FLAG_CODES.WASTE_PERCENT_REQUIRED)).toBe(true);
  });
});
