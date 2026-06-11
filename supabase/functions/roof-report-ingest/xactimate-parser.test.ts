import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPdfFileContentBlock,
  completeMeasurementsFromDiagramGeometry,
  mergeMeasurementCompletenessFallback,
  needsInsuranceScopeVisionCompletenessFallback,
  parseXactimateInsuranceScopeText,
} from "./xactimate-parser.ts";

Deno.test("xactimate parser flags complex scopes missing hip/valley totals for PDF Vision completion", () => {
  const parsed = parseXactimateInsuranceScopeText(`
    Source - HOVER Roof
    Roof1
    F1 F2 F3 F4 F5 F6 F7 F8 F9
    3135.67 Surface Area
    304.64 Total Perimeter Length
    31.36 Number of Squares
    124.95 Total Ridge Length
    0.00 Total Hip Length
  `);

  assertEquals(parsed.total_area_sqft, 3135.67);
  assertEquals(parsed.facet_count, 9);
  assertEquals(parsed.ridges_ft, 124.95);
  assertEquals(parsed.hips_ft, 0);
  assertEquals(parsed.valleys_ft, null);
  assertEquals(needsInsuranceScopeVisionCompletenessFallback(parsed, "xactimate"), true);
});

Deno.test("xactimate completion merge fills hip and valley without replacing trusted area fields", () => {
  const parsed = {
    provider: "xactimate",
    total_area_sqft: 3135.67,
    facet_count: 9,
    ridges_ft: 124.95,
    hips_ft: 0,
    valleys_ft: null,
    eaves_ft: 304.64,
  };
  const visionFallback = {
    total_area_sqft: 3200,
    ridges_ft: 130,
    hips_ft: 82.5,
    valleys_ft: 41.25,
    eaves_ft: 310,
  };

  const merged = mergeMeasurementCompletenessFallback(parsed, visionFallback);

  assertEquals(merged.total_area_sqft, 3135.67);
  assertEquals(merged.ridges_ft, 124.95);
  assertEquals(merged.hips_ft, 82.5);
  assertEquals(merged.valleys_ft, 41.25);
  assertEquals(merged.eaves_ft, 304.64);
});

Deno.test("PDF multimodal payload uses file block required by AI gateway", () => {
  assertEquals(buildPdfFileContentBlock("abc123", "scope.pdf"), {
    type: "file",
    file: {
      filename: "scope.pdf",
      file_data: "data:application/pdf;base64,abc123",
    },
  });
});

Deno.test("diagram geometry totals can complete missing hip and valley measurements", () => {
  const parsed = {
    provider: "xactimate",
    total_area_sqft: 3135.67,
    facet_count: 9,
    ridges_ft: 124.95,
    hips_ft: 0,
    valleys_ft: null,
    eaves_ft: 304.64,
  };

  const completed = completeMeasurementsFromDiagramGeometry(parsed, {
    diagram_found: true,
    line_totals_ft: { hip: 78.5, valley: 24.75, ridge: 130, eave: 310 },
  });

  assertEquals(completed.ridges_ft, 124.95);
  assertEquals(completed.hips_ft, 78.5);
  assertEquals(completed.valleys_ft, 24.75);
  assertEquals(completed.eaves_ft, 304.64);
});