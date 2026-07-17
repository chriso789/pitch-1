import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateGeometry } from "../../_shared/geometry-validator.ts";

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
  assert(source.includes("US ArcGIS ${usResult.source} candidate"), "solar fast path must collect US ArcGIS as a candidate before falling back to a rectangle");
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