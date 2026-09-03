import { describe, expect, it } from "vitest";
import { synthesizeTradeTakeoff } from "../../supabase/functions/_shared/blueprint-importer/trade-takeoff-synthesis.ts";

const m = (id: string, key: string, quantity: number, unit: string, trade_id = "roofing") => ({
  id,
  trade_id,
  measurement_key: key,
  quantity,
  unit,
  confidence: 0.9,
  plan_path_id: `path-${id}`,
});

describe("trade takeoff synthesis", () => {
  it("derives roof squares and edge totals only from normalized source measurements", () => {
    const out = synthesizeTradeTakeoff({
      trade_id: "roofing",
      measurements: [
        m("a", "pitched_roof_area_sqft", 2500, "sqft"),
        m("b", "eaves_lf", 140, "lf"),
        m("c", "rakes_lf", 60, "lf"),
        m("d", "hips_lf", 45, "lf"),
        m("e", "ridges_lf", 35, "lf"),
      ],
      assumptions: { waste_percent: 0.1 },
    });
    expect(out.calculations.roof_squares).toBe(25);
    expect(out.calculations.waste_adjusted_roof_squares).toBeCloseTo(27.5);
    expect(out.calculations.eaves_plus_rakes_lf).toBe(200);
    expect(out.calculations.hips_plus_ridges_lf).toBe(80);
    expect(out.source_plan_path_ids).toContain("path-a");
  });

  it("blocks asphalt-shingle material generation when the drawing explicitly specifies tile", () => {
    const out = synthesizeTradeTakeoff({
      trade_id: "roofing",
      measurements: [m("a", "pitched_roof_area_sqft", 2500, "sqft")],
      materials: [{ material: "roof tile", specification: "new tile roof to match existing", brand_explicit: false }],
    });
    expect(out.template_compatible).toBe(false);
    expect(out.template_block_reason).toBe("explicit_roof_system_conflicts_with_asphalt_shingle_template");
    expect(out.status).toBe("blocked");
  });

  it("blocks generic siding material generation for explicit three-coat stucco", () => {
    const out = synthesizeTradeTakeoff({
      trade_id: "exterior_walls_siding",
      measurements: [m("w", "wall_area_sqft", 1800, "sqft", "exterior_walls_siding")],
      materials: [{ material: "stucco", specification: "three-coat stucco over self-furring metal lath", brand_explicit: false }],
    });
    expect(out.template_compatible).toBe(false);
    expect(out.template_block_reason).toBe("explicit_stucco_or_eifs_system_requires_trade_specific_template");
    expect(out.status).toBe("blocked");
  });

  it("keeps windows and doors measurement-only even with valid measurements", () => {
    const out = synthesizeTradeTakeoff({
      trade_id: "windows_doors",
      measurements: [m("wd", "vision.windows_doors.window_count.p2.1", 12, "count", "windows_doors")],
    });
    expect(out.status).toBe("manual_only");
    expect(out.warnings).toContain("measurement_object_only_trade");
  });

  it("does not invent a waste factor", () => {
    const out = synthesizeTradeTakeoff({
      trade_id: "roofing",
      measurements: [m("a", "pitched_roof_area_sqft", 2500, "sqft")],
    });
    expect(out.calculations.waste_adjusted_roof_squares).toBeUndefined();
    expect(out.warnings).toContain("waste_percent_not_resolved");
  });
});
