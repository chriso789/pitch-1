import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectDrawingReferences, detectDrawingViewports } from "./blueprint-viewports.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";

function item(text: string, x: number, y: number, width = 100, height = 12) {
  return { text, x, y, width, height, rotation_deg: 0, font_name: "Test" };
}

function makePage(items: PdfLayoutPage["text_items"]): PdfLayoutPage {
  return {
    page_number: 4,
    width_points: 1000,
    height_points: 700,
    rotation_deg: 0,
    text_items: items,
    vector_segments: [],
    text: items.map((entry) => entry.text).join(" "),
    has_selectable_text: true,
    vector_extraction_status: "completed",
  };
}

Deno.test("detectDrawingViewports pairs nearby title and scale", () => {
  const page = makePage([
    item("ROOF PLAN", 100, 100, 140),
    item('SCALE 1/8" = 1\'-0"', 110, 135, 160),
    item("PARAPET DETAIL", 650, 100, 150),
    item('SCALE 3" = 1\'-0"', 660, 135, 150),
  ]);

  const viewports = detectDrawingViewports(page);
  assertEquals(viewports.length, 2);
  assertEquals(viewports[0].title, "ROOF PLAN");
  assertEquals(viewports[0].scale?.feet_per_paper_inch, 8);
  assertEquals(viewports[1].title, "PARAPET DETAIL");
  assertEquals(viewports[1].scale?.feet_per_paper_inch, 1 / 3);
  assert(viewports.every((viewport) => viewport.viewport_key.startsWith("p4-v")));
});

Deno.test("detectDrawingViewports creates non-measuring fallback when scale absent", () => {
  const page = makePage([item("ROOF PLAN", 100, 100)]);
  const viewports = detectDrawingViewports(page);
  assertEquals(viewports.length, 1);
  assertEquals(viewports[0].source, "page_fallback");
  assertEquals(viewports[0].scale, null);
});

Deno.test("detectDrawingReferences extracts detail/sheet callouts", () => {
  const page = makePage([
    item("ROOF PLAN", 100, 100),
    item('SCALE 1/8" = 1\'-0"', 100, 130),
    item("7/A8.1", 140, 160, 60),
    item("SEE SECTION 4/S3.2", 160, 175, 150),
  ]);
  const viewports = detectDrawingViewports(page);
  const refs = detectDrawingReferences(page, viewports);

  assertEquals(refs.length, 2);
  assertEquals(refs[0].detail_number, "7");
  assertEquals(refs[0].target_sheet_number, "A8.1");
  assertEquals(refs[0].reference_type, "detail_callout");
  assert(refs[0].viewport_key);
  assertEquals(refs[1].target_sheet_number, "S3.2");
  assertEquals(refs[1].reference_type, "section_callout");
});
