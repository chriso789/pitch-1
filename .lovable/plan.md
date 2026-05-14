# AI Measurement: Perimeter-First Rebuild

## Goal
Make the "AI Measurement" button produce a customer-grade roof diagram by enforcing one rule:
**the true outer eave/rake perimeter must be solved and validated BEFORE any internal topology, pitch, or report is generated.**

Target benchmark (4063 Fonsica / Roofr):
- Area 3,077 sqft (±5%)
- Eaves+Rakes 264 LF (±5–8%)
- Pitch 6/12 (±1/12)
- Facets 14 (±25%)
- Hips/Ridges/Valleys within 10–15% (only after perimeter passes)

## Scope
This plan only touches the AI Measurement button flow:
- Frontend: `src/hooks/useMeasurementJob.ts` + the button component
- Backend: `supabase/functions/start-ai-measurement/index.ts` (the active ~6,600-line pipeline)
- Debug overlay: `DSMDebugOverlay` in `UnifiedMeasurementPanel.tsx`
- DB: `roof_measurements` and `measurement_jobs` (new perimeter columns + gate fields)

Nothing else (contacts, kanban, tasks, estimates) is affected.

## Architecture: 7 Stages, Hard Gates Between Each

```text
[1 Source Acquisition]
        |  must have aerial + (mask OR DSM)
        v
[2 TrueRoofPerimeter Engine]   <-- NEW, the core of this plan
        |  perimeter gate (area/coverage/missed regions)
        v
[3 Perimeter-Only Validation]
        |  pass -> continue
        |  fail -> hard fail w/ debug overlay, no report
        v
[4 Pitch Lock]  (Google Solar roofSegmentStats / DSM)
        v
[5 Reverse Topology Solver]  (uses locked perimeter + pitch as constraints)
        |  topology gate (no 0-ridge, no cross-roof diagonals, facet-count sanity)
        v
[6 Internal Lines]  (ridges/hips/valleys/facets)
        v
[7 Report Gate]
        - perimeter PASS + pitch PASS + topology PASS  -> customer_report_ready
        - perimeter PASS only                          -> perimeter_only diagnostic
        - perimeter FAIL                               -> ai_failed_perimeter
```

## Stage 2 — TrueRoofPerimeter Engine (the new module)

New file: `supabase/functions/start-ai-measurement/perimeter/trueRoofPerimeter.ts`

**Inputs (priority order):**
1. Aerial satellite image (Google Static / Mapbox)
2. Google Solar `roofMask` PNG (authoritative when present)
3. DSM roof-vs-ground height break raster
4. Solar segment union — INTERNAL HINT ONLY, never perimeter
5. OSM / Mapbox vector footprint — fallback hint only

**Forbidden as final perimeter** (hard-coded reject list):
- `solar_segment_union`
- `solar_segment_hull`
- `solar_bbox`
- `parcel_boundary`
- `osm_loose_outline`

These may be persisted as `perimeter_hints[]` for debug, never as `true_outer_roof_perimeter_*`.

**Algorithm:**
1. Rasterize Google roof mask → connected components
2. Outermost contour trace per component (largest first)
3. Fill interior holes (chimneys, AC units)
4. Merge nearby components within N pixels (covered patios, returns)
5. Snap contour to visible aerial roof boundary (edge-detect along normals)
6. Snap to DSM roof-to-ground break where mask is uncertain
7. Classify edges: `eave` (downhill-facing, lowest DSM), `rake` (along-pitch sides)
8. Detect corners (angle > threshold)
9. Compute `missed_roof_regions`: aerial roof pixels outside selected perimeter

**Outputs (persisted to `roof_measurements`):**
- `true_outer_roof_perimeter_px` (jsonb polygon)
- `true_outer_roof_perimeter_geo` (jsonb polygon)
- `eave_edges` (jsonb)
- `rake_edges` (jsonb)
- `roof_corners` (jsonb)
- `missed_roof_regions` (jsonb)
- `perimeter_confidence` (numeric)
- `perimeter_source` (enum: `mask_contour` | `mask_plus_aerial` | `mask_plus_dsm` | `aerial_only` | `failed`)
- `perimeter_hints` (jsonb — solar union, osm, etc., for debug)

## Stage 3 — Perimeter Gate (hard fail before any topology runs)

Customer-ready perimeter requires ALL of:
- area within 3–5% of expected (when vendor benchmark exists) OR within DSM-derived bounds
- perimeter covers ≥95% of roof mask
- `missed_roof_regions` area <5% of total roof area
- centroid offset <10–15 px from mask centroid
- when vendor baseline exists: eaves+rakes within 5–8%
- `unknown_perimeter_fraction` <10%

Failure → `hard_fail_reason = 'perimeter_failed_<sub_reason>'`, persist debug overlay, return early. **No pitch, no topology, no report.**

## Stage 5 — Topology Solver (only runs if perimeter passes)

Existing autonomous solver stays, but is reframed as a **constrained** solver:
- Outer ring is FIXED (cannot be modified, only subdivided)
- Pitch is LOCKED from Solar/DSM
- Candidates scored against DSM ridges + Solar segments as priors
- Reject any candidate with: 0 ridges on a ≥4-facet roof, edges spanning >50% of bbox diagonal, facet count off vendor benchmark by >25%

## Stage 7 — Three Report States

Replace today's binary pass/fail with three explicit states on `measurement_jobs.result_state`:
1. `customer_report_ready` — all gates pass, full diagram + measurements
2. `perimeter_only` — perimeter passed, topology failed; expose area/eaves/rakes/pitch only, no hip/ridge/valley numbers, badge the report "Perimeter verified — internal structure pending review"
3. `ai_failed_<stage>` — source/perimeter failed; show debug overlay, block customer export

## Debug Overlay (`DSMDebugOverlay`)

Render four outlines simultaneously, each toggleable:
- White: aerial visible roof outline (from edge detection)
- Green: selected final perimeter
- Blue: Google roof mask contour
- Yellow: solar segment union
- Red shaded: `missed_roof_regions`

Plus a panel showing perimeter gate metrics (area %, coverage %, missed %, centroid offset, eaves+rakes LF vs benchmark).

## Database Migration

Add to `roof_measurements`:
- `true_outer_roof_perimeter_px jsonb`
- `true_outer_roof_perimeter_geo jsonb`
- `eave_edges jsonb`
- `rake_edges jsonb`
- `roof_corners jsonb`
- `missed_roof_regions jsonb`
- `perimeter_confidence numeric`
- `perimeter_source text`
- `perimeter_hints jsonb`
- `perimeter_gate_metrics jsonb`
- `perimeter_status text` (`pass` | `fail` | `not_run`)

Add to `measurement_jobs`:
- `result_state text` (`customer_report_ready` | `perimeter_only` | `ai_failed_<stage>`)

## Implementation Order

1. DB migration (perimeter columns + result_state)
2. `trueRoofPerimeter.ts` module + unit tests against Fonsica fixture
3. Wire into `start-ai-measurement` between source acquisition and topology
4. Perimeter gate enforcement + early-return paths
5. Topology solver constrained to fixed perimeter
6. Three-state report gate
7. `DSMDebugOverlay` four-outline rendering
8. Frontend: surface `perimeter_only` state in the AI Measurement result panel

## Out of Scope
- UNet retraining (no model exists)
- Vendor benchmark ingestion changes
- Other measurement entry points (manual draw, bulk import)
- Any non-measurement UI

## Acceptance Test
Re-run AI Measurement on 4063 Fonsica:
- Perimeter area within 5% of 3,077 sqft
- Eaves+Rakes within 8% of 264 LF
- Debug overlay shows green perimeter matching aerial, no red missed regions
- If topology still collapses, system returns `perimeter_only` (not a fake 6-facet report)
