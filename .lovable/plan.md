

## Run Pipeline Validation Script — Corrected

### Issues in Your Script

The script has the right structure but checks for wrong response keys:

1. **`measure` response**: Returns `{ ok: true, data: { measurement, tags } }` — not flat `area`, `ridge`, etc. The measurement data is nested under `data.measurement` with keys like `total_area_sqft`, `ridge_ft`, `valley_ft`, `hip_ft`, `eave_ft`.

2. **`generate-training-pair` response**: Returns `{ success, trainingPairId, alignment: { quality, ... }, trainingPair, preview }` — not `alignment_quality` or `alignmentQuality` at root. The alignment quality is at `alignment.quality.normalizedError`.

3. **Mask data**: Located at `trainingPair.lineMasks` and `trainingPair.footprintMask` (nested under `trainingPair`), not at root.

4. **Sample data issue**: 4 of 5 rows with coordinates have `property_address = "Unknown Address"` — the geocoding from report ingestion didn't resolve addresses for those entries.

### Plan

Write a corrected script to `/tmp/pipeline_validation.py` and execute it:

**Corrections:**
- Measure check: `data["data"]["measurement"]` with keys `total_area_sqft`, `ridge_ft`, `valley_ft`, `hip_ft`, `eave_ft`
- Training pair check: `data["alignment"]["quality"]` for alignment quality
- Mask check: `data["trainingPair"]["lineMasks"]` and `data["trainingPair"]["footprintMask"]`
- Training readiness: `SELECT COUNT(*) FROM training_pairs WHERE labels IS NOT NULL AND alignment_quality IS NOT NULL`
- Use the anon key from `.env` directly

**Output:** `/mnt/documents/pipeline_validation_report.json` with pass/fail per stage and `ready_for_stage_5` boolean.

### Files

| File | Action |
|------|--------|
| `/tmp/pipeline_validation.py` | Corrected validation script — no project changes |

