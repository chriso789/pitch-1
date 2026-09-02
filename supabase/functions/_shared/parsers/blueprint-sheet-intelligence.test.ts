import {
  disciplineFromSheetNumber,
  extractSheetIndexEntries,
  normalizeScale,
} from "./blueprint-sheet-intelligence.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("normalizes architectural blueprint scale", () => {
  const scale = normalizeScale(`1/4" = 1'-0"`);
  assert(scale?.kind === "architectural", "expected architectural scale");
  assert(scale.paper_inches === 0.25, "expected 1/4 paper inch");
  assert(scale.real_feet === 1, "expected one real foot");
  assert(scale.feet_per_paper_inch === 4, "expected four feet per paper inch");
});

Deno.test("normalizes metric ratio scale", () => {
  const scale = normalizeScale("1:50");
  assert(scale?.kind === "ratio", "expected ratio scale");
  assert(scale.ratio === 50, "expected 1:50 ratio");
});

Deno.test("maps common discipline prefixes", () => {
  assert(disciplineFromSheetNumber("A2.1") === "architectural", "A should be architectural");
  assert(disciplineFromSheetNumber("S-101") === "structural", "S should be structural");
  assert(disciplineFromSheetNumber("M1.0") === "mechanical", "M should be mechanical");
  assert(disciplineFromSheetNumber("FP2.0") === "fire_protection", "FP should be fire protection");
});

Deno.test("extracts coordinate-aware sheet index entries", () => {
  const page: PdfLayoutPage = {
    page_number: 1,
    width_points: 1000,
    height_points: 700,
    rotation_deg: 0,
    has_selectable_text: true,
    vector_extraction_status: "deferred",
    text: "SHEET INDEX A1.0 FLOOR PLAN A2.0 ROOF PLAN S1.0 FOUNDATION PLAN",
    text_items: [
      { text: "A1.0", x: 100, y: 100, width: 30, height: 10, rotation_deg: 0, font_name: null },
      { text: "FLOOR PLAN", x: 150, y: 100, width: 90, height: 10, rotation_deg: 0, font_name: null },
      { text: "A2.0", x: 100, y: 130, width: 30, height: 10, rotation_deg: 0, font_name: null },
      { text: "ROOF PLAN", x: 150, y: 130, width: 90, height: 10, rotation_deg: 0, font_name: null },
      { text: "S1.0", x: 100, y: 160, width: 30, height: 10, rotation_deg: 0, font_name: null },
      { text: "FOUNDATION PLAN", x: 150, y: 160, width: 120, height: 10, rotation_deg: 0, font_name: null },
    ],
  };

  const entries = extractSheetIndexEntries(page);
  assert(entries.length === 3, `expected 3 entries, got ${entries.length}`);
  assert(entries[1].sheet_number === "A2.0", "expected roof sheet number");
  assert(entries[1].sheet_title === "ROOF PLAN", "expected roof sheet title");
  assert(entries[2].discipline === "structural", "expected structural discipline");
});
