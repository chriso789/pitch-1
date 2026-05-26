## Goal

Construct valid DSM↔raster registration transforms after Google Solar DSM fetch/decode so the topology phases (currently blocked at `perimeter_refinement_callsite_not_reached`) can finally execute.

Touch only DSM registration / transform construction. Do not change CPU containment, aerial candidate graph builder, frontend resolver, overlay transforms, customer-report gates, reportable-line promotion, DB schema, or the six-phase cleanup.

## Current state (verified in code)

- `supabase/functions/_shared/dsm-analyzer.ts` parses the Google Solar DSM GeoTIFF and assembles `DSMGrid { width, height, bounds: {minLat,maxLat,minLng,maxLng}, resolution }` from tiepoints + pixel scale.
- `supabase/functions/_shared/dsm-registration.ts` already produces `dsm_size_px`, `dsm_tile_bounds_lat_lng`, `dsm_meters_per_pixel` with priority‑ordered fallback and `failure_tokens`.
- `supabase/functions/_shared/source-registration-transform.ts` already composes `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px`, `geo_to_dsm_px_success`, `dsm_pixel_transform_valid`.
- `start-ai-measurement/index.ts` calls `buildDsmRegistration` (≈L1436 and again ≈L6364) and `buildRegistrationTransformPackage` (≈L1485) but for Fonsica all DSM transform fields land null while `dsm_size_px = 998x998` is present — the `dsm_loaded` branch ran but `dsm_tile_bounds_lat_lng` never made it through.

Diagnosis: the geo‑referencing path in `dsm-analyzer.ts` is returning a DSM grid whose `bounds` is null (or upstream we keep `effective_dsm` from a code path that strips bounds), so `buildDsmRegistration` falls through every priority branch and emits `dsm_bounds_missing` — which the classifier currently collapses into `invalid_transform`. The transform package then short‑circuits because `dsm_tile_bounds_lat_lng` is null.

## Scope of work (backend only — `supabase/functions/_shared/*` and the two call sites in `start-ai-measurement/index.ts`)

### 1. DSM tile bounds: prefer real Google Solar metadata, fail loudly

- In `dsm-analyzer.ts`, when the GeoTIFF yields no usable tiepoints / ModelTransformation / GeoKeys, return the grid with `bounds = null` AND attach a diagnostic `bounds_failure: "geotiff_missing_tiepoints" | "geotiff_unprojectable" | "geotiff_decoder_threw"` on the returned grid (new optional field).
- Plumb that reason through to the registration step.

### 2. `buildDsmRegistration` — specific failure tokens

In `_shared/dsm-registration.ts`:

- Add `dsm_tile_bounds_source` to the result (already exists as `dsm_bounds_source` — rename‑alias it in the output so the prompt's `dsm_tile_bounds_source` field name is satisfied without breaking existing readers).
- When `attempted && !dsm_tile_bounds_lat_lng`:
  - If the DSM grid was decoded but its `bounds` is null → push token `dsm_tile_bounds_missing_from_google_solar_metadata` instead of (or in addition to) the generic `dsm_bounds_missing`.
  - Keep `dsm_bounds_missing` as a fallback when DSM wasn't even attempted.
- Allow the derivation branches to run **only when explicitly opted in** (new input flag `allow_derived_bounds`, default `false` for the production path) so we don't silently substitute raster bounds. When derived bounds are used, also set `dsm_tile_bounds_source = "derived_from_*"` and warning `derived_bounds_lower_confidence`.

### 3. `buildRegistrationTransformPackage` — diagnostics for each transform

In `_shared/source-registration-transform.ts`:

- Add to the result:
  - `geo_to_dsm_transform_source: "composed_from_dsm_tile_bounds_and_size" | "missing"`
  - `dsm_to_raster_transform_source: "composed_geo_to_dsm_then_geo_to_raster" | "missing"`
  - `confirmed_roof_center_dsm_px_source: "geo_projected_via_geo_to_dsm" | "raster_center_projected_into_dsm" | "missing"`
  - `dsm_transform_policy_version = "dsm-registration-transform-v1"`
- Add a fallback for `confirmed_roof_center_dsm_px`: if the confirmed‑geo projection is unavailable but `geo_to_raster_transform` + `dsm_to_raster_transform` are valid, invert raster→dsm to project the raster center into DSM space. Tag with the matching source.

### 4. Call sites in `start-ai-measurement/index.ts`

- At the DSM hoist (≈L1430 and ≈L6364):
  - Drop the `dsmAlreadyHoisted = reg.dsm_size_px && reg.dsm_tile_bounds_lat_lng` short‑circuit when `reg.dsm_tile_bounds_lat_lng` is null — currently when `dsm_size_px` is populated from `dsm_coordinate_match.dsm_bbox` but bounds are missing, we never re‑attempt to source bounds from `effective_dsm`/`roof_mask`.
  - Always call `buildDsmRegistration` once per hoist with the freshest `effective_dsm`/`roof_mask`, then merge fields with `??` semantics on `reg`.
  - Persist the new source fields (`dsm_tile_bounds_source`, etc.) onto `reg` and into `geometry_report_json.dsm_registration_diagnostics` (no schema change — JSONB field on the existing column).
- At the transform package call (≈L1485):
  - Pass `dsm_meters_per_pixel` directly from `reg.dsm_meters_per_pixel` (don't fall back to `rasterMpp` silently — record `dsm_mpp_source` instead).
  - Persist `geo_to_dsm_transform_source`, `dsm_to_raster_transform_source`, `confirmed_roof_center_dsm_px_source`, `dsm_transform_policy_version` onto `reg` and the diagnostics bag.

### 5. Failure surfacing (no collapse to generic `invalid_transform`)

- In whichever stage classifier maps reasons to `dsm_validation_status.reason`, prefer (in order):
  1. `dsm_tile_bounds_missing_from_google_solar_metadata`
  2. `dsm_size_missing`
  3. `geo_to_dsm_projection_failed`
  4. `dsm_to_raster_invalid`
  5. Existing `invalid_transform` only as a last resort.

### 6. Gate (unchanged)

`customer_report_ready` stays `false`. The transform fix only re‑enables topology, pitch, and facet validation; their own gates remain.

## Acceptance (next Fonsica rerun)

- All previously green items remain green (CPU, aerial candidate graph, overlay, frontend resolver row).
- `dsm_size_px = { width: 998, height: 998 }`.
- Either `dsm_tile_bounds_lat_lng` is populated with `dsm_tile_bounds_source = "google_solar_metadata"`, OR the run fails with `dsm_tile_bounds_missing_from_google_solar_metadata` (no generic `invalid_transform`).
- When bounds exist: `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px` all populated with their `_source` fields set, `dsm_transform_policy_version = "dsm-registration-transform-v1"`.
- `dsm_pixel_transform_valid = true` only when the package is internally consistent (existing validator unchanged).
- `phase3_5.skipped_reason` is no longer `perimeter_refinement_callsite_not_reached` — topology runs.
- `customer_report_ready` remains `false` until topology/pitch/facets validate (separate prompt).

## Out of scope (deferred to later prompts)

- Phase 3A.5 / 3C / 3D / 3E execution behavior.
- Pitch + facet validation.
- Promotion into reportable roof lines.
- Any UI/frontend change beyond what reads the new diagnostic fields.

## Files expected to change

- `supabase/functions/_shared/dsm-registration.ts`
- `supabase/functions/_shared/source-registration-transform.ts`
- `supabase/functions/_shared/dsm-analyzer.ts` (add `bounds_failure` reason only)
- `supabase/functions/_shared/registration-stage-classifier.ts` (failure precedence)
- `supabase/functions/start-ai-measurement/index.ts` (the two hoist call sites + transform call site)
- Tests under `supabase/functions/_shared/__tests__/` and `supabase/functions/start-ai-measurement/__tests__/` covering: bounds present → transforms valid; bounds missing → `dsm_tile_bounds_missing_from_google_solar_metadata`; raster‑center fallback for `confirmed_roof_center_dsm_px`.
