# Instrument derived-bounds runtime (no logic changes)

## Goal

The early DSM registration gate now PASSES, but `buildDsmRegistration` returns `dsm_bounds_source = "missing"` and the wrapper exits with `derived_bounds_not_produced`. We cannot tell from the persisted row WHY the inner derivation failed. This plan adds structured diagnostics around the derived-bounds branch — no behavior changes, no new fixes — so the next Fonsica run reveals the exact failure point.

## Hypothesis (what the instrumentation must disprove or confirm)

Looking at `supabase/functions/_shared/dsm-registration.ts:178–227`, the `derived_from_raster_bounds` branch only fires when ALL of the following are true at the moment `buildDsmRegistration` runs:

1. `dsm_tile_bounds_lat_lng` not already set from `effectiveDSM.bounds`/`roofMask.bounds`.
2. `allow_derived_bounds === true`.
3. `**dsm_size_px` is non-null** — and `dsm_size_px` is computed internally from `effectiveDSM.width/height`, `dsmCoordinateMatchDebug.dsm_bbox`, or `roofMask.width/height`. The wrapper's `inp.dsm_size_px = 998×998` is NOT used here.
4. `rasterBoundsLatLng` shape must be `{ sw: {lat, lng}, ne: {lat, lng} }` (lines 202–205). Any other shape (e.g. `{north, south, east, west}`) silently fails the `isNum` checks.
5. `rasterSizePx.width/height` both numeric and > 0.

The gate in `early-dsm-registration.ts:190` only checks `!inp.raster_bounds_lat_lng` (truthiness) and the wrapper passes its OWN `inp.dsm_size_px` field — neither matches what the inner derivation actually consumes. So both #3 (`effectiveDSM`/`roofMask` width/height missing) and #4 (wrong bounds shape) are plausible silent-failure causes that the current diagnostics cannot distinguish.

## Scope

Read-only/diagnostic additions in three files. No new branches, no behavior changes, no schema changes.

### 1. `supabase/functions/_shared/dsm-registration.ts`

Extend `DsmRegistrationResult` (or its `failure_tokens` / a new `derived_bounds_debug` field) to persist, for every call where `allow_derived_bounds === true`:

```text
derived_bounds_debug: {
  allow_derived_bounds: boolean,
  dsm_size_px_internal: { width, height } | null,
  dsm_size_px_internal_source: "decoded_dsm_grid" | "dsm_coordinate_match.dsm_bbox" | "roof_mask_grid" | "missing",
  metadata_bounds_present: boolean,            // from effectiveDSM.bounds/roofMask.bounds
  raster_bounds_input_present: boolean,
  raster_bounds_input_shape:
    | "sw_ne"
    | "north_south_east_west"
    | "object_unknown_shape"
    | "null",
  raster_bounds_input_keys: string[],          // Object.keys of input
  raster_bounds_sw_lat_numeric: boolean,
  raster_bounds_sw_lng_numeric: boolean,
  raster_bounds_ne_lat_numeric: boolean,
  raster_bounds_ne_lng_numeric: boolean,
  raster_size_px_present: boolean,
  raster_size_px_positive: boolean,
  derived_branch_entered:
    | "derived_from_raster_bounds"
    | "derived_from_confirmed_center_and_mpp"
    | "derived_from_dsm_bbox_and_static_mpp"
    | "none",
  derived_branch_skipped_reason:
    | "metadata_bounds_won"
    | "internal_dsm_size_missing"
    | "raster_bounds_shape_mismatch"
    | "raster_size_invalid"
    | "no_confirmed_center"
    | "no_mpp"
    | null,
}
```

No logic changes — `derived_branch_skipped_reason` is derived from the same booleans the existing `if` already evaluates.

### 2. `supabase/functions/_shared/early-dsm-registration.ts`

When `dsmReg.dsm_bounds_source !== "derived_from_raster_bounds"` (the line that currently returns `derived_bounds_not_produced`), persist the new `derived_bounds_debug` block from `dsmReg` into the skip result's `fields`, alongside:

```text
fields.dsm_bounds_source_actual: dsmReg.dsm_bounds_source,
fields.dsm_tile_bounds_lat_lng_present: !!dsmReg.dsm_tile_bounds_lat_lng,
fields.dsm_size_px_present_in_inner: !!dsmReg.dsm_size_px,
fields.derived_bounds_debug: dsmReg.derived_bounds_debug,
```

Same for the `derived_rejected_validation_failure` and `derived_rejected_consistency_failure` skip paths — attach the relevant `transformPkg` validation booleans and the roundtrip px value so future failures don't need another instrumentation pass.

### 3. `supabase/functions/start-ai-measurement/index.ts`

Where the early-DSM result is merged onto `geometry_report_json` / the terminal debug payload, propagate `derived_bounds_debug` into both:

- `geometry_report_json.early_dsm_registration.derived_bounds_debug`
- `terminal_debug_payload.raw_debug.derived_bounds_debug`

This guarantees the next acceptance diff shows it without any UI changes.

### 4. Tests (must accompany the change per regression-harness skill)

Add one Deno unit test under `supabase/functions/_shared/__tests__/dsm-derived-bounds-debug-instrumentation.test.ts` that asserts, for three fixtures, that `derived_bounds_debug.derived_branch_skipped_reason` equals:

- `"raster_bounds_shape_mismatch"` when `rasterBoundsLatLng = { north, south, east, west, ... }`
- `"internal_dsm_size_missing"` when `effectiveDSM` and `roofMask` lack `width`/`height`
- `null` (and `derived_branch_entered === "derived_from_raster_bounds"`) on a known-good Fonsica-shaped input

No new feature behavior is asserted — only that the diagnostics correctly mirror the existing branch decisions.

## What this does NOT do

- Does NOT change any gate thresholds or branch ordering.
- Does NOT add a fallback bounds shape coercion (e.g. NSEW → sw/ne). That decision waits until the diagnostics confirm shape mismatch is actually the cause.
- Does NOT touch the PDF banner ("Coordinate frame mismatch — overlay not eligible for manual approval") — user explicitly deferred that as secondary.
- Does NOT change `customer_report_ready`, `result_state`, or any registration call sites outside the early branch.

## Acceptance (next Fonsica run)

After deploying, re-run Fonsica. The terminal debug payload MUST contain `derived_bounds_debug` with a single, unambiguous answer to one of these questions:

1. Was `dsm_size_px` null inside `buildDsmRegistration`? → fix is to plumb `effectiveDSM.width/height` or `roofMask.width/height` into the inner call (separate prompt).
2. Was `rasterBoundsLatLng` in the wrong shape? → fix is to normalize bounds shape at the boundary (separate prompt).
3. Did the derived branch enter but `buildRegistrationTransformPackage` reject it? → `derived_rejected_validation_failure` / `derived_rejected_consistency_failure` with the new sub-fields will show which validator (`geo_to_dsm_px_success`, `dsm_pixel_transform_valid`, `dsm_tile_bounds_contain_confirmed_center`, or roundtrip px) failed.

Only after that diff is reviewed do we patch the real root cause.  
  
Approve this plan. It is the right move because it **does not try to fix the suspected root cause yet**. It instruments the exact silent failure point so the next Fonsica run tells us whether the inner derived branch is missing DSM size, getting the wrong raster-bounds shape, or getting rejected by transform validation.

Send this:

```

```

```
Go.

Implement derived-bounds runtime instrumentation exactly as scoped.

This is diagnostic-only.

Do not change:
- DSM math
- derived-bounds branch ordering
- gate thresholds
- bounds normalization behavior
- topology / pitch / facet promotion
- customer_report_ready
- reportable roof line promotion
- result_state behavior
- DB schema
- UI / PDF banner
- CPU policy
- aerial graph builder

Current runtime truth:
- early DSM registration gate now passes
- frame_mismatch_ok = true
- early_dsm_registration_before_topology is attempted
- but it exits with derived_bounds_not_produced
- registration.transform_package.geo_to_dsm_transform remains null
- dsm_tile_bounds_lat_lng remains null
- dsm_pixel_transform_valid remains false

Goal:
Add structured diagnostics around buildDsmRegistration and early-dsm-registration so the next Fonsica run shows exactly why derived bounds were not produced.

Files allowed:
1. supabase/functions/_shared/dsm-registration.ts
2. supabase/functions/_shared/early-dsm-registration.ts
3. supabase/functions/start-ai-measurement/index.ts
4. targeted Deno test only

Required implementation:

1. In supabase/functions/_shared/dsm-registration.ts

Extend DsmRegistrationResult with:

derived_bounds_debug?: {
  allow_derived_bounds: boolean;
  dsm_size_px_internal: { width: number; height: number } | null;
  dsm_size_px_internal_source:
    | "decoded_dsm_grid"
    | "dsm_coordinate_match.dsm_bbox"
    | "roof_mask_grid"
    | "missing";
  metadata_bounds_present: boolean;
  raster_bounds_input_present: boolean;
  raster_bounds_input_shape:
    | "sw_ne"
    | "north_south_east_west"
    | "object_unknown_shape"
    | "null";
  raster_bounds_input_keys: string[];
  raster_bounds_sw_lat_numeric: boolean;
  raster_bounds_sw_lng_numeric: boolean;
  raster_bounds_ne_lat_numeric: boolean;
  raster_bounds_ne_lng_numeric: boolean;
  raster_size_px_present: boolean;
  raster_size_px_positive: boolean;
  derived_branch_entered:
    | "derived_from_raster_bounds"
    | "derived_from_confirmed_center_and_mpp"
    | "derived_from_dsm_bbox_and_static_mpp"
    | "none";
  derived_branch_skipped_reason:
    | "metadata_bounds_won"
    | "internal_dsm_size_missing"
    | "raster_bounds_shape_mismatch"
    | "raster_size_invalid"
    | "no_confirmed_center"
    | "no_mpp"
    | null;
};

Populate this whenever allow_derived_bounds === true.

No logic changes.

This debug object must mirror the same booleans the existing derived-branch if-statements already evaluate.

2. In supabase/functions/_shared/early-dsm-registration.ts

When dsmReg.dsm_bounds_source !== "derived_from_raster_bounds" and the code currently returns derived_bounds_not_produced, attach:

fields.dsm_bounds_source_actual = dsmReg.dsm_bounds_source
fields.dsm_tile_bounds_lat_lng_present = !!dsmReg.dsm_tile_bounds_lat_lng
fields.dsm_size_px_present_in_inner = !!dsmReg.dsm_size_px
fields.derived_bounds_debug = dsmReg.derived_bounds_debug

For derived_rejected_validation_failure and derived_rejected_consistency_failure, also attach:
- transform_package_valid
- geo_to_dsm_px_success
- dsm_pixel_transform_valid
- dsm_tile_bounds_contain_confirmed_center
- dsm_raster_roundtrip_error_px
- derived_bounds_debug

Do not change whether those paths pass/fail.

3. In supabase/functions/start-ai-measurement/index.ts

When merging early DSM result into geometry_report_json and terminal debug payload, propagate:

geometry_report_json.early_dsm_registration.derived_bounds_debug
terminal_debug_payload.raw_debug.derived_bounds_debug

Also persist:
geometry_report_json.early_dsm_registration.skip_reason
geometry_report_json.early_dsm_registration.dsm_bounds_source_actual
geometry_report_json.early_dsm_registration.dsm_tile_bounds_lat_lng_present
geometry_report_json.early_dsm_registration.dsm_size_px_present_in_inner

And equivalent raw_debug fields if terminal payload exists.

4. Tests

Add:
supabase/functions/_shared/__tests__/dsm-derived-bounds-debug-instrumentation.test.ts

Test A — bounds shape mismatch:
Input rasterBoundsLatLng = { north, south, east, west }
allow_derived_bounds = true
Expected:
derived_bounds_debug.raster_bounds_input_shape = "north_south_east_west"
derived_bounds_debug.derived_branch_skipped_reason = "raster_bounds_shape_mismatch"

Test B — internal DSM size missing:
effectiveDSM and roofMask lack width/height
allow_derived_bounds = true
Expected:
derived_bounds_debug.dsm_size_px_internal = null
derived_bounds_debug.dsm_size_px_internal_source = "missing"
derived_bounds_debug.derived_branch_skipped_reason = "internal_dsm_size_missing"

Test C — known-good Fonsica-shaped input:
rasterBoundsLatLng = { sw:{lat,lng}, ne:{lat,lng} }
rasterSizePx = { width:1280, height:1280 }
internal DSM size source present
allow_derived_bounds = true
Expected:
derived_bounds_debug.derived_branch_entered = "derived_from_raster_bounds"
derived_bounds_debug.derived_branch_skipped_reason = null
derived_bounds_debug.raster_bounds_input_shape = "sw_ne"

Acceptance on next Fonsica run:
terminal_debug_payload.raw_debug.derived_bounds_debug exists and clearly answers one of:
- internal_dsm_size_missing
- raster_bounds_shape_mismatch
- raster_size_invalid
- derived branch entered but transform package rejected

No functional behavior changes in this patch.
```

My read: this is exactly the discipline you need here. Don’t “fix” the derived bounds yet. First make the failure impossible to hide.