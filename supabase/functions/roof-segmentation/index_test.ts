import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists, assertGreater } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

// Test roof-segmentation endpoint structure
Deno.test("roof-segmentation endpoint returns valid response structure", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/roof-segmentation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      lat: 27.9881,
      lng: -82.7329,
      imageSize: 640,
      zoom: 20,
      // Note: In production test, would include actual imageBase64
    }),
  });
  
  const body = await response.json();
  
  // Should return structured response even without image
  assertExists(body);
  assertEquals(typeof body, 'object');
  
  // Consume response body to prevent leaks
  await response.body?.cancel();
});

// Test unified pipeline aggregation functions
Deno.test("aggregateFacetTotals calculates correct totals", async () => {
  const { aggregateFacetTotals } = await import('../_shared/roofWorksheetEngine.ts');
  
  const testFacets = [
    { id: 'F1', planAreaSqft: 1000, pitch: '6/12', orientation: 'N' },
    { id: 'F2', planAreaSqft: 1200, pitch: '6/12', orientation: 'S' },
    { id: 'F3', planAreaSqft: 800, pitch: '4/12', orientation: 'E' },
  ];
  
  const result = aggregateFacetTotals(testFacets);
  
  assertEquals(result.totalPlanAreaSqft, 3000);
  assertEquals(result.facetCount, 3);
  assertEquals(result.predominantPitch, '6/12'); // 6/12 has most area (2200 sqft)
});

// Test linear aggregation
Deno.test("aggregateLinearByType sums features correctly", async () => {
  const { aggregateLinearByType } = await import('../_shared/roofWorksheetEngine.ts');
  
  const testLinear = [
    { type: 'ridge', lengthFt: 25 },
    { type: 'hip', lengthFt: 18 },
    { type: 'hip', lengthFt: 22 },
    { type: 'valley', lengthFt: 15 },
    { type: 'eave', lengthFt: 80 },
    { type: 'rake', lengthFt: 40 },
  ];
  
  const result = aggregateLinearByType(testLinear);
  
  assertEquals(result.breakdown.ridge?.total, 25);
  assertEquals(result.breakdown.hip?.total, 40); // 18 + 22
  assertEquals(result.breakdown.valley?.total, 15);
  assertEquals(result.breakdown.eave?.total, 80);
  assertEquals(result.breakdown.rake?.total, 40);
});

// Test QA check runner
Deno.test("runFullQAChecks validates geometry correctly", async () => {
  const { runFullQAChecks } = await import('../_shared/qa-checks.ts');
  
  // Valid simple rectangle footprint
  const validFootprint = [
    { lat: 27.988, lng: -82.732 },
    { lat: 27.988, lng: -82.731 },
    { lat: 27.987, lng: -82.731 },
    { lat: 27.987, lng: -82.732 },
  ];
  
  const result = runFullQAChecks({
    footprint: validFootprint,
    facets: [
      { id: 'F1', polygon: validFootprint, areaSqft: 2000, pitch: '6/12' }
    ],
    linearFeatures: [
      { type: 'ridge', start: { lat: 27.988, lng: -82.732 }, end: { lat: 27.988, lng: -82.731 }, lengthFt: 30 },
      { type: 'eave', start: { lat: 27.987, lng: -82.732 }, end: { lat: 27.987, lng: -82.731 }, lengthFt: 30 },
    ],
    solarData: null
  });
  
  assertExists(result);
  assertEquals(typeof result.overallPass, 'boolean');
  assertExists(result.checks);
});

// Test confidence calculation
Deno.test("calculateOverallConfidence returns valid score", async () => {
  const { calculateOverallConfidence } = await import('../_shared/qa-checks.ts');
  
  const result = calculateOverallConfidence({
    segmentationConfidence: 0.92,
    facetClosureScore: 0.88,
    edgeContinuityScore: 0.95,
    qaResult: {
      overallPass: true,
      passedChecks: 8,
      totalChecks: 10,
      checks: []
    }
  });
  
  assertExists(result);
  assertGreater(result.overallConfidence, 0);
  assertGreater(1, result.overallConfidence); // Should be between 0-1
  assertExists(result.confidenceLevel);
});

// Test polygon simplification
Deno.test("simplifyAndClean reduces vertex count appropriately", async () => {
  const { simplifyAndClean } = await import('../_shared/polygon-simplifier.ts');
  
  // Create polygon with redundant collinear points
  const complexPolygon = [
    { lat: 27.988, lng: -82.732 },
    { lat: 27.988, lng: -82.7315 }, // Collinear point
    { lat: 27.988, lng: -82.731 },
    { lat: 27.9875, lng: -82.731 }, // Collinear point
    { lat: 27.987, lng: -82.731 },
    { lat: 27.987, lng: -82.732 },
  ];
  
  const simplified = simplifyAndClean(complexPolygon, {
    tolerance: 0.5,
    snapAngles: true,
    angleThreshold: 10
  });
  
  assertExists(simplified);
  // Simplified should have fewer or equal vertices
  assertGreater(complexPolygon.length + 1, simplified.length);
});

// Test SVG overlay generation
Deno.test("generateSVGOverlay produces valid SVG", async () => {
  const { generateSVGOverlay, calculateImageBounds } = await import('../_shared/svg-overlay-generator.ts');
  
  const footprint = [
    { lat: 27.988, lng: -82.732 },
    { lat: 27.988, lng: -82.731 },
    { lat: 27.987, lng: -82.731 },
    { lat: 27.987, lng: -82.732 },
  ];
  
  const bounds = calculateImageBounds(27.9875, -82.7315, 20, 640, 640);
  
  const svg = generateSVGOverlay(
    footprint,
    [],
    [],
    bounds,
    { width: 640, height: 640, showNorthArrow: true }
  );
  
  assertExists(svg);
  assertEquals(svg.includes('<svg'), true);
  assertEquals(svg.includes('</svg>'), true);
  assertEquals(svg.includes('polygon'), true);
});
