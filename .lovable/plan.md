## Scope

Fix only registration/source-registration safety. Do not tune perimeter shape, Phase 3A.5 refinement, topology, roof_lines, or vendor benchmark logic until Fonsica proves the registration gate blocks unsafe rows.

## Audit findings

### Active canonical route table

| Caller | Hook / client path | Edge function | Solver path | Renderer / UI |
|---|---|---|---|---|
| Pull Measurements on lead/project | `useMeasurementJob.startJob` | `start-ai-measurement` | `_shared/autonomous-graph-solver.solveAutonomousGraph` after perimeter gates | `MeasurementReportDialog`, `MeasurementVisualQAOverlay`, measurement PDF renderer |
| Debug audit | direct edge call | `debug-measurement-runtime` | none; reads persisted rows | returns provenance + phase + registration summaries |

### Legacy route table

| Legacy route | Status | Required behavior |
|---|---|---|
| `measure` | legacy writer | Must stamp `canonical_measurement_route=false` and `route_warning=legacy_noncanonical_measurement_path` |
| `measure-roof` | legacy writer | Same non-canonical stamp |
| `analyze-roof-aerial` | legacy writer | Same non-canonical stamp |
| `generate-roof-report` / PDF render paths | renderer/update-only | Must not make non-canonical rows look canonical |
| manual override/recalculate path | sanctioned override path | Must not bypass customer-ready registration/topology gates |

### Latest Fonsica canonical row proof

Recent row for lead `0a38230e-57ad-4f22-9caa-ac7707a6962f` proves the canonical route is active:

- `created_by_function = start-ai-measurement`
- `created_by_component = PullMeasurementsButton/useMeasurementJob`
- `canonical_measurement_route = true`
- `registration_precedence_version = registration-precedence-v1`
- `registration_precedence_applied = false`
- `registration_gate.version = registration-gate-v2.1`
- `phase3_5.executed = true`
- `result_state = ai_failed_perimeter`

But it is unsafe because the registration block says pass while required transform evidence is null/conflicting.

### Missing / contradictory provenance fields

The current implementation has these gaps:

- `evaluateRegistrationGate()` treats “no selected candidate yet” as pass, and that behavior leaks after candidate selection.
- Gate B currently accepts shallow booleans (`geo_to_dsm_px_success`, `dsm_pixel_transform_valid`) without requiring actual transforms/bounds.
- `_registration_gate_input` is populated with synthetic `{ meters_per_pixel }` transform objects and omits real `geo_to_raster_transform`, `geo_to_dsm_transform`, `raster_bounds_lat_lng`, and `dsm_tile_bounds_lat_lng`.
- `confirmed_center_inside_candidate` can become true/unknown even when `confirmed_roof_center_px = null`.
- Top-level registration booleans can conflict with `geometry_report_json.registration` booleans.
- Candidate diagnostics do not consistently include distance rank, containment, offset, and rejection reason for every candidate including Solar mask fallback.

## Implementation plan

### 1. Upgrade shared registration gate to v2.2

Update `supabase/functions/_shared/registration-gate.ts`:

- Set `REGISTRATION_GATE_VERSION = "registration-gate-v2.2"`.
- Extend failure reasons with:
  - `registration_field_conflict`
  - optionally `missing_selected_candidate` if we keep it distinct internally while routing to `ai_failed_source_acquisition`.
- Split evaluation semantics:
  - Gate A: target confirmation preflight only.
  - Gate B: strict source registration after raster/DSM/candidate selection.
- Add a strict “post candidate selection” mode flag, e.g. `registration_stage: "pre_candidate" | "post_candidate"` or `candidate_selection_started: boolean`.
- Gate B must require all of:
  - non-null `confirmed_roof_center_px`
  - non-null `geo_to_raster_transform`
  - non-null `geo_to_dsm_transform`
  - non-null `dsm_to_raster_transform`
  - non-null `raster_bounds_lat_lng`
  - non-null `dsm_tile_bounds_lat_lng`
  - `geo_to_dsm_px_success === true`
  - `dsm_pixel_transform_valid === true`
  - selected candidate polygon exists after candidate selection
  - selected candidate polygon contains the confirmed center
  - selected candidate centroid offset is within `max(150px, 0.35 * footprint_bbox_diagonal_px)`.
- Never default `confirmed_center_inside_candidate` to true once candidate selection has started.
- Persist `registration.required_transform_evidence` and `registration.missing_required_fields` for debugging.

### 2. Add conflict detection and precedence routing

Update `supabase/functions/_shared/registration-precedence.ts`:

- Add `registration_field_conflict` to `RegistrationPrecedenceReason`.
- Add a detector that compares the authoritative registration block against top-level mirrors:
  - block `geo_to_dsm_px_success` vs top-level `geo_to_dsm_px_success`
  - block `dsm_pixel_transform_valid` vs top-level `dsm_pixel_transform_valid`
  - `coordinate_registration_gate_passed=true` while `confirmed_roof_center_px=null`
  - `coordinate_registration_gate_passed=true` while `geo_to_dsm_transform=null`
  - `coordinate_registration_gate_passed=true` while `geo_to_raster_transform=null`.
- Route conflicts to:
  - `result_state = ai_failed_source_acquisition`
  - `hard_fail_reason = registration_field_conflict`
  - `block_customer_report_reason = registration_field_conflict`
  - `failure_stage = source_registration`
  - all Phase 3 blocks skipped with `blocked_by_registration_gate`.

### 3. Wire v2.2 into the canonical runtime

Update `supabase/functions/start-ai-measurement/index.ts`:

- Gate A remains before source acquisition and writes `ai_failed_target_unconfirmed` if target confirmation is missing.
- Gate B before candidate selection should validate only raster decode/acquisition evidence that is actually available, but must not mark final registration passed until candidate selection exists.
- After candidate selection, run strict Gate B with real selected footprint data before Perimeter Phase 0 / Phase 3A / Phase 3A.5 can run.
- If strict Gate B fails:
  - insert failed preliminary measurement
  - `result_state = ai_failed_source_acquisition`
  - `hard_fail_reason = coordinate_registration_failed` or `registration_field_conflict`
  - `failure_stage = source_registration`
  - phase blocks stamped `blocked_by_registration_gate`
  - no perimeter artifacts that imply an editable selected perimeter.
- Replace synthetic transform placeholders with explicit evidence fields. If real transform objects do not exist, write null and fail honestly.
- Mirror the authoritative `geometry_report_json.registration` booleans back to the top-level fields in `geometry_report_json` so false/true drift cannot persist.
- In `prepareRoofMeasurementPayload()`, run the conflict detector after registration evaluation and before phase block stamping.

### 4. Enforce candidate containment and centroid threshold

Update candidate scoring in `start-ai-measurement/index.ts`:

- Every candidate, including `google_solar_mask_contour`, must include:
  - `confirmed_center_inside_candidate`
  - `candidate_centroid_offset_from_confirmed_center_px`
  - `candidate_distance_rank`
  - `rejection_reason`.
- If `confirmed_roof_center_px` is null after raster decode, selected candidate acceptance must fail.
- Reject selected candidate if offset exceeds `max(150px, 0.35 * footprint_bbox_diagonal_px)`. The 878px Fonsica offset must not pass.
- If no candidate remains after strict registration filtering, fail as `coordinate_registration_failed` or `candidate_does_not_contain_confirmed_roof_center`; do not fall through into perimeter refinement.

### 5. Update debug endpoint proof fields

Update `supabase/functions/debug-measurement-runtime/index.ts`:

- Surface v2.2 fields:
  - all transform-presence booleans
  - `geo_to_raster_transform_present`
  - `geo_to_dsm_transform_present`
  - `dsm_to_raster_transform_present`
  - `raster_bounds_lat_lng_present`
  - `dsm_tile_bounds_lat_lng_present`
  - `missing_required_fields`
  - conflict detector result
  - candidate offset threshold and actual offset.
- Compute `manual_approval_allowed=false` when any strict registration requirement is missing.

### 6. UI blocking and diagnostics

Update:

- `src/lib/measurement/registration-gate.ts`
- `src/components/measurements/MeasurementReportDialog.tsx`
- `src/components/measurements/MeasurementVisualQAOverlay.tsx`

Behavior:

- Treat `registration_field_conflict`, null confirmed center px, null transform evidence, and contradictory top-level/block booleans as registration failures.
- Top badge / failure row should show `coordinate_registration_failed` or `registration_field_conflict`, not `perimeter_shape_not_accurate`, when strict registration is invalid.
- Hide selected perimeter and edit tools when registration is invalid.
- Disable manual approval.
- Show coordinate-frame mismatch alert.
- Show diagnostics for:
  - original geocode marker
  - confirmed roof center marker
  - static map center
  - selected candidate centroid
  - raster bounds
  - DSM bounds
  - transform evidence present/missing.

Overlay layer contract:

| Layer | Style | Backend fields | Toggle / fallback |
|---|---|---|---|
| Aerial raster | background | `overlay_debug.raster_url`, `raster_url`, satellite URLs | show no-aerial note if missing |
| Raw perimeter | gray | `phase3_5.raw_perimeter_px` | “not persisted” if missing |
| Refined perimeter | green | `phase3_5.refined_perimeter_px` | forced off when registration invalid |
| Selected perimeter | blue editable | edited/refined seed | hidden when registration invalid |
| Target mask | translucent fill | `overlay_debug.target_mask_polygon_px` | “not persisted” if missing |
| Candidate centroid / confirmed center | marker pair | `registration.confirmed_roof_center_px`, candidate centroid fields | show missing evidence if null |
| Raster/DSM bounds | outline/labels | `registration.raster_bounds_lat_lng`, `registration.dsm_tile_bounds_lat_lng` | show missing evidence if null |
| DSM edges | typed strokes | `overlay_debug.edges_px` | optional |

### 7. Regression tests

Test file paths:

- `supabase/functions/_shared/__tests__/registration-gate-v2-2_test.ts`
- `supabase/functions/start-ai-measurement/__tests__/registration-v2-2-null-center.test.ts`
- `supabase/functions/start-ai-measurement/__tests__/registration-v2-2-field-conflict.test.ts`
- `supabase/functions/start-ai-measurement/__tests__/registration-v2-2-centroid-offset.test.ts`
- `src/lib/measurement/__tests__/registration-gate-ui.test.ts`

Mock payloads / fixtures:

- Use a Fonsica-shaped fixture under `supabase/functions/_shared/__fixtures__/fonsica-registration-v2-2-row.json` with anonymized row data and the exact contradictory registration pattern:
  - block booleans true
  - transforms null
  - top-level booleans false
  - selected candidate source `google_solar_mask_contour`
  - centroid offset `878.2466`.

Assertions:

- Candidate selected but `confirmed_center_px=null`:
  - `coordinate_registration_gate_passed === false`
  - `result_state === ai_failed_source_acquisition`
  - `hard_fail_reason === coordinate_registration_failed`
  - `phase3_5.executed === false`
  - `phase3_5.skipped_reason === blocked_by_registration_gate`.
- Registration block true but top-level transform false:
  - `hard_fail_reason === registration_field_conflict`
  - precedence applied true
  - all phase blocks skipped.
- Selected candidate centroid offset exceeds threshold:
  - candidate rejected
  - hard fail source acquisition, not perimeter.
- Registration true with null `geo_to_dsm_transform` or `geo_to_raster_transform`:
  - `registration_field_conflict`.
- UI test:
  - manual approval disabled
  - selected perimeter/edit controls hidden
  - coordinate mismatch banner visible.

Acceptance thresholds:

- Candidate offset threshold: `max(150px, 0.35 * footprint_bbox_diagonal_px)`.
- Fonsica 878px offset must fail.
- No topology/perimeter phase may execute while strict registration failed.

Commands I will run after implementation:

- `supabase--test_edge_functions` for `start-ai-measurement`.
- Targeted Deno tests for shared registration gate.
- Targeted frontend vitest for registration UI guard.
- Deploy changed edge functions and verify a fresh Fonsica debug row.

## Validation / acceptance

A fresh Fonsica run with current null transforms should produce:

- `result_state = ai_failed_source_acquisition`
- `hard_fail_reason = coordinate_registration_failed` or `registration_field_conflict`
- `registration_precedence_applied = true`
- `phase3_5.executed = false`
- `phase3_5.skipped_reason = blocked_by_registration_gate`
- no wrong-house selected perimeter drawn
- manual approval disabled
- debug endpoint shows v2.2 transform evidence and missing fields.

No database migration is expected because the canonical `result_state` remains `ai_failed_source_acquisition`; new specificity lives in `hard_fail_reason`, `block_customer_report_reason`, and `geometry_report_json`.