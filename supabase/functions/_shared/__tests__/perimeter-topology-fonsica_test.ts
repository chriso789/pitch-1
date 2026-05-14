/**
 * Phase 3A regression test: Fonsica-class hip roof must NOT classify
 * every perimeter edge as a rake.
 *
 * This guards against the "global opposing azimuth pair" bug where every
 * slope-parallel edge on a hip roof was falsely flagged as a gable apex.
 */
import { assert, assertEquals, assertGreater, assertLess } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPerimeterTopology, type PerimeterInput } from "../perimeter-topology.ts";

// Synthetic hip-roof footprint: hexagon (6 perimeter edges), all roughly
// equal length, centered at (50, 50) in DSM pixel space.
function hexagon(cx: number, cy: number, r: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

Deno.test("Fonsica hip roof: no edge is classified rake without local ridge evidence", () => {
  const footprintPx = hexagon(50, 50, 30);
  const footprintGeo: [number, number][] = footprintPx.map(p => [p.x, p.y]);

  const input: PerimeterInput = {
    footprint_geo: footprintGeo,
    footprint_px: footprintPx,
    footprint_area_sqft: 2400,
    footprint_source: "google_solar_mask_contour",
    dsm_grid: null,
    masked_dsm: null,
    // 4 azimuth buckets → hip-like; opposing pairs trivially exist
    solar_segments: [
      { pitch_degrees: 25, azimuth_degrees: 0,   area_sqft: 600, center_geo: null },
      { pitch_degrees: 25, azimuth_degrees: 90,  area_sqft: 600, center_geo: null },
      { pitch_degrees: 25, azimuth_degrees: 180, area_sqft: 600, center_geo: null },
      { pitch_degrees: 25, azimuth_degrees: 270, area_sqft: 600, center_geo: null },
    ],
    roof_mask_pixel_count: 0,
    dsm_width: 100,
    dsm_height: 100,
    lat: 28.0,
    meters_per_pixel: 0.5,
    boundary_eaves: [],
    boundary_rakes: [],
    // No ridge endpoints provided → no edge can have local gable evidence
    ridge_endpoints_px: [],
  };

  const topo = buildPerimeterTopology(input);
  const debug = (input as any)._classification_debug;

  console.log("Fonsica test debug:", JSON.stringify({
    is_hip_like: debug.is_hip_like,
    is_gable_like: debug.is_gable_like,
    edges_eave: debug.edges_eave,
    edges_rake: debug.edges_rake,
    edges_demoted_by_hip_prior: debug.edges_demoted_by_hip_prior,
    edges_global_opposing_only: debug.edges_global_opposing_only,
  }, null, 2));

  assertEquals(debug.is_hip_like, true, "synthetic hexagon should be hip-like");
  assertGreater(debug.edges_eave, 0, "must have at least 1 eave");
  assertEquals(debug.edges_rake, 0, "no edge may classify as rake without local ridge evidence");

  // No edge may have gable_apex_detected=true without a ridge endpoint nearby.
  const table = debug.perimeter_edge_classification_table as any[];
  for (const row of table) {
    assert(
      !row.gable_apex_detected || row.local_ridge_endpoint_near_edge,
      `edge ${row.edge_id} flagged gable_apex_detected without local ridge endpoint`,
    );
  }

  // Hip-prior must have demoted at least the slope-parallel edges.
  assertGreater(debug.edges_demoted_by_hip_prior, 0, "hip prior should demote rake-prone edges");

  // Linear-foot tally: sum eave_lf vs rake_lf
  const eaveLf = topo.eave_edges.reduce((s, e) => s + e.length_ft, 0);
  const rakeLf = topo.rake_edges.reduce((s, e) => s + e.length_ft, 0);
  console.log(`eave_lf=${eaveLf.toFixed(1)} rake_lf=${rakeLf.toFixed(1)}`);
  assertGreater(eaveLf, rakeLf, "eave_lf must dominate rake_lf on hip roof");
  assertLess(rakeLf, 1, "rake_lf must be ~0 with no ridge endpoints");
});

Deno.test("True gable roof (not hip-like) still classifies rakes via archetype fallback", () => {
  // Rectangle: 4 perimeter edges, 2 solar segments with opposing azimuths.
  const rectPx = [
    { x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 50 }, { x: 20, y: 50 },
  ];
  const rectGeo: [number, number][] = rectPx.map(p => [p.x, p.y]);

  const input: PerimeterInput = {
    footprint_geo: rectGeo,
    footprint_px: rectPx,
    footprint_area_sqft: 1800,
    footprint_source: "google_solar_mask_contour",
    dsm_grid: null,
    masked_dsm: null,
    solar_segments: [
      { pitch_degrees: 25, azimuth_degrees: 0,   area_sqft: 900, center_geo: null },
      { pitch_degrees: 25, azimuth_degrees: 180, area_sqft: 900, center_geo: null },
    ],
    roof_mask_pixel_count: 0,
    dsm_width: 100,
    dsm_height: 100,
    lat: 28.0,
    meters_per_pixel: 0.5,
    boundary_eaves: [],
    boundary_rakes: [],
    ridge_endpoints_px: [],
  };

  buildPerimeterTopology(input);
  const debug = (input as any)._classification_debug;
  console.log("Gable test debug:", JSON.stringify({
    is_hip_like: debug.is_hip_like,
    is_gable_like: debug.is_gable_like,
    edges_eave: debug.edges_eave,
    edges_rake: debug.edges_rake,
  }, null, 2));

  assertEquals(debug.is_hip_like, false, "2 azimuth buckets is not hip-like");
  assertEquals(debug.is_gable_like, true, "opposing pair + non-hip = gable-like");
  // On a true gable, archetype fallback should still allow rake classification
  // for the short slope-parallel sides.
  assertGreater(debug.edges_rake, 0, "true gable must still produce rakes via archetype fallback");
});
