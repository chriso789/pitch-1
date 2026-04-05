

## Data Fusion Layer — Multi-Source Measurement Accuracy Overhaul

### What You Already Have (It's More Than You Think)

Your system is NOT starting from zero. Here's what's already wired and working:

| Layer | Status | Source |
|-------|--------|--------|
| Google Solar API (pitch, segments, area) | Built | `google-solar-api.ts`, `measure/index.ts` |
| Mapbox Satellite imagery | Built | `fetch-mapbox-imagery`, `analyze-roof-aerial` |
| Mapbox Vector footprints (Tilequery) | Built | `mapbox-footprint-extractor.ts` |
| Microsoft/Esri buildings fallback | Built | `footprint-resolver.ts` |
| OSM buildings fallback | Built | `footprint-resolver.ts` |
| Straight skeleton topology | Built | `straight-skeleton.ts`, `roof-topology-builder.ts` |
| DSM elevation analysis | Built | `dsm-analyzer.ts` (reads Solar API DSM) |
| Facet splitting + area calc | Built | `facet-area-calculator.ts`, `facet-splitter.ts` |
| Edge classification (ridge/hip/valley/eave/rake) | Built | `gable-detector.ts`, `segment-topology-analyzer.ts` |
| QA gate + cross-validation | Built | `measurement-qa-gate.ts`, `qa-checks.ts` |
| Unified pipeline orchestrator | Built | `unified-measurement-pipeline.ts` |
| Ridge calibration | Built | `ridge-calibrator.ts` |
| Correction tracker (learning) | Built | `correction-tracker.ts` |

**What's actually broken is not the components — it's that they don't fuse properly.**

### What's Actually Missing (The Gaps)

1. **No Mapbox Terrain elevation** — You use Solar API DSM (which only covers buildings Google has scanned). Mapbox Terrain-RGB tiles cover everywhere and give ground + surface elevation for proper pitch calculation on buildings Solar doesn't cover.

2. **No imagery-to-geometry calibration** — The AI vision functions (`analyze-roof-aerial`, `roof-segmentation`, `generate-roof-overlay`) detect lines in pixel space but don't have a reliable pixel→feet conversion anchored to the footprint polygon. The `measurement-calibration` edge function exists but isn't wired into the main pipeline.

3. **No fusion reconciliation** — When Solar says 2,800 sqft and the skeleton says 2,400 sqft, there's no arbitration logic. The pipeline just picks one. Roofr cross-validates and weighted-averages.

4. **AI vision runs independently** — `analyze-roof-aerial` and `roof-segmentation` produce edge detections but they're not snapped to the authoritative footprint polygon. Detected ridges float in pixel space instead of being constrained to actual building geometry.

5. **No Mapbox Tilequery for edge snapping** — The Tilequery API can return features at a point, useful for snapping detected geometry to known building edges. This is referenced in your stack description but not implemented.

6. **`measure/index.ts` is 3,925 lines** — The main orchestrator has grown unwieldy. The unified pipeline (`unified-measurement-pipeline.ts`) exists as the intended replacement but the `measure` function still runs its own parallel logic.

### The Plan: Data Fusion Layer (3 Phases)

---

#### Phase 1: Terrain + Calibration Integration

**1a. Add Mapbox Terrain-RGB elevation fetching**
- Create `supabase/functions/_shared/mapbox-terrain-fetcher.ts`
- Fetch terrain-rgb tiles at the building location
- Decode RGB→elevation using Mapbox formula: `height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)`
- Sample elevation at footprint vertices and along detected edges
- Use elevation delta between eave and ridge to compute pitch independently of Solar API

**1b. Wire calibration into the pipeline**
- The `measurement-calibration` edge function already computes `pixelToFeetRatio` — integrate its output into `unified-measurement-pipeline.ts` Step 2.5 (between footprint and topology)
- Use the footprint polygon's known real-world dimensions (from Mapbox Vector) as the calibration anchor instead of relying solely on zoom-level math

**1c. Constrain AI detections to footprint**
- In `unified-measurement-pipeline.ts`, after AI vision runs, clip all detected lines to the footprint polygon boundary
- Snap endpoints within 3ft of a footprint vertex to that vertex
- Discard any detected line that falls entirely outside the footprint + 5ft buffer

---

#### Phase 2: Source Fusion + Reconciliation Engine

**2a. Create fusion reconciliation module**
- New file: `supabase/functions/_shared/measurement-fusion.ts`
- Takes inputs from all sources: Solar API area/pitch, skeleton-derived area, AI-detected lines, Terrain-derived pitch, footprint polygon area
- Applies weighted averaging based on source confidence:

```text
Source Priority (area):
  1. Footprint polygon planimetric area (Mapbox Vector) — weight 0.4
  2. Solar API wholeRoofStats                          — weight 0.35
  3. Skeleton-derived facet sum                        — weight 0.25

Source Priority (pitch):
  1. Solar API segment pitchDegrees (per-facet)        — weight 0.5
  2. Terrain-RGB elevation delta                       — weight 0.3
  3. DSM ridge-to-eave analysis                        — weight 0.2

Source Priority (linear features):
  1. Skeleton edges (constrained to footprint)         — weight 0.5
  2. AI vision detected + snapped edges                — weight 0.3
  3. Solar segment boundary inference                  — weight 0.2
```

- When sources disagree by >10%, flag for manual review with specific deviation details
- Output a single fused measurement with per-component confidence scores

**2b. Consolidate `measure/index.ts` into `unified-measurement-pipeline.ts`**
- The 3,925-line `measure/index.ts` duplicates logic that the unified pipeline handles
- Route all new measurement requests through `runUnifiedMeasurementPipeline`
- Keep `measure/index.ts` as the HTTP handler only (request parsing, auth, DB writes) — delegate all computation to the unified pipeline
- This prevents the two pipelines from drifting further apart

---

#### Phase 3: Output Parity with Roofr/EagleView Reports

**3a. Structured geometry output**
- Ensure the pipeline returns per-facet data matching Roofr's report structure:
  - Facet ID, polygon WKT, plan area, sloped area, pitch, orientation
  - Per-edge: type (ridge/hip/valley/eave/rake), length in feet, start/end coords
  - Totals: ridge ft, hip ft, valley ft, eave ft, rake ft, perimeter ft, total area, squares

**3b. Accuracy benchmarking against known reports**
- The `compare-accuracy` and `run-measurement-benchmark` functions exist but aren't systematically used
- Create a benchmark runner that takes a Roofr/EagleView report's known values (area, line lengths) and compares against pipeline output
- Store deviation percentages per component to track improvement over time
- Target: <3% area deviation, <5% linear measurement deviation

**3c. Report generation alignment**
- Update `generate-roofr-style-report` to pull from the fused measurement output
- Ensure the PDF matches Roofr's structure: summary page, lengths breakdown, facet diagram

### Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/_shared/mapbox-terrain-fetcher.ts` | Terrain-RGB elevation sampling |
| `supabase/functions/_shared/measurement-fusion.ts` | Multi-source weighted reconciliation |
| `supabase/functions/_shared/geometry-snapper.ts` | Snap AI detections to footprint |

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/_shared/unified-measurement-pipeline.ts` | Add terrain fetch, calibration, fusion, and snapping steps |
| `supabase/functions/measure/index.ts` | Delegate computation to unified pipeline |
| `supabase/functions/_shared/facet-area-calculator.ts` | Accept multi-source pitch inputs |
| `supabase/functions/generate-roofr-style-report/index.ts` | Pull from fused output |

### Implementation Order

| Session | Scope | Impact |
|---------|-------|--------|
| This session | Phase 1 (terrain, calibration, snapping) | Fixes pitch accuracy and edge alignment |
| Next session | Phase 2 (fusion engine, measure consolidation) | Eliminates source disagreement, single pipeline |
| Following session | Phase 3 (output parity, benchmarking) | Validates against real Roofr reports |

### Technical Details

- Mapbox Terrain-RGB tiles are free up to 200k requests/month on the free tier and use standard `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/{z}/{x}/{y}.pngraw?access_token=TOKEN` endpoint
- The fusion engine uses a Bayesian-inspired weighting where each source's weight is multiplied by its confidence score, then normalized
- Geometry snapping uses point-to-segment projection with a configurable tolerance (default 3ft / ~1m)
- The benchmark table schema already exists via `run-measurement-benchmark` — we'll add systematic test addresses

