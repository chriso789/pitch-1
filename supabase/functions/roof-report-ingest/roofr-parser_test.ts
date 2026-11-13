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
