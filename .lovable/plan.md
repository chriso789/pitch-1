## Goal

Make the aerial candidate roof graph actually execute on Fonsica-class runs where the registered raster + perimeter are present but DSM/topology fails. Diagnostics show all the right inputs exist on disk — the builder is skipping with `raster_transform_unavailable` because (a) the edge function never assigns the hoisted registration fields, and (b) the resolver only reads one perimeter location.

No DSM, gating, schema, or overlay-projection changes.

## Root causes (already verified)

1. **Self-assignment bug** in `supabase/functions/start-ai-measurement/index.ts` ~L6344–6347:
  ```ts
   hoistedRasterBoundsLatLng = hoistedRasterBoundsLatLng;
   hoistedGeoToRasterTransform = hoistedGeoToRasterTransform;
   hoistedConfirmedRoofCenterPx = hoistedConfirmedRoofCenterPx;
  ```
   The outer-scope vars stay `null`, so every downstream `buildPreTopologyDebugBag(...)` call passes `geoToRasterTransform: null` / `rasterBoundsLatLng: null` → builder short-circuits with `raster_transform_unavailable`.
2. **Resolver is too narrow** in `supabase/functions/_shared/aerial-candidate-graph.ts`:
  - Only reads `args.perimeterTopology?.perimeter_ring_px` / `perimeter_ring_geo`.
  - Requires *both* `geoToRasterTransform` AND `rasterBoundsLatLng`.
  - Does not consider `registration.transform_package.*`, `overlay_debug.raster_url`, `debug_layers.raw_perimeter_px`, or `dsm_planar_graph_debug.*` fallbacks.
3. `**primary_geometry_source` / `dsm_validation_status**` are not derived from the executed graph — viewer shows stale values.
4. **UI**: `MeasurementReportDialog` shows `Reportable Roof Lines = 6` sourced from `phase3B.reportable_roof_lines_count` even when graph is not customer-ready. It must split "Debug Roof Lines" (6) from "Reportable Roof Lines" (0) until topology passes.

## Changes

### A. Edge function — fix hoist (`supabase/functions/start-ai-measurement/index.ts`)

Replace the self-assignment trio (~L6344–6347) with real assignments from `_transformPkg`:

```ts
hoistedRasterBoundsLatLng =
  _transformPkg.raster_bounds_lat_lng ?? hoistedRasterBoundsLatLng;
hoistedGeoToRasterTransform =
  _transformPkg.geo_to_raster_transform ?? hoistedGeoToRasterTransform;
hoistedConfirmedRoofCenterPx =
  _transformPkg.confirmed_roof_center_px ?? hoistedConfirmedRoofCenterPx;
```

Also pass `registration: { transform_package: _transformPkg, raster: { url, size_px } }` into the three `buildPreTopologyDebugBag(...)` call sites (L6714, L6749, L7226) so the resolver has fallback paths.

### B. Resolver — multi-source inputs (`supabase/functions/_shared/aerial-candidate-graph.ts`)

Extend `BuildAerialCandidateGraphArgs` with optional `registration`, `debugLayers`, `dsmPlanarGraphDebug`, `debugRoofLines`.

New private resolvers, applied in this priority:

- **perimeter_ring_px**:
  1. `perimeterTopology.perimeter_ring_px`
  2. `debugLayers.raw_perimeter_px`
  3. `debugLayers.selected_perimeter_px`
  4. `dsmPlanarGraphDebug.perimeter_topology.perimeter_ring_px`
  5. `dsmPlanarGraphDebug.phase3_5.raw_perimeter_px`
  6. `dsmPlanarGraphDebug.debug_layers.raw_perimeter_px`
- **perimeter_ring_geo**:
  1. `perimeterTopology.perimeter_ring_geo`
  2. `dsmPlanarGraphDebug.perimeter_topology.perimeter_ring_geo`
  3. Derived from `debugRoofLines[].geo` only when ring otherwise unavailable.
- **raster registration** — registered when ANY are present:
  - `geoToRasterTransform` OR `registration.transform_package.geo_to_raster_transform`
  - `rasterBoundsLatLng` OR `registration.transform_package.raster_bounds_lat_lng`
  - `rasterUrl` + `rasterBoundsLatLng` (URL+bounds is sufficient when transform missing — flagged `raster_registered_basis: "bounds_only"`).
  - DSM transform is explicitly NOT required.

Emit the schema from the user spec: `version`, `source: "registered_aerial_geometry"`, `coordinate_space: "raster_px"`, `executed: true`, `customer_ready: false`, populated ring/area/IoU, nodes, edges from `eave_edges`/`rake_edges` (fallback to ring segments) tagged `debug_only: true`, `validation_status: "candidate_only"`, `evidence.dsm_required: false`.

### C. Diagnostics — primary/DSM status

In `pre-topology-debug-bag.ts` (and where `geometry_report_json` is assembled), when `aerial_candidate_roof_graph.executed === true`:

- Set `primary_geometry_source = "aerial_registered"`.
- Set `dsm_validation_status`:
  - `"invalid_transform"` when DSM loaded but `dsm_to_raster_transform` / `geo_to_dsm_transform` / `dsm_pixel_transform_valid` missing.
  - `"pending"` when DSM not loaded.
  - `"valid"` when transforms present.
- Leave `customer_report_ready = false`, `report_blocked = true`, and keep existing `block_customer_report_reason` (e.g. `dsm_validation_required` or current runtime blocker).

### D. CPU-preempt ordering

Move `buildAerialCandidateGraph` invocation to happen **before** the Phase 3A.5 heavy-topology guard, and persist the result into the CPU-budget terminal payload (already structured in `pre-topology-debug-bag.ts` via the `aerialCandidateRoofGraph` field — extend the CPU-terminal builder to read from the pre-topology bag rather than rebuild). Confirms graph survives `ai_measurement_cpu_timeout`.

### E. UI — separate debug vs reportable line counts

`src/components/measurements/MeasurementReportDialog.tsx` (+ `measurementDiagnosticState.ts`):

- Add `debug_roof_lines_count` (from `geometry_report_json.debug_roof_lines.length` or `phase3B.reportable_roof_lines_count`).
- `reportable_roof_lines_count` shows `0` unless `customer_report_ready === true` OR `topology_validated === true`.
- Render two rows: "Debug Roof Lines" and "Reportable Roof Lines".

### F. Tests

New / updated:

- `supabase/functions/_shared/__tests__/aerial-candidate-graph.test.ts` (extend):
  1. Executes when `perimeter_topology.perimeter_ring_px` + `geo_to_raster_transform` present, even with no DSM transform.
  2. Falls back to `debug_layers.raw_perimeter_px` when `perimeter_topology.perimeter_ring_px` missing.
  3. Falls back to `dsm_planar_graph_debug.perimeter_topology.perimeter_ring_px`.
  4. Builds edges from `perimeter_topology.eave_edges` with both px + geo endpoints, tagged `debug_only`, `candidate_only`.
  5. Raster registered via `rasterUrl + rasterBoundsLatLng` alone (no transform) → `raster_registered_basis: "bounds_only"`.
  6. Does NOT require `geo_to_dsm_transform` or `dsm_to_raster_transform`.
- `supabase/functions/start-ai-measurement/__tests__/aerial-primary-handoff.test.ts` (new):
  7. With Fonsica-shaped input, hoisted registration is assigned and `aerial_candidate_roof_graph.executed === true`.
  8. `primary_geometry_source === "aerial_registered"`, `dsm_validation_status === "invalid_transform"`, `customer_report_ready === false`.
- `src/components/measurements/__tests__/MeasurementReportDialog.debug-vs-reportable.test.tsx` (new):
  9. Renders "Debug Roof Lines = 6" and "Reportable Roof Lines = 0" when `customer_report_ready=false`.

## Acceptance (Fonsica rerun)

- `aerial_candidate_roof_graph.executed = true`, `skipped_reason = null`
- `perimeter_ring_px` populated, `edges.length >= 6`
- `evidence.raster_registered = true`, `evidence.target_mask_isolation_checked = true`
- `primary_geometry_source = "aerial_registered"`, `dsm_validation_status = "invalid_transform"`
- `customer_report_ready = false`; UI shows Debug=6 / Reportable=0
- Overlay aligns to roof (viewer fix from previous turn)

## Guardrails

- No DSM solver, geometry gate, schema, or overlay projection changes.
- Canonical route preserved (`start-ai-measurement` only).
- All edges remain `debug_only: true`, `customer_ready: false`.

## Files touched

- `supabase/functions/start-ai-measurement/index.ts` (hoist fix + extra registration arg)
- `supabase/functions/_shared/aerial-candidate-graph.ts` (multi-source resolver)
- `supabase/functions/_shared/pre-topology-debug-bag.ts` (pass registration/debug layers; set primary/dsm status)
- `src/lib/measurements/measurementDiagnosticState.ts` (debug vs reportable)
- `src/components/measurements/MeasurementReportDialog.tsx` (two-row display)
- Tests as listed above  
  
I’ll add this plan to Issue #5 as the implementation checklist, then give you the approval/adjustment note.
  Received app response
  This is the first Lovable plan in a while that is targeting the *actual* root cause cleanly.
  I would approve it with only two additions:
  ## 1. Force candidate edges to exist
  Right now the report says:
  ```

  ```
  ```
  Aerial Candidate Graph present (0 candidate edges)
  ```
  even though the payload clearly has:
  ```

  ```
  ```
  perimeter_topology.eave_edges.length = 6
  perimeter_topology.perimeter_edges.length = 6
  ```
  So the graph builder is still failing to promote the perimeter/eave edges into graph edges.
  The plan needs this hard acceptance rule:
  ```

  ```
  ```
  If perimeter_topology.eave_edges or perimeter_edges exist,
  aerial_candidate_roof_graph.edges.length must be >= 6.
  ```
  And if edge arrays are missing but the ring exists:
  ```

  ```
  ```
  Build fallback edges from consecutive perimeter ring points.
  ```
  Otherwise the aerial graph will still look empty.
  ---
  ## 2. Lock reportable roof lines to 0 until validated
  Right now the UI confusion is dangerous.
  You have:
  - `phase3B.reportable_roof_lines_count = 6`  

  -   
  but `roof_lines_count = 0`  

  -   
  and `customer_report_ready = false`  

  The plan already mentions separating them, but make it explicit:
  ```

  ```
  ```
  const trueReportableRoofLinesCount =
    customer_report_ready === true || topology_validated === true
      ? phase3B.reportable_roof_lines_count ?? roof_lines_count ?? 0
      : 0;
  ```
  Because currently the system is accidentally calling debug eave candidates “reportable.”
  That must stop.
  ---
  # Everything else in the plan is correct
  The biggest bug is absolutely this:
  ```

  ```
  ```
  hoistedRasterBoundsLatLng = hoistedRasterBoundsLatLng;
  hoistedGeoToRasterTransform = hoistedGeoToRasterTransform;
  hoistedConfirmedRoofCenterPx = hoistedConfirmedRoofCenterPx;
  ```
  That is catastrophic because it silently keeps the aerial registration fields null.
  Which means:
  ```

  ```
  ```
  raster_transform_unavailable
  ```
  even though the transform exists in `_transformPkg`.
  That explains almost everything.
  ---
  # The good news
  The latest Fonsica payload already proves the system has enough information to build the aerial graph:
  -   
  registered raster exists  

  -   
  perimeter ring exists  

  -   
  perimeter area exists  

  -   
  target mask exists  

  -   
  IoU exists  

  -   
  eave edges exist  

  -   
  corner nodes exist  

  -   
  bbox exists  

  -   
  confirmed center exists  

  The graph builder is simply not consuming the data correctly.
  That is MUCH easier than fixing geometry from scratch.
  ---
  # What success should look like after this deploy
  The next run should finally show:
  ```

  ```
  ```
  aerial_candidate_roof_graph.executed = true
  ```
  with:
  -   
  perimeter ring  

  -   
  candidate edges  

  -   
  corner nodes  

  -   
  debug-only eave lines  

  -   
  raster_registered = true  

  -   
  primary_geometry_source = aerial_registered  

  while still correctly blocking:
  -   
  customer report  

  -   
  validated topology  

  -   
  pitch/facet output  

  That’s the exact intermediate state you want.
  &nbsp;