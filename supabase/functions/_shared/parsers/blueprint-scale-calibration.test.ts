import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { calibrateBlueprintScale, scaleFeetPerPdfPoint } from "./blueprint-scale-calibration.ts";

Deno.test("architectural scale converts PDF points to real feet",()=>{
  const scale={raw:'1/4" = 1\'-0"',kind:"architectural" as const,paper_inches:0.25,real_feet:1,ratio:null,feet_per_paper_inch:4};
  assertEquals(scaleFeetPerPdfPoint(scale),4/72);
});

Deno.test("ratio scale 1:50 converts correctly",()=>{
  const scale={raw:"1:50",kind:"ratio" as const,paper_inches:null,real_feet:null,ratio:50,feet_per_paper_inch:null};
  assertEquals(Number((scaleFeetPerPdfPoint(scale)??0).toFixed(8)),Number(((50/12)/72).toFixed(8)));
});

Deno.test("printed dimension validates declared scale",()=>{
  const scale={raw:'1/4" = 1\'-0"',kind:"architectural" as const,paper_inches:0.25,real_feet:1,ratio:null,feet_per_paper_inch:4};
  const result=calibrateBlueprintScale(scale,[{known_feet:20,pdf_distance_points:360,confidence:0.95}]);
  assertEquals(result.status,"validated");
  assert(result.feet_per_pdf_point!=null);
});

Deno.test("large dimension mismatch blocks geometry conversion",()=>{
  const scale={raw:'1/4" = 1\'-0"',kind:"architectural" as const,paper_inches:0.25,real_feet:1,ratio:null,feet_per_paper_inch:4};
  const result=calibrateBlueprintScale(scale,[{known_feet:20,pdf_distance_points:180,confidence:0.95}]);
  assertEquals(result.status,"conflict");
  assertEquals(result.feet_per_pdf_point,null);
  assert(result.review_required);
});
