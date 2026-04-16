
The user wants ONE clear path: actually generate AI measurements first (real ones, not stubs), then use that data as training material for the U-Net. No A/B/C/D — just build it.

Looking at the system:
- `measure-roof` edge function exists but returns stubs when `PYTHON_INFERENCE_URL` isn't set
- `measure` edge function has the real pipeline (Solar API + topology + persistence)
- `start-ai-measurement` queues jobs in `measurement_jobs` table
- Render U-Net service exists at `https://pitch-internal-unet...` per memory
- Verification dashboard shows 119 sessions but 0 have linked AI measurements — the AI generation step is silently failing
- Console confirms diagrams render but with `0 eaves, 0 rakes` — perimeter projection works, but eave/rake classification is broken

The real problem: the `measure` function's "pull" path is producing geometry without classifying eaves/rakes correctly, and the U-Net call is either not happening or failing. We need to make AI measurement generation actually work end-to-end on real properties, then collect those outputs into a labeled training set for the U-Net.

# Plan: Build Working AI Measurement → Feed U-Net Training

## Goal
Make AI measurements actually generate (not stub, not fail silently) for every verification session, then export the resulting geometry + satellite imagery as a labeled training dataset for the internal U-Net.

## Step 1 — Fix the AI measurement generation pipeline
**File:** `supabase/functions/measure/index.ts`

- Trace the `pull` action and ensure it ALWAYS produces:
  - `footprint_polygon` (from Google Solar API building bounds)
  - `linear_features_wkt` (ridge/hip/valley/eave/rake classified by topology engine)
  - `roof_measurements` row with non-null `verification_score`-ready fields
- Wire eave/rake classification: every footprint edge becomes an eave or rake based on adjacent facet pitch (flat side = eave, sloped end = rake)
- On failure, write `error_log` to the row instead of leaving NULL — so the dashboard surfaces it
- Set `verification_verdict` whenever a score is computed

## Step 2 — Auto-run AI measurement during verification
**File:** `supabase/functions/measure/index.ts` (`batch-verify-vendor-reports` action)

- For every session with `status = pending` AND no linked `ai_measurement_id`:
  1. Geocode the property
  2. Call internal `pull` with `engine: 'skeleton'` (U-Net) → fall back to `vision` (Solar+topology) if U-Net unavailable
  3. Insert into `roof_measurements`, link via `ai_measurement_id`
  4. Compute `verification_score` against vendor totals
  5. Set `verification_verdict` = `confirmed` (≥85%), `review` (70-85%), or `denied` (<70%)
- Add a "Run for One" button on each row (so the user can retry a single session and see logs immediately)

## Step 3 — Add "Open AI Measurement" button to verification dashboard
**File:** `src/components/settings/VendorVerificationDashboard.tsx`

- New action column: when `ai_measurement_id` is present, show "View Diagram" button that opens the schematic roof diagram inline (uses existing `SchematicRoofDiagram`)
- Show `verification_score` numerically in the table
- Replace the misleading "Pending" label with the actual state: `Awaiting AI`, `AI Generated · No Verdict`, `Confirmed`, `Denied`, `Failed: <reason>`

## Step 4 — Export training dataset for the U-Net
**New file:** `supabase/functions/export-unet-training-set/index.ts`

For every `roof_training_sessions` row with `verification_verdict = 'confirmed'`:
- Pull the satellite image (already cached in `roof_measurements.satellite_image_url`)
- Pull the ground-truth geometry from the linked vendor report (EagleView WKT)
- Pull the AI-predicted geometry from the linked `roof_measurements`
- Emit a JSONL training record per the `roof-training/classes.json` schema:
  ```json
  {
    "image_url": "...",
    "footprint_mask_wkt": "...",
    "ridge_mask_wkt": "...",
    "hip_mask_wkt": "...",
    "valley_mask_wkt": "...",
    "eave_mask_wkt": "...",
    "rake_mask_wkt": "...",
    "regression_targets": { "total_area_sqft": ..., "ridge_ft": ..., ... }
  }
  ```
- Upload the JSONL to a new storage bucket `unet-training-data/{tenant_id}/dataset_v{N}.jsonl`
- Return a signed URL the user can hand to the Render U-Net training script (`train_lovable_roofnet.py`)

## Step 5 — Surface "Export Training Set" in the dashboard
**File:** `src/components/settings/VendorVerificationDashboard.tsx`

- New button at top: "Export Training Set"
- Shows count of confirmed sessions eligible (currently 58)
- On click → invokes `export-unet-training-set` → downloads JSONL + shows storage path

## Technical Details
- All measurement generation goes through ONE path (`measure` edge function) — no more `measure-roof` stub fallback
- The U-Net Render service URL lives in the `PYTHON_INFERENCE_URL` secret — if missing, vision engine + topology engine still produce valid training samples (they just won't include U-Net mask predictions)
- Training set uses the **vendor report** (EagleView) as ground-truth labels, not the AI output — this is the supervised learning signal the U-Net needs
- New storage bucket `unet-training-data` with RLS scoped to `master`/`developer` roles only
