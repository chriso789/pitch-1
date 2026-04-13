

# Per-House Vendor Report Verification Pipeline

## What this does

A new developer-only tool that processes every imported EagleView/Roofr PDF one by one. For each house it: (1) pulls the aerial satellite image, (2) runs the AI measurement engine to generate a roof diagram, (3) compares the AI diagram against the paid vendor report page by page, and (4) marks the house as **Confirmed** or **Denied** with an accuracy score.

---

## Current state

- **roof_vendor_reports** already stores parsed measurements, extracted text, diagram geometry, and geocoded coordinates for imported PDFs
- **roof_measurements_truth** stores normalized measurement data per vendor report
- **roof_training_sessions** links vendor reports to AI measurements with `traced_totals` (vendor) and `ai_totals` (AI), plus `original_ai_measurement_id` and `corrected_ai_measurement_id`
- The `measure` edge function can run AI measurements via `action: 'pull'`
- `TrainingComparisonView` already compares AI vs vendor traces with variance percentages
- `BulkReportImporter` handles batch PDF import with geocoding

**What's missing:** No automated batch workflow that runs AI measurement against every vendor report, generates a diagram, compares it to the vendor data, and records a pass/fail verdict.

---

## Implementation steps

### Step 1 -- Add verification columns to roof_training_sessions

Migration to add:
- `verification_verdict` (text, nullable): `'confirmed'` or `'denied'`
- `verification_score` (numeric, nullable): 0-100 accuracy percentage
- `verification_notes` (text, nullable): summary of what matched and what didn't
- `verification_run_at` (timestamptz, nullable): when the verification was executed
- `verification_feature_breakdown` (jsonb, nullable): per-feature accuracy (ridge, hip, valley, eave, rake)

### Step 2 -- New edge function action: `batch-verify-vendor-reports`

Add a new route in the `measure` edge function (`action: 'batch-verify-vendor-reports'`) that:

1. Queries `roof_training_sessions` where `ground_truth_source = 'vendor_report'` and `verification_verdict IS NULL`
2. For each session (batched, limit configurable):
   a. If no `lat/lng`, attempt geocoding via `google-address-validation`
   b. Fetch satellite image via `google-maps-proxy` (zoom 20, 640x640, scale 2)
   c. Run AI measurement via the existing `pull` action internally (reuse the measure engine)
   d. Compare AI results against vendor `traced_totals`:
      - Per-feature variance: ridge, hip, valley, eave, rake
      - Overall weighted accuracy score
      - Auto-verdict: **Confirmed** if overall accuracy >= 85%, **Denied** if < 85%
   e. Store `verification_verdict`, `verification_score`, `verification_notes`, `verification_feature_breakdown`, and `verification_run_at` on the training session
   f. Store the AI measurement ID as `original_ai_measurement_id` if not already set
3. Return summary: total processed, confirmed count, denied count, skipped count

### Step 3 -- New UI: `VendorVerificationDashboard` component

A new component in `src/components/settings/VendorVerificationDashboard.tsx`, accessible from Developer Settings and the Training Lab header. Contains:

**Header section:**
- "Vendor Report Verification" title
- "Run Batch Verification" button (calls the new edge function action)
- Progress bar during batch processing
- Summary stats: Total | Confirmed | Denied | Pending

**Results table:**
- Address | Provider | Vendor Area | AI Area | Area Diff% | Ridge Diff% | Hip Diff% | Valley Diff% | Verdict badge (green Confirmed / red Denied)
- Each row expandable to show:
  - Side-by-side: vendor measurements vs AI measurements
  - Per-feature breakdown with color-coded variance bars
  - Satellite image thumbnail
  - Link to the full training session detail (existing `TrainingSessionDetail`)

**Manual override:**
- Click any row to manually flip verdict between Confirmed/Denied
- Add verification notes

### Step 4 -- Wire into existing views

- Add a `<VendorVerificationDashboard />` tab in the Training Lab (`RoofTrainingLab.tsx`) alongside "Sessions" and "Analytics"
- Add a verification status badge on the `ReportImportDashboard` table rows
- Add a "Verify All" button on the Developer Settings bulk import card

### Step 5 -- Diagram generation per house

For each house during verification, the AI measurement already produces `linear_features_wkt` (ridges, hips, valleys, eaves, rakes as WKT geometry). The existing `TrainingSchematicWrapper` and `SchematicRoofDiagram` components can render these. The verification dashboard will:
- Render the AI-generated diagram inline using `TrainingSchematicWrapper`
- Show vendor diagram image (from `diagram_image_url` on `roof_vendor_reports`) alongside it
- Color-code features by accuracy: green (< 5% variance), yellow (5-15%), red (> 15%)

---

## Technical details

**Database migration:**
```sql
ALTER TABLE roof_training_sessions
  ADD COLUMN IF NOT EXISTS verification_verdict text,
  ADD COLUMN IF NOT EXISTS verification_score numeric,
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS verification_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_feature_breakdown jsonb;
```

**Accuracy calculation logic:**
- Per-feature: `accuracy = max(0, 100 - abs((ai - vendor) / vendor * 100))`
- Overall: weighted average across features that have vendor data > 0
- Weights: ridge 1.0, hip 1.0, valley 1.0, eave 0.8, rake 0.8

**Batch processing:**
- Default batch size: 5 houses per invocation (avoids edge function timeout)
- Sequential processing with 2s delay between houses
- Skip houses with no lat/lng and no address (mark as "skipped - no location")

**Files to create/modify:**
1. `src/components/settings/VendorVerificationDashboard.tsx` -- new component
2. `src/components/settings/RoofTrainingLab.tsx` -- add Verification tab
3. `supabase/functions/measure/index.ts` -- add `batch-verify-vendor-reports` action
4. Migration SQL for new columns
5. Regenerate types after migration

