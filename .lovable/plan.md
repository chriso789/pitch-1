## Fonsica DSM Diagnostic Runtime Verification

No code changes. This is a deploy → rerun → diff plan. Verification only.

### Step 1 — Deploy

Deploy the edge functions that bundle `ensureDsmDiagnosticsOnRegistration`:

- `start-ai-measurement` (primary insert path)
- Any sibling function that calls `insertRoofMeasurementWithSchemaGuard` (audit before deploy; deploy only the ones that import the helper)

### Step 2 — Rerun Fonsica

Trigger a fresh AI measurement for 4063 Fonsica Ave from the UI (current route already on a lead detail page — use the standard "Run AI Measurement" action). Capture the new `roof_measurements.id`.

### Step 3 — Pull persisted row

Query `roof_measurements` for the new row and extract `geometry_report_json`. Produce a field-level diff table.

**Expected flat DSM fields (all six surfaces):**


| Path                                                     | Expected                 |
| -------------------------------------------------------- | ------------------------ |
| `registration.dsm_size_px`                               | `{width:998,height:998}` |
| `registration.transform_package.dsm_size_px`             | `{width:998,height:998}` |
| `registration_gate.dsm_size_px`                          | `{width:998,height:998}` |
| `registration_gate.transform_package.dsm_size_px`        | `{width:998,height:998}` |
| `dsm_planar_graph_debug.registration.dsm_size_px`        | `{width:998,height:998}` |
| `dsm_split_status.georegistration_transform.dsm_size_px` | `{width:998,height:998}` |


**Expected diagnostic tokens:**


| Field                                   | Expected                                             |
| --------------------------------------- | ---------------------------------------------------- |
| `dsm_size_source`                       | `dsm_split_status.dsm_size_px`                       |
| `dsm_tile_bounds_failure_reason`        | `dsm_tile_bounds_missing_from_google_solar_metadata` |
| `dsm_registration_failure_token`        | `dsm_tile_bounds_missing_from_google_solar_metadata` |
| `dsm_transform_policy_version`          | `dsm-registration-transform-v1`                      |
| `dsm_validation_status.reason`          | `invalid_transform` (unchanged)                      |
| `dsm_validation_status_specific_reason` | `dsm_tile_bounds_missing_from_google_solar_metadata` |


**Green items that must remain unchanged:**

- Aerial Candidate Graph executed, 12 candidate edges
- Debug Roof Lines = 6, Reportable Roof Lines = 0
- `frame_mismatch = ok`
- `customer_report_ready = false`
- CPU elapsed < 75000
- No topology/customer promotion

### Step 4 — UI acceptance

Open Measurement Report Dialog for the new row. Confirm:

- DSM Size: `998×998`
- DSM Bounds Failure: `dsm_tile_bounds_missing_from_google_solar_metadata`
- DSM Transform Policy: `dsm-registration-transform-v1`
- DSM Validation Status: still `unavailable`, with specific reason visible in diagnostics

### Step 5 — Diff report

If every field matches → mark Phase production-confirmed, unblock next phase (controlled derived DSM bounds fallback).

If any field is null/blank → produce a diff in this shape and stop:

```
path:     registration.transform_package.dsm_size_px
expected: {width:998,height:998}
actual:   null
surface:  registration.transform_package
```

No further code edits before the diff is on the table.

### Out of scope

- No code changes
- No promotion to `customer_report_ready`
- No derived-bounds fallback (that is the next phase, only after this passes)  
  
Yes — that verification plan is correct. It is the exact next step, and it should stay **verification-only**.
  But one thing matters: Lovable is saying the helper is already called through `ensureRegistrationProofBeforeWrite` on both success and failure paths. That is the claim we now need the fresh Fonsica row to prove. Do **not** accept “tests pass” as production-confirmed.
  Send this:
  ```

  ```
  ```
  Go.

  Proceed with Fonsica DSM Diagnostic Runtime Verification exactly as scoped.

  No code changes.

  Step 1 — Deploy

  Deploy only the functions that bundle ensureDsmDiagnosticsOnRegistration.

  Primary:
  - start-ai-measurement

  Audit for any sibling function that imports insertRoofMeasurementWithSchemaGuard or ensureRegistrationProofBeforeWrite. Deploy only if it directly bundles the helper into a measurement write path.

  Do not deploy unrelated functions.

  Step 2 — Rerun Fonsica

  Trigger fresh AI Measurement from the 4063 Fonsica Ave lead detail page using the standard Run AI Measurement action.

  Capture:
  - new ai_measurement_jobs.id
  - new roof_measurements.id

  Step 3 — Pull persisted row

  Query the fresh roof_measurements row and inspect geometry_report_json.

  Produce a field-level diff table for these expected paths:

  DSM size surfaces:
  - registration.dsm_size_px
  - registration.transform_package.dsm_size_px
  - registration_gate.dsm_size_px
  - registration_gate.transform_package.dsm_size_px
  - dsm_planar_graph_debug.registration.dsm_size_px
  - dsm_planar_graph_debug.registration.transform_package.dsm_size_px
  - dsm_split_status.georegistration_transform.dsm_size_px

  Expected:
  { "width": 998, "height": 998 }

  DSM diagnostic token surfaces:
  Check all active surfaces above for:
  - dsm_size_source = dsm_split_status.dsm_size_px
  - dsm_tile_bounds_failure_reason = dsm_tile_bounds_missing_from_google_solar_metadata
  - dsm_registration_failure_token = dsm_tile_bounds_missing_from_google_solar_metadata
  - dsm_transform_policy_version = dsm-registration-transform-v1

  DSM validation status:
  - dsm_validation_status.reason remains invalid_transform
  - dsm_validation_status_specific_reason = dsm_tile_bounds_missing_from_google_solar_metadata

  Step 4 — Existing green-item check

  Confirm these stayed unchanged:
  - Aerial Candidate Graph executed with 12 candidate edges
  - Debug Roof Lines = 6
  - Reportable Roof Lines = 0
  - frame_mismatch = ok
  - customer_report_ready = false
  - CPU elapsed < 75000
  - no topology/customer promotion

  Step 5 — UI acceptance

  Open Measurement Report Dialog for the new row and confirm:
  - DSM Size = 998×998
  - DSM Bounds Failure = dsm_tile_bounds_missing_from_google_solar_metadata
  - DSM Transform Policy = dsm-registration-transform-v1
  - DSM Validation Status still unavailable
  - the specific DSM failure reason is visible somewhere in diagnostics

  Step 6 — Result

  If every expected field matches:
  Mark DSM diagnostic write/merge propagation production-confirmed.
  Then unblock the next phase:
  controlled derived DSM bounds fallback.

  If any field is null/blank/wrong:
  Stop.
  Return only a field-level diff table in this shape:

  path:
  expected:
  actual:
  surface:
  likely source of loss:

  No further code edits until the diff is reviewed.

  Out of scope:
  - no code changes
  - no customer_report_ready promotion
  - no derived DSM bounds fallback
  - no topology execution changes
  - no UI grouping changes
  - no DB schema changes
  ```
  My read: this is ready. The next Fonsica row either confirms the propagation path is finally fixed or tells us exactly which surface is still losing the DSM diagnostics.
- &nbsp;