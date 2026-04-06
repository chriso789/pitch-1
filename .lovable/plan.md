

## Full Validation Pipeline for Stages 1-4

### Reality Check: What Actually Exists

Your measurement system is a **Supabase Edge Function architecture** (TypeScript/Deno), not a local Python pipeline with filesystem directories. There are no `/data/raw_pdfs`, `/data/vendor_geometry`, `/data/mapbox_images`, or `/data/training_ready` directories — those concepts from the Python script are implemented as database tables and edge functions.

**What exists:**
- 365 roof measurements in `roof_measurements` table (365 have area/ridge/valley/hip/eave data, 107 have footprint vertices)
- 0 records in `training_pairs` table (Stage 4 has never been executed against real data)
- Edge functions: `measure`, `generate-training-pair`, `parse-roof-report-geometry`, `generate-roofr-style-report`, `roof-segmentation`, etc.
- Shared modules: `geometry-alignment.ts` (Stages 2-3), `spatial-alignment-engine.ts` (Stage 4), `training-mask-generator.ts` (Stage 4), `unified-measurement-pipeline.ts`

### What the Validation Pipeline Will Do

Build a Python script that executes against the **live Supabase system** via edge function calls and database queries, testing each stage end-to-end.

**1. Data Discovery** — Query `roof_measurements` for counts by source/quality, check `training_pairs` table, verify edge function deployment status.

**2. Measurement Pipeline Validation (Stages 1-2)** — Pick 5 addresses with the highest footprint confidence, invoke the `measure` edge function for each, confirm the response includes area, ridge, valley, hip, eave, calibration metadata, and finalReport payload.

**3. Geometry Alignment Validation (Stage 3)** — For those same 5 measurements, verify `cleanupGeometry`, `scoreConfidence`, and `buildTrainingExportPack` produce valid output by invoking `measure` with vendorGeometry (synthetic test data) and checking the returned confidence scores and training pack.

**4. Spatial Alignment + Training Pair Generation (Stage 4)** — Invoke the `generate-training-pair` edge function for 5 properties with synthetic vendor geometry, confirming: affine matrix is computed, alignment quality grade is returned, training pair data (masks, labels, footprint polygon) is generated, and a record is inserted into `training_pairs`.

**5. Mask Generation Check** — Verify the training pair response includes non-empty `lineMasks` with segments for each line class and a valid `footprintMask` polygon.

**6. Training Readiness Check** — Query `training_pairs` after the test run, validate labels include area/ridge/valley/hip/eave/pitch, check for null values.

**7. Final JSON Report** — Output structured PASS/FAIL for each stage with exact failure reasons.

### Implementation

| File | Purpose |
|------|---------|
| `/tmp/validate_pipeline.py` | Main validation script — runs all checks via HTTP calls to edge functions + direct DB queries via psql |
| `/mnt/documents/pipeline_validation_report.json` | Final structured report |

### Technical Details

- Uses `requests` to call edge functions at `https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/`
- Uses `psql` (env vars pre-set) for direct database reads
- Generates synthetic vendor geometry (simple rectangular roof: 4 eave segments, 1 ridge) for testing alignment when no real vendor data exists
- Tests are non-destructive: training_pairs inserted during validation are marked with a test address prefix
- Each edge function call has a 60s timeout
- Reports wall-clock timing for each stage

