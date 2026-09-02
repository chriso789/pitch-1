import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractBlueprintSpecifications } from "./blueprint-spec-intelligence.ts";
import { calibratePolygonArea, calibrateSegmentLength, extractDimensionCandidates, parseDimensionFeet } from "./blueprint-dimensions.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";

function item(text: string, x: number, y: number, width = 160, height = 12) {
  return { text, x, y, width, height, rotation_deg: 0, font_name: "Test" };
}

const viewport: DrawingViewport = {
  viewport_key: "p1-v1",
  page_number: 1,
  title: "ROOF PLAN",
  scale: { raw: '1/4" = 1\'-0"', kind: "architectural", paper_inches: 0.25, real_feet: 1, ratio: null, feet_per_paper_inch: 4 },
  bbox: { x: 0, y: 0, width: 600, height: 500 },
  confidence: 0.9,
  source: "title_scale_cluster",
  metadata: { version: "test", title_item_text: "ROOF PLAN", scale_item_text: '1/4" = 1\'-0"' },
};

function page(items: PdfLayoutPage["text_items"]): PdfLayoutPage {
  return { page_number: 1, width_points: 1000, height_points: 700, rotation_deg: 0, text_items: items, vector_segments: [], text: items.map(i => i.text).join(" "), has_selectable_text: true, vector_extraction_status: "completed" };
}

Deno.test("F1E extracts normalized roofing and wall specs", () => {
  const specs = extractBlueprintSpecifications(page([
    item("60 MIL TPO", 100, 100),
    item("FULLY ADHERED ROOF SYSTEM", 100, 130),
    item('5/8" TYPE X GYPSUM BOARD', 100, 160),
    item("4000 PSI CONCRETE", 100, 190),
  ]), [viewport]);
  assertEquals(specs.find(s => s.key_name === "roof_membrane")?.normalized_value.membrane_type, "TPO");
  assertEquals(specs.find(s => s.key_name === "roof_system_type")?.normalized_value.attachment_method, "fully_adhered");
  assertEquals(specs.find(s => s.key_name === "gypsum_board")?.normalized_value.type_x, true);
  assertEquals(specs.find(s => s.key_name === "concrete_strength")?.normalized_value.compressive_strength_psi, 4000);
  assert(specs.every(s => s.metadata.requires_review));
});

Deno.test("F1F parses explicit dimensions", () => {
  assertEquals(parseDimensionFeet("12'-6\""), 12.5);
  assertEquals(parseDimensionFeet('6"'), 0.5);
  const dims = extractDimensionCandidates(page([item("12'-6\"", 100, 100), item('SCALE 1/4" = 1\'-0"', 100, 130)]), [viewport]);
  assertEquals(dims.length, 1);
  assertEquals(dims[0].normalized_feet, 12.5);
});

Deno.test("F1F requires viewport scale for calibrated length", () => {
  const line = calibrateSegmentLength({ page_number: 1, viewport, start: { x: 0, y: 0 }, end: { x: 72, y: 0 } });
  assertEquals(line?.length_ft, 4);
  const noScale = { ...viewport, scale: null };
  assertEquals(calibrateSegmentLength({ page_number: 1, viewport: noScale, start: { x: 0, y: 0 }, end: { x: 72, y: 0 } }), null);
});

Deno.test("F1F calibrates polygon area only from known architectural scale", () => {
  const area = calibratePolygonArea({ viewport, points: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }] });
  assertEquals(area?.area_sqft, 16);
});
