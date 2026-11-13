import { assertEquals, assertAlmostEquals } from "jsr:@std/assert@1";
import { detectProvider, parseRoofr } from "./roofr-parser.ts";

const text = await Deno.readTextFile(
  new URL("./__fixtures__/roofr-16-facet-report.txt", import.meta.url),
);

Deno.test("Roofr report with a material page is still read as Roofr", () => {
  assertEquals(detectProvider(text), "roofr");
});

Deno.test("an insurance scope that mentions Roofr stays an insurance scope", () => {
  const scope = "Xactimate\nClaim Number: 123\nDrip edge\nStarter\nThis report was prepared by Roofr\nReport summary";
  assertEquals(detectProvider(scope), "xactimate");
});

Deno.test("Roofr reader keeps every total from the report summary", () => {
  const p = parseRoofr(text);
  assertEquals(p.total_area_sqft, 4000);
  assertEquals(p.pitched_area_sqft, 4000);
  assertEquals(p.flat_area_sqft, 0);
  assertEquals(p.facet_count, 16);
  assertEquals(p.predominant_pitch, "6/12");
  assertAlmostEquals(p.eaves_ft!, 236 + 4 / 12, 0.01);
  assertAlmostEquals(p.valleys_ft!, 92 + 10 / 12, 0.01);
  assertAlmostEquals(p.hips_ft!, 154 + 7 / 12, 0.01);
  assertAlmostEquals(p.ridges_ft!, 73 + 10 / 12, 0.01);
  assertAlmostEquals(p.rakes_ft!, 92 + 3 / 12, 0.01);
  assertAlmostEquals(p.wall_flashing_ft!, 11 + 7 / 12, 0.01);
  assertAlmostEquals(p.step_flashing_ft!, 44 + 9 / 12, 0.01);
  assertEquals(p.transitions_ft, 0);
  assertEquals(p.parapet_walls_ft, 0);
  assertAlmostEquals(p.unspecified_ft!, 69 + 8 / 12, 0.01);
  assertAlmostEquals(p.perimeter_ft!, 328 + 7 / 12, 0.01);
  assertAlmostEquals(p.hips_ridges_ft!, 228 + 5 / 12, 0.01);
});

Deno.test("Roofr waste table uses the report's own percentages", () => {
  const p = parseRoofr(text);
  assertEquals(p.waste_table?.map((r) => r.waste_pct), [0, 10, 12, 13, 15, 17, 20]);
  assertEquals(p.waste_table?.[3], { waste_pct: 13, area_sqft: 4520, squares: 45.2 });
  assertEquals(p.pitches, [{ pitch: "6/12", area_sqft: 4000 }]);
});

Deno.test("multi-building Roofr report uses whole-property waste table and perimeter", () => {
  const wasteTable = (a0: number, a10: number) =>
    `Waste %\n \n0%\n \n10%\n \nArea (sqft)\n \n${a0}\n \n${a10}\n \nSquares\n \n${(a0 / 100).toFixed(1)}\n \n${(a10 / 100).toFixed(1)}\n`;
  const multi = [
    "This report was prepared by Roofr",
    "Length measurement report",
    "Eaves: 242ft 11in",
    "Rakes: 211ft 2in",
    "Hips: 74ft 3in",
    "Ridges: 100ft 1in",
    "Total roof area: 4205 sqft",
    "Structure #1 summary",
    "Total roof area\n89 sqft",
    "Eaves + rakes\n37ft 8in",
    wasteTable(89, 98),
    "Structure #2 summary",
    "Total roof area\n4116 sqft",
    "Eaves + rakes\n416ft 5in",
    wasteTable(4116, 4528),
    "Report summary",
    "Eaves + rakes\n454ft 1in",
    wasteTable(4205, 4626),
  ].join("\n");
  const p = parseRoofr(multi);
  assertEquals(p.total_area_sqft, 4205);
  assertAlmostEquals(p.perimeter_ft!, 242 + 11 / 12 + 211 + 2 / 12, 0.01);
  assertEquals(p.waste_table?.[0], { waste_pct: 0, area_sqft: 4205, squares: 42 });
  assertEquals(p.waste_table?.[1]?.area_sqft, 4626);
});

Deno.test("a per-building waste table is never kept as the whole roof", () => {
  const single = [
    "This report was prepared by Roofr",
    "Report summary",
    "Total roof area: 4205 sqft",
    "Waste %\n0%\n10%\nArea (sqft)\n89\n98\nSquares\n0.9\n1.0\n",
  ].join("\n");
  assertEquals(parseRoofr(single).waste_table, null);
});

Deno.test("pitch breakdown that covers only one building is left out", () => {
  const t = [
    "This report was prepared by Roofr",
    "Report summary",
    "Total roof area: 4205 sqft",
    "Pitch 3/12 Area (sqft) 89",
  ].join("\n");
  assertEquals(parseRoofr(t).pitches, null);
});
