import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSafeRoofingTakeoff } from "./blueprint-roofing-engine.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";

const viewport: DrawingViewport = {
  viewport_key: "roof-v1",
  page_number: 1,
  title: "ROOF PLAN",
  scale: { raw: '1/4" = 1\'-0"', kind: "architectural", paper_inches: 0.25, real_feet: 1, ratio: null, feet_per_paper_inch: 4 },
  bbox: { x: 0, y: 0, width: 500, height: 500 },
  confidence: 0.95,
  source: "title_scale_cluster",
  metadata: { version: "test", title_item_text: "ROOF PLAN", scale_item_text: '1/4" = 1\'-0"' },
};

const page: PdfLayoutPage = {
  page_number: 1,
  width_points: 500,
  height_points: 500,
  rotation_deg: 0,
  text_items: [{ text: "ROOF PLAN", x: 20, y: 20, width: 100, height: 12, rotation_deg: 0, font_name: "Test" }],
  text: "ROOF PLAN",
  has_selectable_text: true,
  vector_extraction_status: "deferred",
};

Deno.test("safe roofing engine does not add outline area when facets exist", () => {
  const square = [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }];
  const result = buildSafeRoofingTakeoff({
    import_session_id: "session",
    source_document_id: "source",
    pages: [page],
    viewports_by_page: { 1: [viewport] },
    geometry_evidence: [
      { page_number: 1, viewport_key: "roof-v1", geometry_class: "outline", points: square, confidence: 0.9, source: "f1_calibrated_geometry" },
      { page_number: 1, viewport_key: "roof-v1", geometry_class: "facet", points: square, confidence: 0.95, source: "f1_calibrated_geometry" },
    ],
  });

  assertEquals(result.measurements.find((m) => m.measurement_key === "total_roof_area_sqft")?.quantity, 16);
  assert(result.review_flags.some((f) => f.flag_code === "ROOF_OUTLINE_AREA_SUPERSEDED_BY_FACETS"));
});
