import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRoofingTakeoff } from "./blueprint-roofing-takeoff.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";
import type { BlueprintSpecCandidate } from "./blueprint-spec-intelligence.ts";

function item(text: string, x: number, y: number, width = 80, height = 12) {
  return { text, x, y, width, height, rotation_deg: 0, font_name: "Test" };
}

const viewport: DrawingViewport = {
  viewport_key: "p1-roof",
  page_number: 1,
  title: "ROOF PLAN",
  scale: {
    raw: '1/4" = 1\'-0"',
    kind: "architectural",
    paper_inches: 0.25,
    real_feet: 1,
    ratio: null,
    feet_per_paper_inch: 4,
  },
  bbox: { x: 0, y: 0, width: 600, height: 500 },
  confidence: 0.95,
  source: "title_scale_cluster",
  metadata: { version: "test", title_item_text: "ROOF PLAN", scale_item_text: '1/4" = 1\'-0"' },
};

const page: PdfLayoutPage = {
  page_number: 1,
  width_points: 600,
  height_points: 500,
  rotation_deg: 0,
  text_items: [
    item("ROOF PLAN", 20, 20),
    item("RD-1", 100, 100),
    item("RD-2", 200, 100),
    item("SCUPPER", 300, 100),
    item("RTU-1", 400, 100),
    item("SLOPE 1/4:12", 100, 150, 120),
  ],
  vector_segments: [],
  text: "ROOF PLAN RD-1 RD-2 SCUPPER RTU-1 SLOPE 1/4:12",
  has_selectable_text: true,
  vector_extraction_status: "completed",
};

const roofSpec: BlueprintSpecCandidate = {
  page_number: 1,
  viewport_key: "p1-roof",
  category: "roofing",
  key_name: "roof_membrane",
  value_text: "60 MIL TPO",
  normalized_value: { thickness_mil: 60, membrane_type: "TPO" },
  confidence: 0.94,
  source_text: "60 MIL TPO",
  bbox: { x: 50, y: 200, width: 100, height: 12 },
  metadata: { version: "test", source: "pdf_text", requires_review: true },
};

Deno.test("roofing engine emits calibrated area, edges, counts, pitch and specs", () => {
  const result = buildRoofingTakeoff({
    import_session_id: "session-1",
    source_document_id: "source-1",
    file_name: "plans.pdf",
    pages: [page],
    viewports_by_page: new Map([[1, [viewport]]]),
    specification_candidates: [roofSpec],
    geometry_evidence: [
      {
        page_number: 1,
        viewport_key: "p1-roof",
        geometry_class: "facet",
        points: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }],
        confidence: 0.96,
        source: "f1_calibrated_geometry",
      },
      {
        page_number: 1,
        viewport_key: "p1-roof",
        geometry_class: "eave",
        points: [{ x: 0, y: 80 }, { x: 180, y: 80 }],
        length_ft: 10,
        confidence: 0.95,
        source: "f1_calibrated_geometry",
      },
    ],
  });

  assertEquals(result.summary.roof_area_sqft, 16);
  assertEquals(result.measurements.find((m) => m.measurement_key === "eaves_lf")?.quantity, 10);
  assertEquals(result.measurements.find((m) => m.measurement_key === "drains_count")?.quantity, 2);
  assertEquals(result.measurements.find((m) => m.measurement_key === "scuppers_count")?.quantity, 1);
  assertEquals(result.measurements.find((m) => m.measurement_key === "curbs_count")?.quantity, 1);
  assertEquals(result.measurements.find((m) => m.measurement_key === "predominant_pitch")?.quantity, 0.25);
  assertEquals(result.specifications[0].spec_key, "roof_membrane");
  assert(!result.review_flags.some((flag) => flag.flag_code === "ROOF_AREA_NOT_AVAILABLE"));
  assert(result.plan_paths.length > 0);
});

Deno.test("roofing engine blocks area when viewport scale is absent", () => {
  const unscaled = { ...viewport, scale: null };
  const result = buildRoofingTakeoff({
    import_session_id: "session-2",
    source_document_id: "source-2",
    pages: [page],
    viewports_by_page: { 1: [unscaled] },
    geometry_evidence: [{
      page_number: 1,
      viewport_key: "p1-roof",
      geometry_class: "facet",
      points: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }],
      confidence: 0.95,
      source: "f1_calibrated_geometry",
    }],
  });

  assertEquals(result.measurements.find((m) => m.measurement_key === "total_roof_area_sqft"), undefined);
  assert(result.review_flags.some((flag) => flag.flag_code === "ROOF_AREA_SCALE_REQUIRED" && flag.blocking));
  assert(result.review_flags.some((flag) => flag.flag_code === "ROOF_AREA_NOT_AVAILABLE" && flag.blocking));
});
