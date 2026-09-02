import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildBlueprintF1RuntimeFromLayout } from "./blueprint-f1-runtime.ts";
import { buildSafeRoofingTakeoff } from "./blueprint-roofing-engine.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";

function item(text: string, x: number, y: number, width = 120, height = 12) {
  return { text, x, y, width, height, rotation_deg: 0, font_name: "Test" };
}

Deno.test("F1 runtime feeds review-safe roofing engine end to end", () => {
  const page: PdfLayoutPage = {
    page_number: 1,
    width_points: 1000,
    height_points: 700,
    rotation_deg: 0,
    text_items: [
      item("ROOF PLAN", 100, 90, 140),
      item('SCALE 1/8" = 1\'-0"', 105, 120, 160),
      item("60 MIL TPO", 120, 180, 120),
      item("SLOPE 1/4 / 12", 120, 215, 120),
      item("RD-1", 160, 260, 45),
      item("A2.1", 850, 640, 50),
      item("ROOF PLAN", 740, 610, 120),
    ],
    text: "ROOF PLAN SCALE 1/8\" = 1'-0\" 60 MIL TPO SLOPE 1/4 / 12 RD-1 A2.1 ROOF PLAN",
    has_selectable_text: true,
    vector_extraction_status: "deferred",
  };

  const f1 = buildBlueprintF1RuntimeFromLayout({ page_count: 1, version: "f1-layout-v1", pages: [page] });
  assertEquals(f1.page_count, 1);
  assert(f1.viewports_by_page[1]?.length > 0);
  assert(f1.specifications.some((spec) => spec.key_name === "roof_membrane"));

  const roofing = buildSafeRoofingTakeoff({
    import_session_id: "00000000-0000-0000-0000-000000000001",
    source_document_id: "00000000-0000-0000-0000-000000000002",
    file_name: "roof-plan.pdf",
    pages: f1.layout_pages,
    viewports_by_page: f1.viewports_by_page,
    specification_candidates: f1.specifications,
    geometry_evidence: [],
  });

  assert(roofing.measurements.some((m) => m.measurement_key === "drains_count" && m.quantity === 1));
  assert(roofing.measurements.some((m) => m.measurement_key === "predominant_pitch"));
  assert(roofing.specifications.some((spec) => spec.spec_key === "roof_membrane"));
  assert(roofing.plan_paths.length >= 3);
  assert(roofing.review_flags.some((flag) => flag.flag_code === "ROOF_AREA_NOT_AVAILABLE" && flag.blocking));
  assertEquals(roofing.summary.roof_area_sqft, null);
});
