

## AI Measurement System -- Current State Report

### What Exists and Works

**Backend Pipeline (measure edge function -- 3,993 lines):**
- Full `measure` edge function with 3 engines: `skeleton` (default), `vision`, `unified`
- 12 sub-modules: straight-skeleton, DSM analyzer, facet splitter, gable detector, ridge calibrator, mapbox footprint, overlay evaluator, correction tracker, QA validator, segment topology analyzer, output schema
- Google Solar API integration for DSM (elevation) data, roof masks, pitch detection
- Mapbox footprint fetching with multi-source fusion (Regrid, OSM, OpenBuildings)
- Self-evaluation loop (overlay-evaluator) + correction learning (correction-tracker)
- Training pair generation (`generate-training-pair` + `batch-training-data` edge functions)
- Measurement calibration edge function
- 166 active measurements in DB (127 from google_solar, 19 from skeleton, 7 manual)

**Training Data:**
- 368 training pairs in Supabase DB
- 279 have labels + line_masks populated
- 80 images + 320 masks exported to `/mnt/documents/roof-training/`
- Labels contain: totalAreaSqft, lineLengths (ridge/hip/valley/eave), predominantPitch
- Most alignment_quality scores are very low (0.00-0.09) -- only 2 records above 0.5

**ML Model Code (ready but NOT trained):**
- `RoofNetV3`: ResNet50 encoder, 4-channel segmentation head (ridge/valley/hip/eave), 6-output regression head
- `RoofLossV2`: Weighted loss (seg * 2.0 + reg * 0.5) -- correctly configured
- `dataset_v2.py`: Correct scaling (area/10000, lengths/500, pitch/12)
- `train_v3.py`: Training script ready, but points to `/tmp/training_data` (wrong path)
- No trained checkpoint exists -- PyTorch not available in sandbox

**Frontend:**
- `MeasurementWorkflow` component: 5-step flow (Pull -> Verify -> Adjust -> Save -> Estimate)
- `PullMeasurementsButton` calls the `measure` edge function
- Multiple measurement pages: `/roof-measure/:id`, `/measurement-workflow`, `/enhanced-measurement/:id`, `/professional-measurement/:id`
- FacetSplittingTools, MeasurementVerificationDialog, MeasurementHistoryDialog
- MapboxRoofViewer, AIRoofSkeletonViewer, CleanRoofDiagram

### Critical Issues Blocking 98% Accuracy

1. **No trained ML model** -- PyTorch can't run in sandbox. The model architecture + data are ready but training must happen locally (your M4 Mac) or a GPU server.

2. **Low alignment quality** -- 157 of 368 training pairs have alignment_quality = 0.000. Only 2 above 0.5. This means the vendor geometry-to-satellite alignment is mostly failing, producing garbage training masks.

3. **Labels incomplete** -- Many training pairs have `null` labels (area, pitch missing). The 279 with data have line lengths but some are suspiciously uniform (same area for different properties).

4. **train_v3.py path wrong** -- Still points to `/tmp/training_data` instead of `/mnt/documents/roof-training/`.

5. **Pitch hardcoded to 5/12** -- The vision overlay engine defaults pitch to `'5/12'` for all faces. The skeleton engine relies on Google Solar DSM which is often unavailable.

6. **No inference endpoint** -- Even if a model were trained, there's no edge function to run RoofNetV3 inference on a new property image.

### What Must Happen in 24 Hours

**Track A -- Make the existing pipeline accurate WITHOUT ML (immediate)**

The `measure` edge function already produces measurements from Google Solar + footprints + straight skeleton. The accuracy gap is in:
1. Pitch detection reliability (DSM often unavailable, falls back to assumptions)
2. Facet splitting accuracy (straight skeleton vs actual roof geometry)
3. Ridge/hip/valley length calculations from skeleton edges

Actions:
- Improve the skeleton engine's pitch fallback logic (use roof_vendor_reports data when available)
- Add cross-validation against the 156 vendor reports in `roof_vendor_reports` for known properties
- Fix the `convertVisionOverlay` function to use actual pitch data instead of hardcoded 5/12
- Deploy and test the unified pipeline engine end-to-end

**Track B -- Fix training data quality (parallel)**

Actions:
- Filter training pairs: only use 279 with labels + line_masks, discard alignment_quality < 0.01
- Fix `train_v3.py` data path to `/mnt/documents/roof-training/`
- Re-export dataset with only high-quality pairs
- Training must happen on your local M4: `cd ml && python train_v3.py --data_dir /path/to/roof-training --epochs 80`

**Track C -- Build inference endpoint**

Create a `roof-inference` edge function that:
- Takes a satellite image URL + lat/lng
- Downloads and preprocesses the image
- Runs inference (initially: calls an external model API or uses ONNX runtime in Deno)
- Returns segmentation masks + regression outputs
- Note: PyTorch can't run in Deno -- you'd need ONNX conversion or an external inference server

### Realistic 24-Hour Plan

| Priority | Task | Impact |
|----------|------|--------|
| P0 | Fix pitch detection in measure engine (use vendor data, better fallbacks) | Immediate accuracy boost |
| P0 | Add vendor report cross-validation (compare AI vs 156 known reports) | Accuracy measurement |
| P0 | Fix train_v3.py path + re-export clean dataset | Unblocks local training |
| P1 | Test measure edge function end-to-end with real addresses | Verify current accuracy |
| P1 | Improve straight skeleton facet splitting with learned patterns | Better facet accuracy |
| P2 | Build ONNX inference endpoint for trained model | Future ML integration |
| P2 | Dashboard showing accuracy metrics vs vendor truth | Monitoring |

### Files to Edit

| File | Change |
|------|--------|
| `supabase/functions/measure/index.ts` | Fix pitch fallback, add vendor cross-validation |
| `ml/train_v3.py` | Fix data_dir default path |
| `/tmp/re_export_clean.py` | New script -- export only quality training pairs |
| `supabase/functions/measure/facet-splitter.ts` | Improve splitting with building shape hints |
| `supabase/functions/run-measurement-benchmark/index.ts` | New/update -- batch accuracy test against vendor reports |

### Bottom Line

The **pipeline infrastructure is solid** (3,993-line measure function, 12 sub-modules, 3 engines). The gap is:
- Pitch detection reliability (fixable in code today)
- No trained ML model (requires local GPU, ~2-4 hours on M4)
- Training data quality is mediocre (157/368 pairs have zero alignment)

The fastest path to 98% accuracy in 24 hours: **improve the skeleton/solar engine's pitch and facet logic using vendor truth data as calibration**, while simultaneously training the ML model locally on your M4.

