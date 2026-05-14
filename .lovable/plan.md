
# Patent-Aligned AI Measurement Workflow

This plan turns the patent rules into hard workflow gates in the AI Measurement system. Five enforcement rules, in dependency order. Each is shippable on its own; the order matters because later rules consume the data the earlier rules persist.

---

## Rule 1 — Confirm Roof Target Before Measurement

**Goal:** No measurement runs against a geocoded coordinate alone. The user must accept a draggable marker on the actual roof structure first.

**UI**
- New `ConfirmRoofTargetDialog` opened when the user clicks **AI Measurement**.
- Mapbox satellite preview centered on the job's geocoded point, draggable pin.
- "Confirm Roof Target" button enabled only after the marker is moved or explicitly accepted.
- Admin override checkbox (master/COB role only) labeled "Skip target confirmation".

**Persistence (new columns on `ai_measurement_jobs`)**
- `original_geocode_lat`, `original_geocode_lng`
- `confirmed_roof_center_lat`, `confirmed_roof_center_lng`
- `marker_offset_ft`
- `user_confirmed_roof_target boolean default false`
- `roof_target_confirmed_by uuid`, `roof_target_confirmed_at timestamptz`

**Edge function gate (`start-ai-measurement`)**
- Hard gate at function entry: if `user_confirmed_roof_target !== true` and no admin override flag, fail immediately with `result_state = 'ai_failed_target_unconfirmed'` and persist a row with the diagnostic.
- Confirmed coordinate becomes the single source for: Google Solar query, static aerial tile center, DSM/data layers fetch, OSM/Mapbox fallback, perimeter extraction. The original geocode is kept only as diagnostic metadata.

---

## Rule 2 — Layer 1 = True Roof Perimeter

**Goal:** No internal topology runs until a valid Layer-1 outermost roof perimeter exists. This formalizes the existing TrueRoofPerimeter contract as an explicit layered drawing model.

**Allowed Layer-1 sources**
- Eave / rake / roof free edge with gutter / roof free edge without gutter.

**Forbidden Layer-1 sources** (hard reject in code)
- Solar segment union, solar hull, solar bbox, parcel boundary, global mask bbox, interior plane contour.

**Implementation**
- Add `_shared/layer-model.ts` defining `Layer1Perimeter` with `source`, `geometry_px`, `geometry_geo`, `confidence`, `closed`, `self_intersections`, `forbidden_source_rejected_reasons[]`.
- `start-ai-measurement`: after Phase 0 builds the perimeter, classify the source. If forbidden → fail with `ai_failed_layer1_invalid`, persist diagnostics, return.
- Topology / solver invocations are wrapped in a single `requireLayer1()` guard. No solver call without a valid Layer 1.

---

## Rule 3 — Typed Roof Lines (RoofLine Model)

**Goal:** Replace the generic edge list with typed lines so report totals can never come from untyped/un-attributed segments.

**New table `roof_lines`** (one row per line, per measurement)
- `id`, `measurement_id`, `layer_id`
- `geometry_px jsonb`, `geometry_geo jsonb`
- `length_lf numeric`
- `non_dimensional_attribute text` — enum: `perimeter | eave | rake | ridge | hip | valley | step_flashing | wall_flashing | common | unknown`
- `source text` — `dsm | solar | mask_contour | user_override | inferred`
- `confidence numeric`
- `adjacent_plane_ids uuid[]`
- `can_be_customer_reported boolean`
- RLS: tenant-scoped via `measurement_id → ai_measurement_jobs.tenant_id`

**Code**
- `_shared/roof-lines.ts` with `RoofLine` type, builder, and `aggregateLineTotalsByAttribute()` (returns ridges_lf, hips_lf, valleys_lf, eaves_lf, rakes_lf only from rows where `can_be_customer_reported = true`).
- Solver/perimeter writes go through this builder; the legacy `geometry_report_json.edges` remains for debug only.
- `roof_measurements` totals are recomputed from `roof_lines`. If any reportable total has zero typed-line backing, gate fails with `untyped_edge_totals_blocked`.

---

## Rule 4 — Patent Pitch Direction Enforcement

**Goal:** Final pitch comes from perimeter↔ridge geometry, never from collapsed/undersegmented faces.

**Rules (in order)**
1. Plane has a ridge parallel to a perimeter edge → pitch runs ridge → perimeter.
2. Multiple ridges → average ridge orientation, resolve toward nearest perimeter.
3. Plane enclosed by valleys → average adjacent plane pitches.
4. Plane has perimeter edges only (no ridges) → pitch runs toward longest perimeter edge.
5. If topology is invalid (collapsed, < min faces, no ridges on >4-facet roof) → use Google Solar `roofSegmentStats` pitch. If Solar absent, mark `pitch_unavailable`.

**Implementation**
- `_shared/pitch-resolver.ts`:
  - `resolvePlanePitch(plane, perimeter, ridges, valleys, neighbors)` returning `{ pitch, source, confidence, derivation }`.
  - `pitch_source` enum: `perimeter_ridge | ridge_average | valley_enclosed | perimeter_only | solar_fallback | unavailable`.
- Hard block: if `pitch_source === 'collapsed_plane_fit'` → reject and fall back to Solar.
- Persist per-plane `pitch_derivation` so the report can show why each pitch was chosen.

---

## Rule 5 — Interactive Override / Recalculation Loop

**Goal:** Users can correct the AI draft and the report recalculates from overrides.

**New table `measurement_overrides`**
- `id`, `measurement_id`, `override_kind text` — `perimeter_point_moved | line_added | line_deleted | line_type_changed | pitch_overridden | reference_length_overridden`
- `target_line_id uuid null`, `target_plane_id uuid null`
- `before jsonb`, `after jsonb`
- `created_by uuid`, `created_at timestamptz`
- `override_source text default 'user_verified'`
- RLS: tenant-scoped, edit allowed for managers/admins/master.

**On measurement record**
- `recalculated_from_overrides boolean default false`
- `override_validation_status text` — `pending | passed | failed`

**UI (`MeasurementReportDialog` → new `RoofDiagramEditor` panel)**
- Drag perimeter points, add/delete lines, set line type, override per-plane pitch, override a reference length.
- "Recalculate from overrides" button calls a new edge function `recalculate-measurement-from-overrides` that:
  1. Loads `roof_lines` + applied `measurement_overrides`.
  2. Rebuilds totals: area, squares, ridges/hips/valleys/eaves/rakes LF, material qty.
  3. Re-runs the patent pitch rules on the corrected geometry.
  4. Validates closure + Layer 1 + typed coverage.
  5. Sets `customer_report_ready = true` only if AI gates passed OR user overrides pass validation.

---

## Cross-cutting enforcement (single guard module)

`_shared/measurement-gates.ts` exposes one entrypoint used by every code path that wants to mark a measurement customer-ready:

```text
assertCustomerReportReady(measurement) must verify ALL:
  1. user_confirmed_roof_target = true (or admin override flag)
  2. layer_1_perimeter present, source not forbidden
  3. roof_lines exist; all reported totals derived from typed lines
  4. every plane has a non-collapsed pitch_source
  5. either AI gates passed OR override_validation_status = 'passed'
```

Any failure → `customer_report_ready = false` with a specific `block_customer_report_reason`.

---

## Database migrations (one batch)

1. Add target-confirmation columns to `ai_measurement_jobs`.
2. Create `roof_lines` (RLS by tenant via parent measurement).
3. Create `measurement_overrides` (RLS by tenant, manager/admin/master write).
4. Add `recalculated_from_overrides`, `override_validation_status`, `pitch_source`, `block_customer_report_reason` columns to `roof_measurements`.

---

## Edge functions

- **New:** `recalculate-measurement-from-overrides`
- **Modified:** `start-ai-measurement` — add Rules 1, 2, 3, 4 gates; emit typed `roof_lines`; emit `pitch_derivation`.

---

## UI components

- **New:** `ConfirmRoofTargetDialog`, `RoofDiagramEditor`, `LineAttributeChip`, `OverridePanel`.
- **Modified:** `MeasurementReportDialog` — show Layer-1 source, typed-line totals, per-plane pitch derivation, "Edit & Recalculate" entrypoint.
- **Modified:** AI Measurement button handler — open `ConfirmRoofTargetDialog` first, only invoke `start-ai-measurement` after confirmation.

---

## Memory updates after ship

- Update Core: "AI Measurement requires user-confirmed roof target before run; Layer 1 perimeter is the only allowed pre-topology layer; report totals come exclusively from typed `roof_lines`; pitch must follow patent perimeter/ridge logic; customer report ready requires either AI gates pass or validated user overrides."
- New memory file: `mem://architecture/measurement-system/patent-workflow-enforcement` with the five rules, the gate module name, and the override table contract.

---

## Build order (recommended)

1. **Migration** for all four schema changes (one approval).
2. **Rule 1** (confirm-target) end-to-end — smallest, biggest accuracy win.
3. **Rule 2** (Layer 1 typing) — formalize what's already mostly there.
4. **Rule 3** (typed `roof_lines`) — required before Rules 4 & 5 are useful.
5. **Rule 4** (pitch resolver).
6. **Rule 5** (override editor + recalculate function).
7. Wire `assertCustomerReportReady` as the single ready-gate.

I will not start until you approve the plan. If you want to ship rules in a different order, or skip any (e.g., defer Rule 5's editor and only ship the `measurement_overrides` table for now), say so and I'll re-issue.
