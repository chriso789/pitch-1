
## Goal

Fonsica now correctly hard-fails at `coordinate_registration_failed` because the upstream source-acquisition stage never built the pixel/transform package required by Registration Gate v2.3. This drop builds **Source Registration Transform Builder v1**: real Web-Mercator math for the Google Static Map raster and the DSM tile, populated *before* any candidate selection, then consumed by `evaluateRegistrationGate`. No gate loosening.

---

## 1. New shared module — `supabase/functions/_shared/source-registration-transform.ts`

Pure functions, no I/O, fully unit-testable.

Exports:
- `buildRasterBoundsFromStaticMap({ centerLatLng, zoom, sizePx, scale })` → `{ north, south, east, west }` via Web Mercator (mirrors `src/utils/geoCoordinates.ts` logic, ported to Deno).
- `buildGeoToRasterTransform({ rasterBoundsLatLng, rasterSizePx })` → affine descriptor `{ kind: "web_mercator", bounds, sizePx, metersPerPixel }`.
- `buildGeoToDsmTransform({ dsmTileBoundsLatLng, dsmSizePx })` → same shape, scoped to DSM tile.
- `buildDsmToRasterTransform({ dsmTileBoundsLatLng, rasterBoundsLatLng, dsmSizePx, rasterSizePx })` → composed transform; returns `null` if bounds do not overlap.
- `projectLatLngToRasterPx(latLng, transform)` / `projectLatLngToDsmPx(latLng, transform)` → `[x, y]` or `null` if outside.
- `pointInBounds(latLng, bounds)` helper.
- `validateRegistrationTransformPackage(pkg)` → `{ valid: boolean; missing: string[]; reasons: string[] }`.
- `buildRegistrationTransformPackage(input)` → orchestrator: takes confirmed lat/lng + static-map params + optional DSM tile params, returns the full persisted package shape used by the gate.

Package shape (persisted under `geometry_report_json.registration.transform_package`):
```
{
  version: "source-registration-transform-v1",
  static_map_center_lat_lng,
  zoom, size, scale,
  raster_size_px: { width, height },
  raster_bounds_lat_lng,
  geo_to_raster_transform,
  confirmed_roof_center_px,
  raster_bounds_contain_confirmed_center,
  dsm_tile_bounds_lat_lng,
  dsm_size_px,
  geo_to_dsm_transform,
  dsm_to_raster_transform,
  confirmed_roof_center_dsm_px,
  dsm_tile_bounds_contain_confirmed_center,
  geo_to_dsm_px_success,
  dsm_pixel_transform_valid,
  coordinate_space_input: "geo_lat_lng",
  coordinate_space_candidate: "raster_px",
  coordinate_space_solver: "dsm_px",
  coordinate_space_renderer: "raster_px",
  transform_package_valid: boolean,
  missing_required_fields: string[]
}
```

The `geo_to_dsm_px_success` and `dsm_pixel_transform_valid` booleans are derived strictly from real math — point-in-bounds check + non-null composed transform — never from caller flags.

---

## 2. Wire transform builder into the pipeline

### 2a. Static-map raster acquisition
Edit the source-acquisition step in `supabase/functions/start-ai-measurement/index.ts` (and any helper under `_shared/` that constructs the Google Static Map URL — locate during build via `rg "staticmap"`). At the same site where the URL is composed:
- persist `static_map_center_lat_lng`, `zoom`, `size`, `scale`
- call `buildRegistrationTransformPackage` with the static-map-only inputs first
- merge result into `registration.transform_package`

### 2b. DSM / Solar Data Layers acquisition
At the DSM fetch site (likely `_shared/autonomous-graph-solver.ts` or a dedicated DSM loader — locate during build):
- persist `dsm_tile_bounds_lat_lng`, `dsm_size_px`
- re-call `buildRegistrationTransformPackage` with DSM inputs added to enrich the same package
- recompute `geo_to_dsm_px_success` / `dsm_pixel_transform_valid` from the transform result, never inherit from prior booleans

### 2c. Candidate selection (after transforms only)
At the candidate/footprint selection site, persist per candidate:
- `selected_candidate_polygon_px` (in `raster_px`)
- `selected_candidate_polygon_geo` if available
- `confirmed_center_inside_candidate` (point-in-polygon against confirmed_roof_center_px)
- `candidate_centroid_offset_from_confirmed_center_px`
- `candidate_centroid_offset_threshold_px` (default e.g. 80 px @ scale 2 / zoom 19 — tune in module)
- `candidate_distance_rank`
- `candidate_coordinate_space: "raster_px"`

Reject candidate when: does not contain confirmed center, centroid offset > threshold, or another detected structure is closer than confirmed center.

### 2d. Coordinate-space naming
Replace any ambiguous `"satellite_px" | "pixel" | "unknown"` references with the explicit `raster_px` / `dsm_px` / `geo_lat_lng` set in registration metadata. Audit via `rg "satellite_px|coordinate_space" supabase/functions`.

---

## 3. `_shared/registration-gate.ts` v2.3 — consume transform package

No version bump (still v2.3). In `candidate_final`, replace the loose field-presence checks with:
- read `registration.transform_package`
- require `transform_package_valid === true`
- require all of: `confirmed_roof_center_px`, `confirmed_roof_center_dsm_px`, `selected_candidate_polygon_px`, `geo_to_raster_transform`, `geo_to_dsm_transform`, `dsm_to_raster_transform`, `raster_bounds_contain_confirmed_center`, `dsm_tile_bounds_contain_confirmed_center`, `confirmed_center_inside_candidate`, centroid offset within threshold
- any missing → push field name into `missing_required_fields`, fail as today

Preflights remain permissive (no transform package required).

---

## 4. UI cleanup — stale debug payload visibility

In `src/components/measurements/MeasurementReportDialog.tsx` (and any helper that reads the row for the summary panel — likely `src/lib/measurement/registration-gate.ts` + the report summary component):

When `coordinate_registration_gate_passed === false` OR `registration_precedence_applied === true`:
- Force visible **Roof Lines Count = 0**
- Phase 3A / 3B / 3A.5 / 3C / 3D / 3E rows show `skipped: blocked_by_registration_gate` (read only from active fields, never from `stale_debug_payload`)
- Hide stale eave/rake/perimeter/refinement totals from the main summary
- `stale_debug_payload` remains visible only inside the raw-JSON expander

Also surface the new transform-package fields in the Registration block: `static_map_center_lat_lng`, `raster_bounds_lat_lng`, `dsm_tile_bounds_lat_lng`, `transform_package_valid`, `confirmed_roof_center_px`, `confirmed_roof_center_dsm_px`, `selected_candidate_polygon_px` (presence/absence with "—" fallback).

Extend `RegistrationBlock` type in `src/lib/measurement/registration-gate.ts` accordingly.

---

## 5. Regression tests

New file: `supabase/functions/_shared/__tests__/source-registration-transform.test.ts`

- **A — Static map transform:** center `(28.0, -82.5)`, zoom 19, size 640, scale 2 → `raster_bounds_lat_lng` defined; `projectLatLngToRasterPx(center)` within ±2 px of `(640, 640)`; `raster_bounds_contain_confirmed_center === true`.
- **B — DSM transform:** synthetic DSM tile bounds + size → `geo_to_dsm_transform` defined; confirmed center projects inside bounds; `dsm_to_raster_transform` defined when raster bounds overlap.
- **C — Missing transform package:** call `evaluateRegistrationGate` in `candidate_final` with `transform_package` absent → `coordinate_registration_gate_passed=false`, `hard_fail_reason=coordinate_registration_failed`, `missing_required_fields` contains `transform_package`, `confirmed_roof_center_px`, `geo_to_dsm_transform`.
- **D — Candidate containment:** transform package valid but selected polygon excludes confirmed center → gate fails with `confirmed_center_inside_candidate` in `missing_required_fields`; manual approval disabled in frontend helper.

Extend `start-ai-measurement/__tests__/registration-v2-3-strict.test.ts` with one happy-path: full transform package + containing candidate → gate passes, downstream phases not skipped by registration.

Run via `supabase--test_edge_functions` on `_shared` and `start-ai-measurement`.

---

## 6. Deploy & verify

Deploy `start-ai-measurement` (and any other touched function). Re-run Fonsica from the lead at `/lead/0a38230e-...`. Expected on the new row:
- `registration.transform_package.version = source-registration-transform-v1`
- All seven previously-missing fields populated
- `raster_bounds_contain_confirmed_center = true`
- `dsm_tile_bounds_contain_confirmed_center = true`
- `geo_to_dsm_px_success / dsm_pixel_transform_valid` derived from math
- `selected_candidate_polygon_px` present
- `confirmed_center_inside_candidate` reflects reality
- Gate may pass → Phase 3A.5 / 3C / 3D / 3E execute. If candidate selection still rejects (legitimate miss), gate stays failed with honest `missing_required_fields` — that is acceptable.

UI: Roof Lines Count = 0 when blocked, stale phase data hidden from summary.

---

## Out of scope

No changes to perimeter shape validation, topology solver, vendor benchmark, PDF rendering, or `result_state` enum. No DB migration — all new fields live inside `geometry_report_json.registration.transform_package`.

Skills applied: Canonical Route & Runtime Provenance Auditor, Measurement Overlay UI & Visual QA, AI Measurement Regression Harness, Supabase Schema & DB Drift Guard.
