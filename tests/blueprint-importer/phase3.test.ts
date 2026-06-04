// Vitest suite for Blueprint Importer v2 — Phase 3 pure contracts.
// Runs deterministic checks on the classifier, parsers, mappers, trade
// detection, and acceptance gates. Does NOT touch the DB.

import { describe, it, expect } from "vitest";
import {
  classifyBlueprintDocument,
  detectTradesFromRoofReport,
  detectTradesFromWallReport,
  mapRoofExtractionToMeasurements,
  mapWallExtractionToMeasurements,
  evaluateTradeAcceptance,
  deterministicSessionHash,
  REVIEW_FLAG_CODES,
} from "../../supabase/functions/_shared/blueprint-importer/index.ts";
import { parseEagleViewWallReport } from "../../supabase/functions/_shared/blueprint-importer/parsers/eagleview-wall.ts";

const ROOFR_FIXTURE = `
Roofr Report
Property Address: 123 Sample St
Total Roof Area: 2,842 SF
Pitched Roof Area: 2,820 SF
Flat Roof Area: 22 SF
Roof Facets: 12
Predominant Pitch: 7/12
Eaves: 180 ft
Rakes: 95 ft
Valleys: 60 ft
Hips: 40 ft
Ridges: 75 ft
Wall Flashing: 12 ft
Step Flashing: 18 ft
Waste Table
0% 2,842 5% 2,984 10% 3,126 15% 3,268
`;

const EV_ROOF_FIXTURE = `
EagleView
Report Number: 1234567
Property Address: 456 Demo Ave
Total Roof Area (sq ft): 3,500
Total Roof Facets: 9
Predominant Pitch: 8/12
Ridges (ft): 110
Hips (ft): 65
Valleys (ft): 80
Rakes (ft): 120
Eaves (ft): 200
Flashing: 25
Step Flashing: 18
Areas per Pitch
4/12 200
6/12 1,200
8/12 2,100
Waste Calculation Table
0% 3,500 3% 3,605 5% 3,675 10% 3,850
`;

const EV_WALL_FIXTURE = `
EagleView Wall Report
Report Number: 7654321
Total Wall Area (sq ft): 4,200
Total Wall Area with Windows & Doors: 4,650
Wall Facets: 11
Top of Walls: 280
Bottom of Walls: 285
Inside Corners: 32
Outside Corners: 48
Fascia (Eaves & Rakes): 320
Windows & Doors Area: 450
Windows & Doors Count: 18
Windows & Doors Perimeter: 220
Wall Area by Direction
North 1100  South 1300  East 900  West 900
Image obstruction noted on west elevation.
Verify in the field — yellow shaded values.
`;

describe("classifier", () => {
  it("detects EagleView roof report", () => {
    const c = classifyBlueprintDocument(EV_ROOF_FIXTURE);
    expect(c.document_type).toBe("eagleview_roof_report");
    expect(c.provider).toBe("eagleview");
    expect(c.db_document_type).toBe("roof_report");
  });
  it("detects Roofr roof report", () => {
    const c = classifyBlueprintDocument(ROOFR_FIXTURE);
    expect(c.document_type).toBe("roofr_roof_report");
    expect(c.db_provider).toBe("roofr");
  });
  it("detects EagleView wall report", () => {
    const c = classifyBlueprintDocument(EV_WALL_FIXTURE);
    expect(c.document_type).toBe("eagleview_wall_report");
    expect(c.db_document_type).toBe("wall_report");
  });
  it("returns unknown on noise", () => {
    expect(classifyBlueprintDocument("Lorem ipsum").document_type).toBe("unknown");
  });
});

describe("EagleView wall parser", () => {
  it("extracts canonical wall fields and review-flag signals", () => {
    const r = parseEagleViewWallReport(EV_WALL_FIXTURE);
    expect(r.data.wall_area_sqft).toBe(4200);
    expect(r.data.wall_area_with_windows_doors_sqft).toBe(4650);
    expect(r.data.wall_facets_count).toBe(11);
    expect(r.data.top_of_walls_lf).toBe(280);
    expect(r.data.fascia_eaves_rake_lf).toBe(320);
    expect(r.data.window_door_area_sqft).toBe(450);
    expect(r.data.window_door_count).toBe(18);
    expect(r.data.has_image_obstruction_warning).toBe(true);
    expect(r.data.has_field_verification_warning).toBe(true);
    expect(r.matched_signal).toBe(true);
  });
});

describe("trade detection", () => {
  it("roofing + gutters from roof report", () => {
    const t = detectTradesFromRoofReport({ total_roof_area_sqft: 2842, eaves_ft: 180, rakes_ft: 95 }, "roofr");
    expect(t.map((x) => x.trade_id).sort()).toEqual(["gutters_fascia_trim", "roofing"]);
  });
  it("siding + paint (derived) + gutters + windows_doors from wall report", () => {
    const t = detectTradesFromWallReport(
      { wall_area_sqft: 4200, window_door_area_sqft: 450, window_door_count: 18, fascia_eaves_rake_lf: 320 },
      "eagleview",
    );
    const ids = t.map((x) => x.trade_id).sort();
    expect(ids).toEqual(["exterior_walls_siding", "gutters_fascia_trim", "paint_coatings", "windows_doors"]);
    const wd = t.find((x) => x.trade_id === "windows_doors")!;
    expect(wd.support_status).toBe("measurement_object_only");
  });
});

describe("measurement mapper", () => {
  it("emits PlanPath per measurement and derives eaves+rakes", () => {
    const mapped = mapRoofExtractionToMeasurements(
      { total_roof_area_sqft: 2842, roof_facets: 12, predominant_pitch: "7/12", eaves_ft: 180, rakes_ft: 95, valleys_ft: 60, hips_ft: 40, ridges_ft: 75, step_flashing_ft: 18 },
      { document_type: "roof_report", provider: "roofr", file_name: "Sample.pdf" },
    );
    expect(mapped.length).toBeGreaterThan(5);
    // PlanPath for every measurement (paired by _plan_path_key)
    for (const m of mapped) {
      expect(m.measurement._plan_path_key).toBe(m.plan_path._plan_path_key);
      expect(m.plan_path.path_type).toBe("report_page");
    }
    const derived = mapped.find((m) => m.measurement.measurement_key === "eaves_plus_rakes_lf");
    expect(derived?.measurement.quantity).toBe(275);
  });
  it("wall mapper categorises windows_doors fields under WD trade", () => {
    const mapped = mapWallExtractionToMeasurements(
      {
        wall_area_sqft: 4200, wall_area_with_windows_doors_sqft: 4650, wall_facets_count: 11,
        top_of_walls_lf: 280, bottom_of_walls_lf: 285, inside_corners_lf: 32, outside_corners_lf: 48,
        inside_corners_gt_90_lf: null, outside_corners_gt_90_lf: null,
        fascia_eaves_rake_lf: 320, window_door_area_sqft: 450, window_door_count: 18, window_door_perimeter_lf: 220,
        wall_area_by_direction: null, wall_area_by_elevation: null, window_door_area_by_elevation: null,
        window_door_perimeter_by_elevation: null, window_door_count_by_elevation: null, wall_waste_table: null,
      },
      { document_type: "wall_report", provider: "eagleview", file_name: "wall.pdf" },
    );
    const wd = mapped.filter((m) => m.measurement.trade_id === "windows_doors").map((m) => m.measurement.measurement_key);
    expect(wd).toContain("window_door_area_sqft");
    expect(wd).toContain("window_door_count");
    expect(wd).toContain("window_door_perimeter_lf");
    const fascia = mapped.find((m) => m.measurement.measurement_key === "fascia_eaves_rake_lf");
    expect(fascia?.measurement.trade_id).toBe("gutters_fascia_trim");
  });
});

describe("acceptance gates", () => {
  const base = { already_accepted_trade_ids: [] as string[], detected_support_status: "mvp_supported", has_exterior_walls_siding_source: false, has_plan_paths_for_trade: true };
  it("accepts roofing", () => {
    expect(evaluateTradeAcceptance({ ...base, trade_id: "roofing" }).ok).toBe(true);
  });
  it("accepts exterior_walls_siding and gutters_fascia_trim", () => {
    expect(evaluateTradeAcceptance({ ...base, trade_id: "exterior_walls_siding" }).ok).toBe(true);
    expect(evaluateTradeAcceptance({ ...base, trade_id: "gutters_fascia_trim" }).ok).toBe(true);
  });
  it("blocks windows_doors as top-level trade", () => {
    const v = evaluateTradeAcceptance({ ...base, trade_id: "windows_doors" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.flag_code).toBe(REVIEW_FLAG_CODES.WINDOWS_DOORS_SELECTED_AS_TRADE);
  });
  it("blocks paint without siding source", () => {
    const v = evaluateTradeAcceptance({ ...base, trade_id: "paint_coatings" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.flag_code).toBe(REVIEW_FLAG_CODES.PAINT_WITHOUT_WALL_SOURCE);
  });
  it("paint accepted when siding source present", () => {
    const v = evaluateTradeAcceptance({ ...base, trade_id: "paint_coatings", has_exterior_walls_siding_source: true });
    expect(v.ok).toBe(true);
  });
  it("blocks future-supported trades without manual_only", () => {
    const v = evaluateTradeAcceptance({ ...base, trade_id: "drywall" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.flag_code).toBe(REVIEW_FLAG_CODES.FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE);
  });
  it("allows future-supported when manual_only requested", () => {
    const v = evaluateTradeAcceptance({ ...base, trade_id: "drywall", requested_review_state: "manual_only" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.review_state).toBe("manual_only");
  });
  it("blocks when PlanPath missing", () => {
    const v = evaluateTradeAcceptance({ ...base, trade_id: "roofing", has_plan_paths_for_trade: false });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.flag_code).toBe(REVIEW_FLAG_CODES.MISSING_PLAN_PATH);
  });
});

describe("deterministic session hash", () => {
  it("produces stable hashes for equivalent inputs irrespective of key order", async () => {
    const h1 = await deterministicSessionHash({ tenant_id: "t", document_type: "roof_report", provider: "roofr", normalized_extraction: { a: 1, b: 2 } });
    const h2 = await deterministicSessionHash({ tenant_id: "t", document_type: "roof_report", provider: "roofr", normalized_extraction: { b: 2, a: 1 } });
    expect(h1).toBe(h2);
    const h3 = await deterministicSessionHash({ tenant_id: "t", document_type: "roof_report", provider: "roofr", normalized_extraction: { a: 1, b: 3 } });
    expect(h3).not.toBe(h1);
  });
});
