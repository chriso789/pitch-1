
# Pivot: Aerial-Registered Geometry First, DSM as Validation

## Goal

Stop treating DSM as the final judge. When registered aerial geometry exists (raster_url + geo→raster transform + valid perimeter ring with adequate mask IoU), the run must continue, persist that geometry as the primary scaffold, and degrade DSM to a validation tier. Only the customer-ready gate stays strict.

## Source of truth hierarchy (new)

```
Primary       : registered aerial roof perimeter + aerial candidate graph
Secondary     : Google Solar mask + solar segments
Validation    : DSM pitch / topology / ridges (optional, not fatal)
```

The infrastructure for the primary tier already landed last turn (`aerial-candidate-graph.ts`, debug-bag wiring, overlay fallback, dialog row). This pivot wires it into the canonical control flow so it actually replaces the DSM-first decision tree.

## Scope (backend)

All changes are inside `supabase/functions/start-ai-measurement/index.ts` and small additions in `_shared/`. No DB migration. No new edge function. No geometry-gate relaxation. Canonical route preserved.

### 1. New module: `_shared/aerial-primary-gate.ts`

Pure function `evaluateAerialPrimacy({ perimeterTopologySnapshot, targetMaskIsolation, rasterUrl, rasterBoundsLatLng, geoToRasterTransform, footprintSource })` returns:

```ts
{
  aerial_primary_ready: boolean,        // can we proceed without DSM?
  reasons: string[],                    // which checks passed/failed
  perimeter_area_sqft: number | null,
  mask_iou: number | null,
  candidate_edge_count: number,
}
```

Pass conditions (ALL):
- `rasterUrl` present
- `geoToRasterTransform` present
- `perimeter_ring_px.length ≥ 4` AND `perimeter_ring_geo.length ≥ 4`
- `target_mask_isolation.perimeter_vs_mask_iou ≥ 0.75` (or `≥ 0.70` when `target_mask_isolation.target_mask_overlap ≥ 0.95`)
- `footprintSource ∈ { google_solar_roof_mask, osm_overpass, user_verified_perimeter, parcel_then_mask_refined, … }` — anything except `none` / `unknown` / `blocked_by_registration_gate`

### 2. Hard-block downgrades (lines 6122 + 6197 in `index.ts`)

Both existing hard-block branches gain a pre-check: if `evaluateAerialPrimacy().aerial_primary_ready === true`, do NOT take the hard-block branch. Instead route to a new "aerial-primary persistence" handler (Section 3).

The original hard-block stays as the fallback when aerial primacy is also unavailable. This preserves the current behavior for the truly-no-geometry case.

### 3. New handler: `persistAerialPrimaryGeometry(...)`

Called when DSM is blocked (unknown footprint, coord match fail, or transform invalid) but aerial primary IS ready. It writes:

- `result_state = normalizeResultStateForWrite("perimeter_only", debugPayload)` — NOT `ai_failed_runtime`. `perimeter_only` is already in the TrueRoofPerimeter three-state contract.
- `hard_fail_reason = null` (no hard fail — just downgraded scope)
- `block_customer_report_reason = "dsm_validation_unavailable"` (or `"dsm_transform_invalid"` when applicable)
- `customer_report_ready = false` (stays strict — aerial-only never unlocks the customer report on its own)
- `report_blocked = true`, `needs_review = true`
- `geometry_report_json`:
  - `primary_geometry_source = "aerial_registered"`
  - `aerial_candidate_roof_graph` (already built by debug bag)
  - `dsm_validation_status = { available: false, reason: <dsm_*_token> }`
  - `route_provenance` stamps untouched (canonical route preserved)
  - `phase3C/3D/3E` get `executed: false, skipped_reason: "dsm_validation_unavailable_primary_aerial_used"`

### 4. Post-Phase-3A.5 path (line ~7081, `solveAutonomousGraph` call)

After Phase 3A.5 succeeds, the solver still runs IF DSM is healthy. New decision:

- DSM healthy (transform valid, coord match) → run `solveAutonomousGraph` exactly as today. DSM acts as validator + topology source. Customer-ready gate unchanged.
- DSM unhealthy but aerial primary ready → skip `solveAutonomousGraph`, persist via `persistAerialPrimaryGeometry` with `result_state="perimeter_only"`.
- Neither → existing hard-fail behavior.

`solveAutonomousGraph` itself is NOT modified.

### 5. Pre-Phase-3A.5 CPU preempt sites (lines 6532, 6567)

Already wired to carry the aerial graph through `buildPreTopologyDebugBag`. No code change needed; they keep failing as `ai_failed_runtime / ai_measurement_cpu_timeout` because that's the correct bucket for a real wall-clock timeout. Aerial primacy does not override CPU timeouts.

### 6. Result-state contract (no migration)

`perimeter_only` is already DB-safe per the Result-State Contract. The change is purely which inputs map to it. The `normalizeResultStateForWrite` mapping table gets one new branch:
- input `"aerial_primary_dsm_unavailable"` → `"perimeter_only"`.

## Scope (frontend)

### 7. `MeasurementReportDialog.tsx`

Add three explicit diagnostic rows (alongside the existing "Aerial Candidate Graph" row from last turn):

- **Primary Geometry Source** — reads `grj.primary_geometry_source` (e.g. `aerial_registered`, `dsm_validated`, `—`).
- **DSM Validation Status** — `available | unavailable: <reason>`.
- **Customer Report Blocker** — surfaces `block_customer_report_reason` distinctly from `hard_fail_reason`, so "DSM validation unavailable — aerial geometry persisted" stops looking like a runtime failure.

### 8. `measurementDiagnosticState.ts`

Add `primary_geometry_source` + `dsm_validation_status` to the resolved diagnostic state. Blocker copy when `aerial_primary_ready && !dsm_validated`: "DSM validation unavailable — aerial roof geometry persisted for review (not customer-ready)."

### 9. `MeasurementVisualQAOverlay.tsx`

Already prioritizes `aerial_candidate_roof_graph.perimeter_ring_px` (done last turn). No change needed beyond a header chip that says "Primary: Aerial Registered Geometry" when the new state applies.

## Tests

### Backend (Deno)

1. `aerial-primary-gate.test.ts` — unit: pass / fail conditions, IoU thresholds, footprint source allowlist.
2. `aerial-primary-replaces-dsm-hardblock.test.ts` — given aerial primary ready + DSM coord-match fail, exercise the branch selector and assert it routes to `persistAerialPrimaryGeometry`, not the hard-block branch.
3. `aerial-primary-result-state.test.ts` — asserts the persisted row has `result_state="perimeter_only"`, `block_customer_report_reason="dsm_validation_unavailable"`, `customer_report_ready=false`, `primary_geometry_source="aerial_registered"`, route_provenance intact.
4. `dsm-healthy-still-runs-solver.test.ts` — regression: when DSM transform valid + coord match true, `solveAutonomousGraph` still runs (no behavioral drift on the healthy path).
5. `cpu-preempt-not-overridden-by-aerial.test.ts` — CPU timeout still fails as `ai_failed_runtime`, not silently downgraded.

### Frontend (vitest)

6. `MeasurementReportDialog.aerial-primary.test.tsx` — renders the three new rows correctly for an aerial-primary row.
7. `MeasurementVisualQAOverlay.aerial-primary-header.test.tsx` — header chip appears when `primary_geometry_source==='aerial_registered'`.

## Guardrails (explicit non-goals)

- No geometry-gate relaxation. Customer-ready gate (typed roof_lines, valid pitch, topology validation, vendor benchmark) is untouched.
- No DB migration. `perimeter_only` already exists.
- No fake customer report. Aerial-only NEVER flips `customer_report_ready=true`.
- Canonical route preserved: only `start-ai-measurement` writes canonical rows. Legacy routes unchanged.
- `solveAutonomousGraph` is not modified — only when it runs.
- UNet stays unbuilt (per Core memory).

## Acceptance signals (next Fonsica rerun)

After deploy, a Fonsica run with the current DSM-broken state should produce:

- `result_state = perimeter_only` (not `ai_failed_runtime`)
- `hard_fail_reason = null`
- `block_customer_report_reason = dsm_validation_unavailable`
- `primary_geometry_source = aerial_registered`
- `aerial_candidate_roof_graph.edges.length ≥ 6`
- `customer_report_ready = false`
- Viewer renders aerial perimeter + Solar segments overlay from raster_px (no blank report)
- Report dialog shows the three new diagnostic rows
- Debug roof_lines count > 0; reportable roof_lines count = 0 (since topology never validated)

## Files changed

- `supabase/functions/_shared/aerial-primary-gate.ts` (new)
- `supabase/functions/_shared/result-state.ts` (mapping branch only)
- `supabase/functions/start-ai-measurement/index.ts` (two hard-block downgrades + post-3A.5 decision + new persistence helper)
- `src/components/measurements/MeasurementReportDialog.tsx`
- `src/components/measurements/MeasurementVisualQAOverlay.tsx`
- `src/lib/measurements/measurementDiagnosticState.ts`
- 7 new test files (5 Deno + 2 vitest)
