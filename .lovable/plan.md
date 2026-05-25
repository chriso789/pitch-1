## Diagnosis

The latest Fonsica run did NOT regress geometrically. It regressed because the registration-gate cleanup writes a diagnostic value (`blocked_by_registration_gate`) directly into the `roof_measurements.footprint_source` DB column, which is constrained to a whitelist (`mapbox_vector`, `regrid_parcel`, …, `unknown`, etc.). The insert explodes, the pipeline falls into `processJob_outer_catch`, and the cheap pre-topology debug bag we just added never gets persisted because the row write happens BEFORE the snapshot is flushed and there is no isolated boundary around persistence.

A normalizer (`normalizeRoofMeasurementFootprintSource`) already exists at L14103 — it is just bypassed by the three registration-cleanup writes at L1899/1927-28/1944 and one legacy write at L4116 (`google_solar_roof_mask`).

This is a persistence-contract bug, not a geometry bug. Scope is intentionally narrow.

## Scope (edge-function-only, no schema migration)

Confined to:

- `supabase/functions/start-ai-measurement/index.ts`
- `supabase/functions/_shared/pre-topology-debug-bag.ts` (read-only types extension)
- new Deno tests under `supabase/functions/start-ai-measurement/__tests__/`

Explicit non-goals: no DB constraint change, no relaxation of any geometry gate, no frontend changes, no new preflight stage, no rework of registration logic itself.

## Fixes

### 1. Stop writing unconstrained `footprint_source` to the DB column

At every write site where a diagnostic label leaks into `(geometry|next).footprint_source`, split into two fields:

- `footprint_source` → always run through `normalizeRoofMeasurementFootprintSource(...)` so the DB column only ever sees a whitelisted value (`"unknown"` is the safe default).
- `footprint_source_diagnostic` → store the raw diagnostic label (`"blocked_by_registration_gate"`, `"google_solar_roof_mask"`, etc.) inside `geometry_report_json` only. Never written to the column.

Sites to patch:

- L1899 — registration-gate quarantine path.
- L1927-28 / L1944 — `runtimeStateWins` branch (`resolvedDiagnosticState.footprint_source`).
- L4116 — `google_solar_roof_mask` literal.
- Any other sites surfaced by a final `rg footprint_source` sweep that write into a `roof_measurements` payload object (not into `geometry_report_json`).

Also extend `resolveDiagnosticState(...)` (or the producer of `resolvedDiagnosticState`) so it returns BOTH:

```ts
{ footprint_source: <DB-safe>, footprint_source_diagnostic: <raw> }
```

and persist the raw label under `geometry_report_json.footprint_source_diagnostic` + `geometry_report_json.footprint_source_normalized_from`.

### 2. Defensive normalization at the chokepoint

Inside `prepareRoofMeasurementPayload` (or whichever helper feeds `insertRoofMeasurementWithSchemaGuard` / `updateRoofMeasurementWithSchemaGuard`), unconditionally:

```ts
const raw = payload.footprint_source;
const normalized = normalizeRoofMeasurementFootprintSource(raw);
if (normalized !== raw) {
  geometryReportJson.footprint_source_diagnostic ??= raw;
  geometryReportJson.footprint_source_normalized_from = raw;
}
payload.footprint_source = normalized;
```

This is the belt-and-braces guard: even if a new code path forgets, the row stays insertable.

### 3. Persist the debug bag BEFORE the constrained DB row

The Phase-3A.5 cleanup we just shipped persists the pre-topology debug bag via `persistCpuBudgetTerminalFailure → insertFailedPreliminaryMeasurement`. But on the registration-gate quarantine path the failing insert today fires from a different write site, and the debug bag is built only inside the CPU-budget helper.

Reorder so that for any "block-and-record" exit (registration-gate quarantine, runtime-state-wins, processJob outer catch):

1. Build the pre-topology debug bag (already cheap — same helper).
2. Write a minimal `geometry_report_json` snapshot via a new helper `persistDiagnosticSnapshotEarly(jobId, debugBag, reason)` that ONLY updates `ai_measurement_jobs.geometry_report_json` (no `roof_measurements` row, no constrained columns). This survives any subsequent `roof_measurements` insert failure.
3. Then attempt the `roof_measurements` insert with the normalized payload.

If step 3 throws a Postgres `23514` (check constraint) error, catch it locally, log the offending column/value into `geometry_report_json.schema_drift_stripped_columns` (per Schema & DB Drift Guard skill), strip the offending optional field to `"unknown"`, and retry once. Do NOT let it propagate to `processJob_outer_catch`.

### 4. Wire `dsm_split_status` end-to-end

The viewer already reads `dsm_split_status` but the backend ships `null`. Inside the source-acquisition path, emit:

```ts
debugBag.dsm_split_status = {
  fetch_decode:           { ok, ms, bytes, error?,  stage: "dsm_fetch_decode" },
  georegistration_transform: { ok, ms, error?,      stage: "dsm_georeg_transform" },
};
```

`buildPreTopologyDebugBag(...)` already passes `dsm_split_status` through — just populate the two sub-stages where DSM is fetched and where it is transformed. Both are pure pass-through booleans + timings, no new heavy work.

### 5. Isolate persistence boundaries

Introduce three small wrappers in `start-ai-measurement/index.ts`:

```ts
async function persistDiagnosticSnapshotEarly(jobId, debugBag, reason)  // updates ai_measurement_jobs only
async function persistMeasurementRow(payload, geometryReportJson)        // insert roof_measurements (with normalize+retry)
async function persistOverlayArtifacts(...)                              // existing storage writes
```

Each is wrapped in its own try/catch. A failure in one MUST NOT roll back the others. Failure metadata for each is appended to `geometry_report_json.persistence_audit[]` so the next run is debuggable from the row alone.

Specifically:

- `processJob_outer_catch` becomes a true last-resort path, not the place where DB-constraint failures land.
- Any caught constraint failure logs `failure_stage = "persist_measurement_row_constraint"` (not `processJob_outer_catch`).

### 6. Regression tests (new files, all Deno)

Under `supabase/functions/start-ai-measurement/__tests__/`:

- `footprint-source-normalization.test.ts`
  - Asserts `normalizeRoofMeasurementFootprintSource("blocked_by_registration_gate") === "unknown"`.
  - Asserts `normalizeRoofMeasurementFootprintSource("google_solar_roof_mask")` is mapped (not raw).
  - Asserts every value in `ALLOWED_FOOTPRINT_SOURCES` round-trips.
- `persist-measurement-row-constraint-retry.test.ts`
  - Mocks Supabase `.insert()` to throw a `23514`-shaped error on the first call, succeed on retry with `footprint_source="unknown"`.
  - Asserts `geometry_report_json.schema_drift_stripped_columns` includes `{ column: "footprint_source", value: "blocked_by_registration_gate", reason: "23514" }`.
  - Asserts the row finally lands.
- `early-diagnostic-snapshot.test.ts`
  - Calls the new `persistDiagnosticSnapshotEarly(...)` with a mocked Supabase.
  - Asserts it updates ONLY `ai_measurement_jobs.geometry_report_json`, never `roof_measurements`.
  - Asserts that a subsequent failing `persistMeasurementRow` does not clear the snapshot.
- `dsm-split-status-emission.test.ts`
  - Asserts the debug bag carries both `fetch_decode` and `georegistration_transform` sub-keys with `ok` + `stage`.

Tests reuse existing imports + the minimal `supabase` shim pattern from `pre-topology-debug-bag.test.ts`.

## Deploy + verification

1. Run new tests via `supabase--test_edge_functions` — must be green.
2. Deploy `start-ai-measurement`.
3. Rerun Fonsica from the lead UI.
4. Read the resulting row via `debug-measurement-runtime` and confirm:
  - `roof_measurements.footprint_source` is in the whitelist (likely `"unknown"`).
  - `geometry_report_json.footprint_source_diagnostic = "blocked_by_registration_gate"` (or similar).
  - `geometry_report_json.dsm_split_status.fetch_decode` + `…georegistration_transform` populated.
  - `geometry_report_json.debug_roof_lines[]` populated, every entry `debug_only:true, customer_ready:false`.
  - `failure_stage` is stage-correct, NOT `processJob_outer_catch`.
  - `persistence_audit[]` is present.

## Out of scope (explicit)

- No DB CHECK constraint change on `roof_measurements_footprint_source_check` or `result_state`.
- No relaxation of perimeter / topology / vendor-benchmark / footprint-sanity gates.
- No frontend changes (viewer already reads `dsm_split_status`, `debug_roof_lines`, `footprint_source_diagnostic`).
- No new preflight stage. No registration-logic rewrite. No `processJob` restructuring beyond wrapping the three persistence boundaries.  
  
Here’s the next drop-in in plain English:
  ## We are fixing ONE thing next:
  The backend is crashing because it’s writing an invalid `footprint_source` value into the database.
  That’s why the newest run looks worse.
  The exact failure is:
  ```

  ```
  ```
  new row for relation "roof_measurements"
  violates check constraint
  "roof_measurements_footprint_source_check"
  ```
  So the next drop-in is NOT geometry.  
    
  NOT topology.  
    
  NOT overlays.
  It is:
  # Normalize `footprint_source` before DB writes
  The backend currently tries to save internal diagnostic labels like:
  ```

  ```
  ```
  blocked_by_registration_gate
  registration_blocked
  coordinate_registration_failed
  ```
  into a DB column that only allows a limited enum/check list.
  That explodes the insert.
  ---
  # What the drop-in does
  ## 1. Add DB-safe normalization
  Example:
  ```

  ```
  ```
  footprint_source = "unknown"
  ```
  for DB storage.
  ---
  ## 2. Preserve the REAL diagnostic value in JSON
  Example:
  ```

  ```
  ```
  {
    "footprint_source_diagnostic":
      "blocked_by_registration_gate"
  }
  ```
  So diagnostics remain rich without violating the DB constraint.
  ---
  ## 3. Apply normalization to EVERY write path
  Including:
  -   
  failed preliminary inserts  

  -   
  registration failures  

  -   
  runtime failures  

  -   
  outer catch blocks  

  -   
  final writes  

  Right now only one path is exploding, but all of them need protection.
  ---
  ## 4. Add regression tests
  To guarantee:
  -   
  no invalid `footprint_source` reaches DB again  

  -   
  diagnostics still preserve the rich internal value  

  ---
  # Why this matters
  Right now the DB failure happens BEFORE:
  -   
  debug layers persist  

  -   
  overlays persist  

  -   
  DSM split status persists  

  -   
  CPU diagnostics persist  

  So the entire diagnostic chain collapses.
  Once this normalization is fixed:
  -   
  the backend will stop crashing early  

  -   
  the next rerun should finally show the real debug overlay and topology state again  

  That’s the actual next milestone.