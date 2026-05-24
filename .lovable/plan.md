
## Source Registration Transform — Runtime Wiring Fix v1.1

### Diagnosis

The builder **is** imported and called in two places in `start-ai-measurement/index.ts`:

- L1325 — preflight `source_preflight` (Gate B)
- L7554 — `candidate_final`

The latest Fonsica row reaches `evaluation_stage=candidate_final` yet still shows `confirmed_roof_center_px=null`, `geo_to_raster_transform=null`, etc. That means the **call site runs but the builder returns nulls** and/or the **persisted `registration` block isn't being populated from the package's top-level fields** — only `registration.transform_package` is merged in (L611), and `evaluateRegistrationGate` only echoes whatever raw fields the caller passes in (`confirmed_roof_center_px: input.confirmed_roof_center_px ?? null`, etc., L389–L398 of `registration-gate.ts`).

Two concrete root causes:

1. **Input plumbing**: `Number(input.logical_image_width / logical_image_height / raster_scale)` and `effectiveZoom` are sometimes NaN/undefined for the Fonsica path (the client posts `zoom` but not always `logical_image_*` / `raster_scale`). `buildRasterBoundsFromStaticMap` returns `null` on any non-finite input → every downstream field comes back null. The builder is "called" but produces an all-null package.
2. **Persisted-block shape**: even when the package is valid, the gate input at L7564 forwards `confirmed_roof_center_px: input.confirmed_roof_center_px ?? transformPkgFinal.confirmed_roof_center_px`, but the gate writes those into the block only as raw echoes. The package itself is stored under `registration.transform_package`, while top-level `registration.confirmed_roof_center_px` / `geo_to_raster_transform` / `raster_bounds_lat_lng` stay null because nothing forces them from the package when the client didn't send them.
3. **Stale debug payload**: When the gate blocks at candidate_final, prior Phase 3B totals and `roof_lines_count: 6` are still rendered in the main report instead of moved to `stale_debug_payload`.

### Fix Plan (runtime wiring only — no new helpers)

#### 1. Resolve real static-map params at the call sites
In both `start-ai-measurement/index.ts` blocks (preflight @ L1320 and candidate_final @ L7547), compute a single `staticMapParams` from the actual imagery request used (`imageryResult` already has them implicitly):

- `zoom = effectiveZoom` (already finite)
- `size.width / size.height` = the values **actually sent** to `fetchAerialImagery` (L1304–1305) — fall back to `raster.width / raster.height / scale` if client didn't send `logical_image_*`
- `scale = Number(input.raster_scale) || 2` (Google Static Maps default for our pipeline)
- `static_map_center_lat_lng = { lat: coords.lat, lng: coords.lng }`

Persist these to `registration.static_map_request` for proof.

#### 2. Hoist the package into top-level registration fields
In `prepareRoofMeasurementPayload` (around L606–613), when `regTransformPkg` is present:

```ts
registrationBlock.transform_package = regTransformPkg;
// NEW: hoist truth-from-math into top-level keys the gate + UI read
registrationBlock.static_map_center_lat_lng ??= regTransformPkg.static_map_center_lat_lng;
registrationBlock.raster_size_px            ??= regTransformPkg.raster_size_px;
registrationBlock.raster_bounds_lat_lng     ??= regTransformPkg.raster_bounds_lat_lng;
registrationBlock.geo_to_raster_transform   ??= regTransformPkg.geo_to_raster_transform;
registrationBlock.confirmed_roof_center_px  ??= regTransformPkg.confirmed_roof_center_px;
registrationBlock.raster_bounds_contain_confirmed_center ??=
  regTransformPkg.raster_bounds_contain_confirmed_center;
registrationBlock.dsm_tile_bounds_lat_lng   ??= regTransformPkg.dsm_tile_bounds_lat_lng;
registrationBlock.dsm_size_px               ??= regTransformPkg.dsm_size_px;
registrationBlock.geo_to_dsm_transform      ??= regTransformPkg.geo_to_dsm_transform;
registrationBlock.dsm_to_raster_transform   ??= regTransformPkg.dsm_to_raster_transform;
registrationBlock.confirmed_roof_center_dsm_px ??= regTransformPkg.confirmed_roof_center_dsm_px;
registrationBlock.dsm_tile_bounds_contain_confirmed_center ??=
  regTransformPkg.dsm_tile_bounds_contain_confirmed_center;
// proof-of-call telemetry
registrationBlock.transform_builder_version = regTransformPkg.version;
registrationBlock.transform_builder_called  = true;
registrationBlock.transform_package_valid   = regTransformPkg.valid === true;
registrationBlock.transform_failure_reasons = regTransformPkg.failure_reasons ?? [];
registrationBlock.transform_build_stage     = regTransformPkg.build_stage ?? "candidate_final";
```

(If the existing package shape doesn't yet expose `valid` / `failure_reasons` / `build_stage`, add them in `source-registration-transform.ts` as derived fields — single small edit, not a new module.)

#### 3. Wire the same telemetry through the preflight failure path
At L1369–L1370 the failing preflight writes `registration: gateB.registration`. Mirror the same hoist + telemetry there so an early failure also persists `transform_builder_called=true`, `transform_package_valid`, `transform_failure_reasons` (e.g., `["static_map_size_missing"]`). This is what proves to QA that the runtime is using the builder even when it returns null.

#### 4. Force gate input to consume package values, not client echoes
In both `evaluateRegistrationGate` invocations:

```ts
confirmed_roof_center_px:   transformPkgFinal.confirmed_roof_center_px ?? null,
geo_to_raster_transform:    transformPkgFinal.geo_to_raster_transform ?? null,
raster_bounds_lat_lng:      transformPkgFinal.raster_bounds_lat_lng ?? null,
geo_to_dsm_transform:       transformPkgFinal.geo_to_dsm_transform ?? null,
dsm_to_raster_transform:    transformPkgFinal.dsm_to_raster_transform ?? null,
geo_to_dsm_px_success:      transformPkgFinal.geo_to_dsm_px_success === true,
dsm_pixel_transform_valid:  transformPkgFinal.dsm_pixel_transform_valid === true,
```

Drop the legacy `|| (mppFinite && !!dsmRef)` ORs at L7576–7577 — they let stale booleans publish a green flag without real transforms.

#### 5. Candidate polygon coordinate-space contract
Where `selectedFootprintPolygonPx` is built (just before L7587), stamp:

- `candidate_coordinate_space`: `"raster_px"` if derived from raster, `"dsm_px"` if from DSM mask
- If `dsm_px`, project to `raster_px` via `transformPkgFinal.dsm_to_raster_transform` for containment with `confirmed_roof_center_px`; otherwise use `confirmed_roof_center_dsm_px`.
- Persist `selected_candidate_polygon_geo`, `candidate_centroid_offset_from_confirmed_center_px`, `candidate_centroid_offset_threshold_px`, `candidate_distance_rank`, `rejection_reason`.

#### 6. Quarantine stale Phase 3B / roof_lines on registration block
In the existing "blocked_by_registration_gate" branch:

- Set top-level `roof_lines_count = 0`.
- `phase3B = { version: "v1", executed: false, skipped_reason: "blocked_by_registration_gate" }`.
- Move any pre-existing `phase3B`, `roof_lines`, eave/rake totals into `geometry_report_json.stale_debug_payload` (object, not array of versions).
- `MeasurementReportDialog.tsx`: when `result_state === "ai_failed_source_acquisition"` or `coordinate_registration_gate_passed === false`, render Roof Lines/Eave/Rake/Perimeter counters from the live block only (already 0/null) and add a collapsed "Stale debug payload" disclosure that reads from `stale_debug_payload`. No other UI changes.

#### 7. Regression tests
New file `supabase/functions/start-ai-measurement/__tests__/transform-runtime-wiring.test.ts`:

- **Happy path**: given finite `static_map_center_lat_lng`, zoom 20, 640×640, scale 2, confirmed center == map center → assert persisted `registration` has `transform_builder_called=true`, `transform_package_valid=true`, non-null `confirmed_roof_center_px ≈ [640,640]` (center of the 1280-px scaled raster), non-null `raster_bounds_lat_lng`, non-null `geo_to_raster_transform`.
- **Missing static-map size**: `logical_image_width` undefined → assert `transform_builder_called=true`, `transform_package_valid=false`, `transform_failure_reasons` contains `"static_map_size_missing"`, gate fails with `coordinate_registration_failed`, `missing_required_fields` no longer contains `confirmed_roof_center_px` *as a generic null* (it's now classified under the package failure).
- **DSM bounds present**: assert `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px` all populated and `geo_to_dsm_px_success` derived from `pointInBounds`, not from `mppFinite && !!dsmRef`.
- **Candidate missing at final**: assert `coordinate_registration_gate_passed=false` and `selected_candidate_polygon_px` recorded as `null` with `rejection_reason="missing"`.
- **Stale quarantine**: assert when gate blocks, persisted top-level `roof_lines_count=0`, `phase3B.executed=false`, prior `roof_lines` moved under `stale_debug_payload.roof_lines`.

#### 8. Fonsica rerun proof
After deploy, the next row must show on `geometry_report_json.registration`:

- `transform_builder_version = "source-registration-transform-v1"`
- `transform_builder_called = true`
- `transform_package_valid = true` (or `false` with explicit `transform_failure_reasons`)
- `static_map_center_lat_lng`, `raster_size_px`, `raster_bounds_lat_lng`, `geo_to_raster_transform`, `confirmed_roof_center_px` all non-null
- If DSM loaded: `dsm_tile_bounds_lat_lng`, `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px` non-null
- `coordinate_registration_gate_passed` true only when confirmed center is inside selected candidate
- UI shows `Roof Lines Count = 0`, no stale eave/rake totals, Phase 3B `skipped_reason: blocked_by_registration_gate`

### Files touched

- `supabase/functions/start-ai-measurement/index.ts` — resolve real static-map params, force gate input from package, drop legacy boolean fallbacks, quarantine stale debug payload, candidate coordinate-space stamping
- `supabase/functions/_shared/source-registration-transform.ts` — expose `valid` / `failure_reasons` / `build_stage` on the returned package (additive)
- `supabase/functions/start-ai-measurement/__tests__/transform-runtime-wiring.test.ts` — new
- `src/components/measurements/MeasurementReportDialog.tsx` — render counters from live block on registration failure, collapsed "Stale debug payload" disclosure

No new edge functions, no DB migration, no new helper modules.

Uses skills: Canonical Route & Runtime Provenance Auditor, Measurement Overlay UI & Visual QA, Roof Measurement Vision QA & Geometry Contract, AI Measurement Regression Harness.
