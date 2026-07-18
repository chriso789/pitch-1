import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateGeometry } from "../../_shared/geometry-validator.ts";
import {
  evaluateRoofFootprintCandidate,
  pickBestRoofFootprintCandidate,
} from "../../_shared/roof-footprint-candidate.ts";

Deno.test("legacy admin test route includes nationwide US ArcGIS before Regrid/Solar fallback", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

  const usArcgisIndex = source.indexOf("STEP 3.5: Nationwide US ArcGIS Structures/Parcels");
  const regridIndex = source.indexOf("STEP 4: Fallback to Regrid parcel data");
  const solarIndex = source.indexOf("STEP 5: LAST RESORT - Solar API bounding box");

  assert(usArcgisIndex > -1, "analyze-roof-aerial must try the free national US ArcGIS source");
  assert(regridIndex > -1, "Regrid fallback step must still exist");
  assert(solarIndex > -1, "Solar bbox fallback step must still exist");
  assert(usArcgisIndex < regridIndex, "US ArcGIS must run before paid Regrid");
  assert(usArcgisIndex < solarIndex, "US ArcGIS must run before solar_bbox_fallback");
  assert(source.includes("fetchUsParcelOrStructure"), "legacy route must call the shared national extractor");
  assert(source.includes("'usa_structures', 'usa_parcels'"), "US ArcGIS sources must be treated as vector footprints in the UI-visible row");
  assert(source.includes("US ArcGIS ${usResult.source} candidate"), "solar fast path must collect US ArcGIS structures as a candidate before falling back to a rectangle");
  assert(source.includes("US ArcGIS ${usResult.source} skipped: parcel polygon is not the exterior roof footprint"), "solar fast path must not treat parcel geometry as the roof perimeter");
});

Deno.test("solar fast path refuses to complete complex roofs from solar bbox fallback", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

  assert(
    source.includes("fastPathBlockedByBbox = footprintSource === 'solar_bbox_fallback' && segmentCount >= 4"),
    "complex roofs with only solar_bbox_fallback must be blocked from fast-path completion",
  );
  assert(
    source.includes("complex roof requires full AI trace; solar_bbox_fallback is diagnostic-only"),
    "blocked fast path must return an explicit diagnostic reason instead of saving stale synthetic lines",
  );
  assert(
    source.includes("would reuse synthetic hips/ridges/valleys"),
    "logs must explain that bbox fast path would reuse fake topology lines",
  );
  assert(
    source.includes("authoritativeFootprint.source !== 'solar_bbox_fallback'"),
    "the full AI path must not skip AI vision when the only footprint is a Solar bbox rectangle",
  );
  assert(
    source.includes("authoritativeFootprint?.source === 'solar_bbox_fallback' ? null : authoritativeFootprint"),
    "Solar bbox must not be persisted as the authoritative footprint after full AI tracing",
  );
});

Deno.test("legacy analyze inserts normalize result state and block customer-ready report", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

  assert(source.includes("normalizeResultStateForWrite"), "legacy route must normalize result_state before DB writes");
  assert(source.includes("result_state: resultState"), "legacy route must persist a nonblank canonical result_state");
  assert(source.includes("customer_report_ready: false"), "legacy noncanonical rows must never be customer-ready");
  assert(source.includes("report_blocked: true"), "legacy noncanonical rows must be blocked from customer report rendering");
  assert(source.includes("route_warning = 'legacy_noncanonical_measurement_path'"), "legacy provenance must remain visible in geometry_report_json");
});

Deno.test("geometry validator accepts nationwide US ArcGIS footprint source tokens", () => {
  const rectangle = [
    { lat: 26.123, lng: -80.123 },
    { lat: 26.123, lng: -80.1227 },
    { lat: 26.1227, lng: -80.1227 },
    { lat: 26.1227, lng: -80.123 },
  ];

  assertEquals(validateGeometry(rectangle, "usa_structures").valid, true);
  assertEquals(validateGeometry(rectangle, "usa_parcels").valid, true);
});

Deno.test("roof footprint selector rejects parcel and solar bbox candidates even when they have more vertices", () => {
  const parcel = {
    source: "usa_parcels",
    coordinates: [[0, 0], [0, 10], [10, 10], [12, 6], [10, 0], [0, 0]] as [number, number][],
    confidence: 0.92,
    vertexCount: 6,
    areaSqft: 9000,
  };
  const solarBbox = {
    source: "solar_bbox_fallback",
    coordinates: [[0, 0], [0, 4], [4, 4], [4, 0]] as [number, number][],
    confidence: 0.55,
    vertexCount: 4,
    areaSqft: 3200,
  };
  const structure = {
    source: "usa_structures",
    coordinates: [[1, 1], [1, 4], [3, 4], [3.5, 2.5], [3, 1], [1, 1]] as [number, number][],
    confidence: 0.9,
    vertexCount: 6,
    areaSqft: 3100,
  };

  assertEquals(evaluateRoofFootprintCandidate(parcel, 3077).accepted, false);
  assertEquals(evaluateRoofFootprintCandidate(solarBbox, 3077).accepted, false);
  assertEquals(pickBestRoofFootprintCandidate([parcel, solarBbox, structure], 3077)?.candidate.source, "usa_structures");
});