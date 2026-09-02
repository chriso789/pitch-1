import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildBlueprintF1RuntimeFromLayout } from "./blueprint-f1-runtime.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";

function item(text: string, x: number, y: number, width = 90, height = 10) {
  return { text, x, y, width, height, rotation_deg: 0, font_name: "Test" };
}

function page(page_number: number, text_items: PdfLayoutPage["text_items"]): PdfLayoutPage {
  return {
    page_number,
    width_points: 1000,
    height_points: 700,
    rotation_deg: 0,
    text_items,
    vector_segments: [],
    text: text_items.map((entry) => entry.text).join(" "),
    has_selectable_text: true,
    vector_extraction_status: "completed",
  };
}

Deno.test("F1 runtime emits coordinate-aware page persistence rows", () => {
  const layout = {
    page_count: 1,
    version: "f1-layout-v1",
    pages: [page(1, [
      item("ROOF PLAN", 100, 100),
      item('SCALE 1/4" = 1\'-0"', 120, 140),
      item("A2.1", 850, 640),
      item("ROOF PLAN", 750, 610, 140),
    ])],
  };

  const result = buildBlueprintF1RuntimeFromLayout(layout);
  assertEquals(result.page_count, 1);
  assertEquals(result.pages[0].sheet_number, "A2.1");
  assertEquals(result.pages[0].width_points, 1000);
  assertEquals(result.pages[0].layout_version, "f1-layout-v1");
  assertEquals(result.pages[0].layout_json.vector_extraction_status, "completed");
  assert(result.pages[0].layout_json.text_items.length >= 4);
});

Deno.test("F1 runtime marks indexed sheets missing when absent from the PDF", () => {
  const cover = page(1, [
    item("COVER SHEET DRAWING INDEX", 50, 50, 220),
    item("A1.0", 80, 200, 45), item("FLOOR PLAN", 150, 200, 100),
    item("A2.0", 80, 230, 45), item("ROOF PLAN", 150, 230, 100),
    item("G0.0", 850, 640, 45), item("COVER SHEET", 740, 610, 120),
  ]);
  const floor = page(2, [
    item("FLOOR PLAN", 80, 80, 100),
    item("A1.0", 850, 640, 45), item("FLOOR PLAN", 740, 610, 100),
  ]);

  const result = buildBlueprintF1RuntimeFromLayout({ page_count: 2, version: "f1-layout-v1", pages: [cover, floor] });
  assert(result.missing_indexed_sheets.includes("A2.0"));
  const missing = result.sheet_index_entries.find((entry) => entry.sheet_number === "A2.0");
  assertEquals(missing?.status, "missing");
  assertEquals(missing?.metadata.present_in_document, false);
  assertEquals(result.requires_review, true);
});

Deno.test("F1 runtime keeps image-only pages review-gated", () => {
  const scanned = page(1, []);
  scanned.has_selectable_text = false;
  const result = buildBlueprintF1RuntimeFromLayout({ page_count: 1, version: "f1-layout-v1", pages: [scanned] });
  assertEquals(result.summary.image_only_page_count, 1);
  assertEquals(result.requires_review, true);
});
