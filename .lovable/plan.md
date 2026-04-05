

## Integrate Python Fusion Pipeline into Existing TypeScript Measurement System

### What the Python script reveals vs. what already exists

| Python Script Step | Existing TypeScript Module | Gap? |
|---|---|---|
| `geocode_address()` | Google Geocoding used in `measure/index.ts` | No |
| `get_google_solar_building_insights()` | `google-solar-api.ts` → `fetchGoogleSolarData()` | No |
| `get_google_solar_data_layers()` | `dsm-analyzer.ts` → `fetchDSMFromGoogleSolar()` | **Partial** — DSM only, no full data layers metadata saved |
| `mapbox_static_image()` | `fetch-mapbox-imagery` edge function | No |
| `mapbox_raster_tile()` (terrain-rgb) | `mapbox-terrain-fetcher.ts` → `fetchTerrainElevation()` | No |
| `mapbox_raster_tile()` (satellite tile) | `fetch-mapbox-imagery` | No |
| `load_vendor_truth_from_folder()` | **Nothing** | **Yes — vendor truth ingestion missing** |
| `fuse_measurements()` | `measurement-fusion.ts` → `fuseMeasurements()` | **Partial** — no vendor truth input channel |
| `choose_value()` blending | `measurement-fusion.ts` weighted averaging | Similar logic, different tolerance model |
| CLI + file output | `measure/index.ts` HTTP handler + DB writes | No |

### Two real gaps to close

**Gap 1: Vendor Truth Ingestion**
The Python script loads parsed Roofr/EagleView JSON from disk and feeds it into fusion as the primary source. Your TypeScript pipeline has no equivalent. You already have `parse-roof-report-geometry` and `roof-report-ingest` edge functions, but their output isn't wired into the unified pipeline's `FusionInput`.

**Gap 2: Solar Data Layers Metadata**
The Python script fetches `dataLayers:get` separately from `buildingInsights:findClosest` and saves the full layers metadata (DSM URLs, mask URLs, imagery date, etc.). Your `dsm-analyzer.ts` fetches data layers internally but doesn't expose the metadata. This metadata is useful for training data provenance and imagery quality assessment.

### Implementation plan

**1. Wire vendor truth into the fusion pipeline**
- Modify `unified-measurement-pipeline.ts` to accept an optional `vendorTruth` field on `UnifiedMeasurementRequest`
- When present, vendor truth area/pitch/linear values become the highest-weight fusion sources (confidence 0.95)
- Query `roof_measurements` for existing vendor reports at the same address to auto-populate vendor truth
- This means: run a Roofr report, ingest it via `roof-report-ingest`, and future measurements at that address automatically calibrate against it

**2. Add data layers metadata to Solar fetch**
- Extend `google-solar-api.ts` with a `fetchGoogleSolarDataLayers()` function
- Store imagery date, quality, and DSM/mask tile URLs on the pipeline result
- This feeds the benchmark system with provenance info

**3. Update `measure/index.ts` to delegate to unified pipeline**
- The 3,925-line `measure/index.ts` currently runs its own parallel logic
- Add a code path that calls `runUnifiedMeasurementPipeline()` when invoked with a `useUnifiedPipeline: true` flag (opt-in, safe rollout)
- Once validated via benchmarks, make it the default

**4. Add benchmark test addresses with vendor truth**
- Insert known addresses (like the Palm Harbor one from the script) into `measurement_benchmark_cases` with their Roofr ground-truth values
- The existing `run-measurement-benchmark` function can then validate the unified pipeline against vendor truth automatically

### Files to create/modify

| File | Change |
|------|--------|
| `supabase/functions/_shared/unified-measurement-pipeline.ts` | Add `vendorTruth` to request type, wire into fusion as primary source |
| `supabase/functions/_shared/google-solar-api.ts` | Add `fetchGoogleSolarDataLayers()` for full metadata |
| `supabase/functions/_shared/measurement-fusion.ts` | Add `vendorTruth` source fields to `FusionInput` with weight 0.95 |
| `supabase/functions/measure/index.ts` | Add `useUnifiedPipeline` flag to delegate to unified pipeline |
| Database migration | Insert benchmark cases with vendor truth values |

### What we are NOT doing
- Not porting this Python script as-is — the TypeScript system already covers 90% of it
- Not creating a separate Python service — everything stays in edge functions
- Not replacing the existing `measure/index.ts` wholesale — opt-in delegation with a flag

### Technical details
- Vendor truth tolerance: when vendor and AI area differ by >12%, flag `vendor_ai_area_mismatch` (matching the Python script's tolerance)
- Vendor truth blending: `choose_value()` logic from the script maps to adding a `vendorReport` source in `FusionInput.area` with confidence 0.95 and weight priority above all other sources
- Data layers metadata fields: `imageryDate`, `imageryQuality`, `dsmUrl`, `rgbUrl`, `maskUrl`, `monthlyFluxUrl`

