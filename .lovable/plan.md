## Goal

Make `aerial_candidate_roof_graph` actually execute on Fonsica-class runs (perimeter + registration data is already present), and make the overlay use the canonical 1280×1280 raster frame instead of the 640×640 analysis frame. No DSM, gate, schema, or projection-math changes.

## Diagnosis (from latest pull + code read)

1. **Aerial graph still skips with `raster_transform_unavailable`** even though `_transformPkg.geo_to_raster_transform`, `raster_bounds_lat_lng`, `perimeter_topology.*`, `eave_edges`, `target_mask_isolation.checked`, and `confirmed_roof_center_px` are all persisted.
   - Call sites in `start-ai-measurement/index.ts` (L6724, L6759, L7236) pass `geoToRasterTransform`/`rasterBoundsLatLng` as flat fields but **never pass a `registration: { transform_package: _transformPkg, ... }`** object.
   - `_shared/aerial-candidate-graph.ts → resolveRasterRegistration` only inspects `args.geoToRasterTransform`, `args.registration?.transform_package`, and `args.registration?.raster_bounds_lat_lng`. If the hoisted flat values happen to be null on a given branch (or were lost after a preempt happens before `_transformPkg` is built once), the resolver returns `{registered:false}` → skip.
   - There is no `skip_debug` payload, so we can't tell which source was missing.

2. **Overlay reports `source_raster_px = 640x640`** while the geometry is in 1280x1280 raster space.
   - `src/lib/measurements/overlayCoordinateFrame.ts → resolveSourceRasterSize` priority puts `measurement.analysis_image_size` (640×640) **above** `parsed_from_url` and never consults `transform_package.raster_size_px`. That is the exact override the user is calling out.

3. `primary_geometry_source` / `dsm_validation_status` are only set inside the `executed=true` branch of `pre-topology-debug-bag.ts`, so the viewer shows `null`.

## Changes

### A. One canonical `aerialGraphInput` (start-ai-measurement/index.ts)

Just before each `buildPreTopologyDebugBag({...})` call (L6724, L6759, L7236), construct:

```ts
const aerialGraphInput = {
  registration: {
    transform_package: _transformPkg ?? null,
    geo_to_raster_transform:
      hoistedGeoToRasterTransform ?? _transformPkg?.geo_to_raster_transform ?? null,
    raster_bounds_lat_lng:
      hoistedRasterBoundsLatLng ?? _transformPkg?.raster_bounds_lat_lng ?? null,
    confirmed_roof_center_px:
      hoistedConfirmedRoofCenterPx ?? _transformPkg?.confirmed_roof_center_px ?? null,
    raster_size_px:
      _transformPkg?.raster_size_px ??
      (raster?.width && raster?.height
        ? { width: raster.width, height: raster.height }
        : null),
    raster: { url: imageUrl, size_px: _transformPkg?.raster_size_px ?? null },
  },
  overlayDebug: /* existing overlay_debug */,
  debugLayers: /* existing debug_layers if available */,
  perimeterTopology: perimeterTopologySnapshot,
  dsmPlanarGraphDebug: /* existing dsm_planar_graph_debug if present */,
  debugRoofLines: /* existing debug_roof_lines if present */,
  targetMaskIsolation,
};
```

Pass the **same** object into every `buildPreTopologyDebugBag` call (3 sites) via a new `aerialGraphInput` arg. Do not re-construct partial shapes at each call site.

### B. Bag → graph wiring (`_shared/pre-topology-debug-bag.ts`)

- Accept `aerialGraphInput` (optional) and forward all of its fields into `buildAerialCandidateGraph(...)` directly. Keep current `args.registration`/`args.debugLayers` fallbacks for back-compat.
- When `aerial_candidate_roof_graph.executed === true`:
  - `primary_geometry_source = "aerial_registered"`
  - `dsm_validation_status = { available: dsmTransformsPresent, reason: dsmTransformsPresent ? null : "invalid_transform" }` (already partially wired; ensure it surfaces even when `_transformPkg.dsm_to_raster_transform` is missing).
- When `executed === false`, persist:
  ```
  primary_geometry_source = null
  dsm_validation_status   = null
  ```
  (so the viewer can render the existing "skipped" state).

### C. `_shared/aerial-candidate-graph.ts` — skip_debug + raster size

1. Extend `BuildAerialCandidateGraphArgs` with `overlayDebug?: any` (already has registration/debugLayers/dsmPlanarGraphDebug/debugRoofLines).
2. Add a `skip_debug` block to the returned graph (typed as optional) populated **whenever `executed === false`**:
   ```
   skip_debug: {
     has_perimeter_ring_px, perimeter_ring_px_source,
     has_perimeter_ring_geo, perimeter_ring_geo_source,
     has_geo_to_raster_transform, geo_to_raster_transform_source,
     has_raster_bounds_lat_lng, raster_bounds_source,
     has_overlay_raster_url,
     raster_registered_basis,
     reason
   }
   ```
3. In `resolveRasterRegistration`, additionally accept `args.registration?.geo_to_raster_transform`, `args.registration?.raster_bounds_lat_lng`, and `args.registration?.raster?.url` (already mostly there — add the explicit `geo_to_raster_transform` on the registration root and record the source name for skip_debug).
4. Edge construction already supports eave/rake/perimeter_edges + ring fallback. Add an assertion path: if `perimeterTopology.eave_edges` OR `perimeter_edges` is present, the result MUST have `edges.length > 0`; otherwise emit `skipped_reason: "edge_construction_failed"` with skip_debug.

### D. Canonical raster size authority (frontend, `src/lib/measurements/overlayCoordinateFrame.ts`)

Replace `resolveSourceRasterSize` precedence with:

1. `geometry_report_json.registration.transform_package.raster_size_px`
2. `geometry_report_json.overlay_debug.raster_size`
3. `geometry_report_json.raster_size`
4. `geometry_report_json.dsm_split_status.raster_size_px`
5. `parseRasterSizeFromUrl(rasterUrl)`  ← (Google `size=640&scale=2` → 1280)
6. `imageNatural` (only if everything else is missing)
7. `measurement.analysis_image_size`  ← demoted to **last** resort; 640×640 must never override 1280×1280.

Add a new `RasterSizeSource` value `'transform_package'`. Existing tests for `parsed_from_url`, `image_natural`, and `unresolved` continue to pass; the `overlay_debug` test continues to win when present (still ahead of analysis_image_size).

### E. Tests

New / extended tests:

- `supabase/functions/start-ai-measurement/__tests__/aerial-candidate-graph.test.ts`
  - executes when only `registration.transform_package` is provided (no flat `geoToRasterTransform`)
  - executes from hoisted package + `perimeter_topology.eave_edges` → `edges.length >= 6`
  - falls back to perimeter ring when eave/rake edges absent → `edges.length === ring.length`
  - `skip_debug` is populated on every `executed=false` branch, including the four reasons: `raster_transform_unavailable`, `perimeter_ring_unavailable`, `edge_construction_failed`, generic.
- `supabase/functions/start-ai-measurement/__tests__/aerial-primary-handoff.test.ts`
  - given Fonsica-shaped `aerialGraphInput`, bag emits `primary_geometry_source = "aerial_registered"` and `dsm_validation_status.reason = "invalid_transform"`, and `customer_report_ready` is **not** flipped.
- `src/lib/measurements/__tests__/overlayCoordinateFrame.test.ts`
  - `transform_package.raster_size_px = 1280x1280` wins over `analysis_image_size = 640x640`.
  - `?size=640x640&scale=2` resolves to 1280×1280 even when `analysis_image_size = 640x640` is present.
  - `overlay_debug.raster_size` still wins over `analysis_image_size` (existing test stays green).

## Acceptance on next Fonsica rerun

- `aerial_candidate_roof_graph.executed = true`, `skipped_reason = null`
- `edges.length >= 6`, all `debug_only: true`, `customer_ready: false`, `validation_status: "candidate_only"`
- `primary_geometry_source = "aerial_registered"`
- `dsm_validation_status = { available: false, reason: "invalid_transform" }`
- Overlay debug panel: `source_raster_px = 1280x1280`, `confirmed_center_src = 640,640`, polygon visually aligns with the roof.
- `customer_report_ready = false`, `report_blocked = true` (unchanged).

## Out of scope (untouched)

DSM solver, geometry/topology gates, customer-report logic, schema, projection math itself, canonical route (`start-ai-measurement` only).

## Files

- `supabase/functions/start-ai-measurement/index.ts` (3 call sites + `aerialGraphInput` construction)
- `supabase/functions/_shared/pre-topology-debug-bag.ts`
- `supabase/functions/_shared/aerial-candidate-graph.ts`
- `src/lib/measurements/overlayCoordinateFrame.ts`
- `supabase/functions/start-ai-measurement/__tests__/aerial-candidate-graph.test.ts`
- `supabase/functions/start-ai-measurement/__tests__/aerial-primary-handoff.test.ts` (new)
- `src/lib/measurements/__tests__/overlayCoordinateFrame.test.ts`
