

## What I verified

- 116 of 119 reports have `parsed.address` with **full city/state/ZIP** (e.g. "1190 Mimosa Court, Marco Island, FL 34145")
- 114 of 119 already have **`geocoded_lat`/`geocoded_lng` cached** in `roof_vendor_reports` from the original ingest
- Only **3–5 reports** are genuinely partial (e.g. "1308 Blossom Ct", "1 ELMWOOD AVE") — these are older Roofr-style PDFs where the cover page only listed the street
- The `roof_training_sessions.property_address` and `lat/lng` are already populated from the report — geocoding is **not the bottleneck**

So my earlier warning was wrong. Geocoding will not fail for 10–20 rows; it will fail for ~3.

## The real problem

The `measure` edge function's `batch-verify-vendor-reports` action is re-geocoding addresses from scratch instead of reusing `roof_training_sessions.lat/lng` (which is already populated from the parsed report). When it hits a session with cached coords, it should skip Google entirely and go straight to `pull` with those coordinates.

## Plan: Use the cached coordinates that are already there

### Step 1 — Skip geocoding when session already has lat/lng
**File:** `supabase/functions/measure/index.ts` (`batch-verify-vendor-reports`)

For each session:
- If `session.lat` AND `session.lng` are non-null → use them directly, skip `google-address-validation`
- Else if `vendor_report.geocoded_lat/lng` are non-null → copy to session, use them
- Else if `parsed.address` (the full one) is non-null → geocode that string
- Else fall back to `property_address`
- Only mark as failed if ALL four paths produce no coordinates

### Step 2 — Backfill the 3–5 partial-address sessions
One-time SQL: pull the most-complete address from `roof_vendor_reports.parsed->>'address'` into `roof_training_sessions.property_address` wherever the session's version is shorter. Then copy `geocoded_lat/lng` → `lat/lng` for any session still missing coords.

### Step 3 — Make `pull` action actually persist a measurement
**File:** `supabase/functions/measure/index.ts` (`pull` action)

- After Solar API + topology produce geometry, INSERT into `roof_measurements` with: `tenant_id`, `latitude`, `longitude`, `total_area_sqft`, `linear_features_wkt`, `vector_diagram_svg` (rendered from the geometry), `satellite_image_url`
- Return the new `roof_measurements.id` so the caller can link `ai_measurement_id` on the session
- On failure, write the error string into a `error_log` field on the session's `verification_notes` so the dashboard surfaces *why* it failed instead of staying "Pending" forever

### Step 4 — Wire up the diagram SVG generation
The reason 5 existing measurements have **0 SVGs**: the `pull` path doesn't call the SVG renderer. Add a call to the existing `SchematicRoofDiagram`-equivalent server-side renderer (or a simple inline SVG builder from the linear features WKT) before insert.

### Step 5 — Verify with one row, then run batch
After steps 1-4 ship:
- Click "Run AI" on `4528 62nd Avenue East, Bradenton, FL` (cached coords, full address, no excuses)
- Confirm: `ai_measurement_id` populated, `vector_diagram_svg` non-null, `verification_verdict` set
- If that single row works → run "Run Verification" batch on the remaining 100+

### What I will NOT do this round
- No new buttons
- No new export functions
- No new dashboard columns

Just fix the geocode-skip + the missing INSERT into `roof_measurements` + the missing SVG render. That's the entire blocker.

