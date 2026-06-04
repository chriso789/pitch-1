# Existing Measurement Source Verification

> **Status:** Pre-rewire audit. The AI Measurement button has **not** been rewired
> to the mskill pipeline. `USE_MSKILL_MEASUREMENT_PIPELINE` is OFF by default.
> Legacy routes remain canonical until every row in this audit is acted on.

This document is the single source of truth for what the existing pitch-1
measurement system already pulls, which path is the active writer, and which
modules must be **reused / wrapped / deprecated** when the mskill pipeline
becomes the orchestrator.

## 1. Functions, hooks, UI

| Path | Active / Legacy / Unknown | Data source pulled | Provider / API | Required secret | Tables written | Storage bucket | Artifact produced | Downstream consumer | Action |
|------|---------------------------|--------------------|----------------|-----------------|----------------|----------------|-------------------|---------------------|--------|
| `supabase/functions/start-ai-measurement/index.ts` | **active (canonical)** | Google Static Maps tile, USGS 3DEP DSM, Google Solar `roofSegmentStats`, county/parcel + footprint via `detect-building-footprint` | Google Maps, USGS, Google Solar | `GOOGLE_MAPS_API_KEY`, `GOOGLE_SOLAR_API_KEY` | `roof_measurements` (insert/update), `ai_measurement_jobs`, `measurement_jobs` | `roof-measurement-debug` | `geometry_report_json`, perimeter overlay PNG/SVG, structured measurements | `MeasurementReportDialog`, `render-measurement-pdf` | **wrap** behind `mskill.start_measurement_run` skill |
| `supabase/functions/start-ai-measurement/index.legacy.ts` | **legacy** | same as above (older code path) | same | same | `roof_measurements` (stamped `legacy_noncanonical_measurement_path`) | n/a | legacy `geometry_report_json` | dev tooling only | **deprecate after rewire** |
| `supabase/functions/measure-roof/index.ts` | **legacy** | Google Static Maps + heuristic edge detection | Google Maps | `GOOGLE_MAPS_API_KEY` | `roof_measurements` (stamped legacy) | n/a | rough area/perimeter | none (kept for parity tests) | **deprecate after rewire** |
| `supabase/functions/measure/index.ts` | **legacy** | input-only (no fetch) | n/a | n/a | `roof_measurements` (stamped legacy) | n/a | structured measurement from caller-supplied geometry | manual back-fill scripts | **deprecate after rewire** |
| `supabase/functions/analyze-roof-aerial/index.ts` | **legacy** | Google Static Maps tile | Google Maps, Anthropic Claude vision | `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY` | `roof_measurements` (stamped legacy), `ai_analysis_logs` | `roof-analysis` | qualitative AI notes | dev tooling | **wrap** as `mskill.classify_roof_type` skill (roof-type inference only) |
| `supabase/functions/detect-building-footprint/index.ts` | **active** | County GIS, Microsoft Building Footprints, OSM Buildings, Regrid parcels | County REST endpoints, MS Building Footprints, Overpass, Regrid | `REGRID_API_KEY` (optional) | `building_footprints`, `parcels` | n/a | wall-line footprint polygon, parcel polygon | `start-ai-measurement`, mskill `acquire_building_footprint` | **reuse** — single source of footprint truth |
| `supabase/functions/save-manual-footprint/index.ts` | **active** | user-drawn polygon | n/a | n/a | `building_footprints` (user_verified) | n/a | manual wall-line footprint | start-ai-measurement | **reuse** |
| `supabase/functions/validate-perimeter/index.ts` | **active** | persisted perimeter + DSM-derived bounds | internal | n/a | none (read + diagnostic) | n/a | shape-validation diagnostics | start-ai-measurement Phase 3A | **reuse** — wrap as `mskill.validate_perimeter` |
| `supabase/functions/render-measurement-pdf/index.ts` | **active** | reads `roof_measurements` row | internal | n/a | updates `report_pdf_url` only | `measurement-reports` | customer-facing PDF | UI download | **gate** behind `export_report` skill in mskill mode |
| `supabase/functions/generate-roof-report/index.ts` | **active** | reads `roof_measurements` row | internal | n/a | updates `report_pdf_url` only | `measurement-reports` | alt PDF format | UI download | **gate** behind `export_report` skill in mskill mode |
| `supabase/functions/generate-measurement-visualization/index.ts` | **active** | reads geometry json | internal | n/a | none | `roof-measurement-debug` | overlay PNG | visual QA | reuse |
| `supabase/functions/generate-roof-line-overlay/index.ts` | **active** | reads geometry json | internal | n/a | none | `roof-measurement-debug` | overlay SVG | visual QA | reuse |
| `supabase/functions/recalculate-measurement-from-overrides/index.ts` | **active (sanctioned)** | reads `measurement_overrides` | internal | n/a | `roof_measurements` (override-recalc) | n/a | recalculated totals | UI | **keep** — Patent Rule 5 path, not subject to single-writer lock |
| `supabase/functions/roof-report-ingest/index.ts` | **active** | uploaded EagleView / Roofr / Hover PDFs | Anthropic Claude (parse) | `ANTHROPIC_API_KEY` | `roof_measurement_benchmarks`, `roof_measurements` (vendor-verified) | `roof-reports` | typed `roof_lines` + benchmark row | benchmark gate | **reuse** as vendor-evidence source |
| `supabase/functions/compare-ai-measurement-to-vendor/index.ts` | **active** | reads benchmarks + measurement | internal | n/a | `roof_measurement_benchmarks` | n/a | comparison diagnostics | publish gate | **reuse** |
| `supabase/functions/measurement-api/index.ts` | **active (new pipeline orchestrator)** | brokers mskill jobs | internal | n/a | `measurement_requests`, `mskill_runs`, `mskill_artifacts` | `mskill-artifacts` | request lifecycle | new pipeline | **active orchestrator** — destination of button when flag flips |
| `supabase/functions/debug-measurement-runtime/index.ts` | **active** | reads `roof_measurements` provenance | internal | n/a | none (read-only) | n/a | route audit JSON | master/admin debug page | reuse |
| `src/components/measurements/PullMeasurementsButton.tsx` | **active** | invokes `useMeasurementJob` | n/a | n/a | n/a | n/a | n/a | UI trigger | **single trigger** — will route based on `isMskillPipelineEnabled()` |
| `src/components/measurements/UnifiedMeasurementPanel.tsx` | **active** | reads `roof_measurements`, jobs | n/a | n/a | n/a | n/a | n/a | UI dashboard | reuse |
| `src/components/measurements/MeasurementWorkflow.tsx` | **active** | orchestrates UI steps | n/a | n/a | n/a | n/a | n/a | UI | reuse |
| `src/components/measurements/MeasurementReportDialog.tsx` | **active** | reads measurement row | n/a | n/a | n/a | n/a | n/a | UI report | reuse |
| `src/components/measurements/MeasurementVisualQAOverlay.tsx` | **active** | reads `geometry_report_json` overlay layers | n/a | n/a | n/a | n/a | overlay UI | UI | reuse |
| `src/hooks/useMeasurementJob.ts` | **active** | calls `start-ai-measurement` | n/a | n/a | indirect | n/a | job state | UI | **rewire target** — flag-gated dispatch to `measurement-api/pipeline/start` |

## 2. Existing shared helpers (must be wrapped, not duplicated)

| Helper | Purpose | mskill executor it MUST back |
|--------|---------|------------------------------|
| `_shared/dsm-derived-bounds-runtime.ts` | crops DSM tile around footprint | `acquire_dem_dtm`, `acquire_roof_surface` |
| `_shared/dsm-diagnostic-propagation.ts` | persists DSM gates | `validate_geometry` |
| `_shared/perimeter-refinement.ts` | conservative perimeter refinement | `refine_perimeter` |
| `_shared/ridge-clustering.ts` | ridge/hip/valley clustering | `extract_topology` |
| `_shared/ridge-cluster-region-split.ts` | region split for cluster merge | `extract_topology` |
| `_shared/autonomous-graph-solver.ts` | canonical roof graph solver | `extract_topology` |
| `_shared/backbone-seed.ts` + `backbone-network.ts` | locked ridge/valley backbone | `extract_topology` |
| `_shared/constraint-roof-solver.ts` | reverse-geometry solver fallback | `extract_topology` |
| `_shared/constraint-solver-repair.ts` | repair pass | `extract_topology` |
| `_shared/roof-lines.ts` | typed `roof_lines` builder | `build_roof_lines` |
| `_shared/result-state.ts` | result-state normalizer | every skill that writes a final status |
| `_shared/footprint-source.ts` | footprint provenance normalizer | `acquire_building_footprint` |
| `_shared/mskill/writer-guard.ts` | **single-writer guard** | every executor and every legacy fn |
| `_shared/mskill/provenance.ts` | 11-field stamp | every executor |

**Rule:** when the rewire happens, mskill executors must `import` the helper
above. Re-implementing the helper inside an executor is a regression.

## 3. Source / provider inventory (data feeding the system)

Already documented in `docs/measurement-conflict-lock.md`. Cross-checked against
function audit above:

- **Aerial imagery:** Google Static Maps (`GOOGLE_MAPS_API_KEY`) — sole source.
- **Satellite imagery:** Google Static Maps satellite type — sole source.
- **DSM:** USGS 3DEP via `dsm-derived-bounds-runtime` — primary surface evidence.
- **DEM/DTM:** USGS 3DEP DTM — used by `acquire_dem_dtm` executor.
- **Roof mask:** Google Solar Building Insights `roofSegmentStats` mask.
- **Roof outline / perimeter:** county GIS → MS Building Footprints → OSM (wall-line); roof perimeter candidates derived by `_shared/mskill/perimeter-offset-geom.ts`.
- **Ridge / segment evidence:** DSM-derived edges + Solar segment outlines + autonomous graph solver.
- **Visual QA:** debug overlay PNG/SVG from `generate-measurement-visualization` and `generate-roof-line-overlay`.
- **PDF / report:** `render-measurement-pdf` (canonical) + `generate-roof-report` (alt).

## 4. Open conflicts identified

1. `start-ai-measurement/index.legacy.ts`, `measure-roof`, `measure` all still
   write `roof_measurements`. They are stamped legacy but they are still
   reachable. Action: assert `assertFinalWriterAllowed` is invoked at every
   insert site (see `docs/measurement-conflict-lock.md`).
2. `render-measurement-pdf` and `generate-roof-report` will render a PDF for
   any row, including a non-canonical row, unless `assertExportReportGate` is
   added in mskill mode.
3. `dsm-derived-bounds-runtime`, `perimeter-refinement`, `ridge-clustering`,
   `ridge-cluster-region-split` currently expose write helpers that can persist
   to `roof_measurements` / debug artifacts without an `mskill_runs` parent.
   Action: gate via `assertWrappedHelperCall` before the rewire.
4. UI components still read `roof_measurements` directly. After the rewire they
   must remain backward-compatible: the bridge writes the same row shape.

## 5. Action plan (do not execute before approval)

- [x] Stamp legacy routes with `canonical_measurement_route = false` (done).
- [x] Add `writer-guard.ts` + `provenance.ts` (done).
- [ ] Inject `assertFinalWriterAllowed` at each legacy insert site (gated by flag).
- [ ] Inject `assertExportReportGate` at PDF render entry (gated by flag).
- [ ] Inject `assertWrappedHelperCall` at each shared helper write site (gated by flag).
- [ ] Flip `useMeasurementJob.startJob` dispatch when flag is ON.

All steps above are still **blocked on user approval** of this audit.
