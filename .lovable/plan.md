## Why AI Measurement keeps landing in "Internal Review"

Three real bugs in the live `start-ai-measurement` pipeline (verified in the repo):

1. **`_shared/mapbox-footprint-extractor.ts`** treats Mapbox Tilequery as a polygon source. Tilequery only returns **point** geometry — it can never return building rings. So the "authoritative footprint" path is dead on arrival, and jobs fall through to weaker sources.
2. **`start-ai-measurement/index.ts` lines 41–44** prefer `MAPBOX_PUBLIC_TOKEN` over `MAPBOX_ACCESS_TOKEN` for server-side calls. URL-restricted public tokens often 403 from edge functions even when the browser UI looks fine.
3. **QC (`runQualityChecks`, line 1336+)** hard-fails on `mapboxOk` (line 1450). When Mapbox imagery fails for any reason, there is no Google Static Maps fallback — the job is forced to `needs_internal_review`.

The frontend gating is correct; it is faithfully showing backend QA state. The JPEG/PNG decode fix did not address any of the three causes above.

## Fix

### 1. Disable Mapbox Tilequery as a polygon source
**File:** `supabase/functions/_shared/mapbox-footprint-extractor.ts`

Replace the body of `fetchMapboxVectorFootprint` with a no-op that returns `{ footprint: null, error, fallbackReason: 'tilequery_returns_points_only' }` and logs a warning. This stops a structurally impossible call from being treated as authoritative.

### 2. Token precedence + provider-agnostic imagery
**File:** `supabase/functions/start-ai-measurement/index.ts`

- Replace the single `MAPBOX_TOKEN` constant with two:
  - `MAPBOX_SERVER_TOKEN` (prefers `MAPBOX_ACCESS_TOKEN`, then `MAPBOX_TOKEN`, then `MAPBOX_PUBLIC_TOKEN`) — used for all edge-side API calls including `resolveAuthoritativeFootprint`.
  - `MAPBOX_IMAGE_TOKEN` (same precedence, but `MAPBOX_PUBLIC_TOKEN` allowed second) — used only for Static Images.
- Add helpers `fetchStaticRaster`, `fetchPreferredBaseImagery`, `computeImageBounds`. `fetchPreferredBaseImagery` tries Mapbox satellite-v9 static first, falls back to Google Static Maps satellite (`scale=2`).
- Replace the existing Mapbox-only imagery fetch block with the new provider-agnostic call. Track `imageryOk` and `imagerySource` ('mapbox' | 'google_static' | 'none').
- Pass `MAPBOX_SERVER_TOKEN` (not the public-first token) to `resolveAuthoritativeFootprint` at line 1730.

### 3. Make QC imagery-provider-agnostic
Same file, `runQualityChecks`:

- Add `imageryOk: boolean` and `imagerySource: string` to the input type.
- Add an `imagery_available` check based on `imageryOk`.
- Replace the hard-fail on `!input.mapboxOk` (line 1450) with `!input.imageryOk`.
- Update the call site (line 1924) to pass `imageryOk` and `imagerySource` instead of `mapboxOk`.

### 4. Persist imagery metadata in `roof_measurements` insert
Same file. Add to the insert payload:
- `mapbox_image_url`, `google_maps_image_url`, `satellite_overlay_url`
- `selected_image_source`, `image_source`
- `analysis_zoom`, `analysis_image_size` (with width/height/logicalWidth/logicalHeight/rasterScale)
- `image_bounds` (computed via `computeImageBounds` using **logical** size so Mapbox `@2x` and Google `scale=2` produce identical bounds)

### 5. Filter legacy bad AI rows in the panel
**File:** `src/components/measurements/UnifiedMeasurementPanel.tsx`

- Add `hasCustomerSafeGeometry(measurement)` helper that wraps `isPlausibleRoofMeasurement` and additionally rejects rows where `validation_status === 'needs_internal_review'`, `geometry_report_json.is_placeholder === true`, or `geometry_report_json.geometry_source === 'google_solar_bbox'`.
- Use it in the AI history query in place of `isPlausibleRoofMeasurement`.
- Guard `handleSaveAiMeasurementDirect` and `handleSaveAiMeasurement` so failed-QA rows cannot be saved into estimates.

## Secrets / config
Confirm these exist (will check via `secrets--fetch_secrets` after approval):
- `MAPBOX_ACCESS_TOKEN` — required as the preferred server token.
- `GOOGLE_MAPS_API_KEY` — required for Google Static Maps fallback.
- `MAPBOX_PUBLIC_TOKEN` — kept as a last-resort fallback only.

If `MAPBOX_ACCESS_TOKEN` is missing, I'll prompt you to add it before deploy.

## Validation after deploy
- Re-run AI Measurement on the failing lead. Expected: `completed` or `needs_review`, not `needs_internal_review`, even if Mapbox 403s.
- Spot-check `roof_measurements` for new rows: `selected_image_source`, `analysis_zoom`, `analysis_image_size`, `image_bounds` all populated.
- Tail `start-ai-measurement` logs for `[ai-measurement][imagery]` lines to confirm provider used.
- Verify legacy >30,000 sqft / `needs_internal_review` rows no longer appear in the panel history.

## What this does NOT change
- No retraining, no new ML model.
- No change to the frontend QA gating in `MeasurementReportDialog` or `render-measurement-pdf` — those are correct.
- QC is not loosened; it's only made provider-agnostic.