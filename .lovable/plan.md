## Three implementation items to finish

This is a focused implementation plan — no new buttons, no new measurement system, no U-Net dependency, no Gemini fallback. Only the three items requested.

---

### 1. `supabase/functions/start-ai-measurement/index.ts` — demote Solar bbox

**Problem:** `planesFromSolar()` (lines 246–301) turns Google Solar `roofSegmentStats[i].boundingBox.{sw,ne}` into 4-corner axis-aligned rectangles and writes them to `ai_roof_planes` as if they were facets. That is the literal source of the "two rectangles" bug for 8359 Huntsman.

**Edits to `start-ai-measurement/index.ts`:**

1. Add helpers above `runQualityChecks`:
   - `isAxisAlignedRectangle(poly)` — true when polygon is a 4-pt AA rectangle (Solar bbox tell).
   - `computeOverlayAlignment(planes, imgW, imgH)` — returns 0–1 score (centered + fully-inside the image frame).

2. In the plane-build step (line ~776), keep `planesFromSolar()` running **but tag every produced plane** as untrusted: `source: 'google_solar_bbox'` (rename), and continue to use `pitchDegrees`/`azimuthDegrees`/`areaMeters2` only as **hints**.

3. In `runQualityChecks` add four new checks:
   - `geometry_source_is_real` — fails when **every** plane's source matches `google_solar_bbox|placeholder|perimeter_fallback`.
   - `planes_are_not_all_rectangles` — fails when ≥50% of planes pass `isAxisAlignedRectangle`.
   - `overlay_alignment_score` — score = `computeOverlayAlignment(...)`; passes at ≥ 0.75.
   - Return the `overlayAlignmentScore` alongside `status`.

4. Promotion logic becomes:
   ```
   if (hasPlaceholder || !calibrated || !mapboxOk || planes.length === 0
       || !geometrySourceIsReal || planesAreAllRectangles
       || overlayAlignmentScore < 0.75) → 'needs_manual_measurement'
   else if (overall ≥ 0.85 && overlayAlignmentScore ≥ 0.85) → 'completed'
   else if (overall ≥ 0.65) → 'needs_review'
   else → 'needs_manual_measurement'
   ```

5. Move the existing `if (qc.status === 'needs_manual_measurement')` short-circuit (line ~1041) **above** the diagram-generation block (line ~967). Result: when geometry is bad, no `ai_measurement_diagrams` rows are inserted, no `roof_measurements` row is inserted, no `measurement_approvals` row is inserted, and `measurement_jobs` is set to `failed` with `error: 'needs_manual_measurement'`.

6. Persist the new fields on the row that does get published (when `status` is `completed`/`needs_review`):
   - `roof_measurements.geometry_quality_score = qc.overall`
   - `roof_measurements.measurement_quality_score = qc.overall`
   - `geometry_report_json.overlay_alignment_score = overlayAlignmentScore`
   - `geometry_report_json.geometry_source = 'google_solar_bbox' | 'mixed' | 'unet'`
   - `geometry_report_json.is_placeholder = false` (always, by this point)
   - `geometry_report_json.footprint_wkt` = `POLYGON((lng lat, …))` built from the union hull of all `polygon_geojson` points (so the frontend stops printing "No WKT geometry available").

7. Hint-only Solar usage stays: pitch/azimuth/area continue to be read off Solar segments. No new geometry source is added — if Solar bboxes are the only geometry, the job correctly fails to `needs_manual_measurement`. This is intentional and matches the user's hard rule.

**Result for 8359 Huntsman:** Solar returns 2 axis-aligned rectangles → `planes_are_not_all_rectangles` fails → status = `needs_manual_measurement` → no diagrams generated, no PDF, no published roof_measurements. The dialog will show the manual-measurement banner instead of fake rectangles.

---

### 2. `supabase/functions/render-measurement-pdf/index.ts` — new edge function

Generates a clean customer PDF from the SVG pages already saved by `start-ai-measurement` into `ai_measurement_diagrams`. **Does not** screen-print the React UI. **Does not** invent geometry — it only assembles what's stored.

**Behavior:**

- POST body: `{ ai_measurement_job_id?, lead_id?, project_id?, measurement_id? }`. Resolves to one `ai_measurement_job_id` (latest by `created_at` for the lead/project/measurement).
- Validates QC gate **server-side** before producing anything:
  - The associated `roof_measurements` row exists, has `validation_status IN ('validated','flagged')` (i.e. not `needs_manual_measurement`), `facet_count > 0`, `geometry_report_json` exists, and `geometry_report_json.overlay_alignment_score >= 0.75`.
  - At least one `ai_measurement_diagrams` row exists for the job.
- If the gate fails → returns `{ error: 'manual_measurement_required', message: 'Roof geometry did not align with the property.' }` with status 422. No PDF is produced.
- If the gate passes:
  1. Loads all `ai_measurement_diagrams` for the job ordered by `page_number` (Cover, Overlay, Length, Pitch, Area, Notes — all 6 already produced by the existing renderer).
  2. Wraps each SVG in an HTML page (Letter portrait, 8.5×11in @ 96dpi → 816×1056px) with the page title.
  3. Calls Lovable Cloud's **PDFShift-equivalent path** — since this project does not provision a headless browser, we use a pure-Deno SVG → PDF approach: each SVG is embedded as one page in a single PDF using a hand-rolled minimal PDF writer (object stream wrapping each SVG via the `pdf-lib` npm port that runs in Deno: `npm:pdf-lib@1.17.1`). For each page, render the SVG to a PNG bitmap with `npm:resvg-js@2.6.2` at 2× scale, then `pdf-lib` embeds the PNG on a Letter page. This keeps the function fully self-contained, works in Deno, and matches what the customer expects (clean printed pages, not a screenshot of the app).
  4. Uploads the resulting PDF to the existing public `measurement-reports` storage bucket at `reports/<tenant_id>/<ai_measurement_job_id>.pdf` (creates the bucket via migration if it does not exist — a 1-statement migration).
  5. Updates `roof_measurements.report_pdf_url` (column added if missing — handled in the same migration) with the public URL and updates `ai_measurement_jobs.report_pdf_url`.
  6. Returns `{ pdf_url, page_count, ai_measurement_job_id }`.

- Uses `corsHeaders`; honors `OPTIONS`; auth-passthrough via service-role for Storage write; reads the user's JWT only to confirm tenant access (no SQL strings, parameterized only).

**Migration (single file):**
- Create public bucket `measurement-reports` (idempotent insert).
- Storage policy: tenant-scoped read; service-role write.
- `ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS report_pdf_url text;`
- `ALTER TABLE ai_measurement_jobs ADD COLUMN IF NOT EXISTS report_pdf_url text;`

---

### 3. Frontend — `MeasurementReportDialog.tsx` + `UnifiedMeasurementPanel.tsx`

**`MeasurementReportDialog.tsx` (currently 53 lines, just wraps `ComprehensiveMeasurementReport`):**

Replace with a **6-page sequence viewer** that:
- Reads `roof_measurements` (passed via `measurement` prop) for QC fields: `validation_status`, `facet_count`, `geometry_report_json`, `requires_manual_review`.
- **QC gate (client mirror of the server gate):**
  - If `validation_status === 'flagged' && requires_manual_review === true && facet_count === 0`, OR `geometry_report_json` missing, OR `geometry_report_json.overlay_alignment_score < 0.75`, OR `geometry_report_json.geometry_source === 'google_solar_bbox'`:
    - Render a single full-dialog banner: **"Manual measurement required — roof geometry did not align with the property."** + "Re-run AI Measurement" button (calls existing `useMeasurementJob.startJob`) + "Order vendor report" link.
    - **Disable** Download PDF.
- Otherwise, fetch `ai_measurement_diagrams` for the linked `ai_measurement_job_id` ordered by `page_number` and render the 6 pages in a vertically scrollable list with page-number chips: **1. Cover · 2. Image / Overlay · 3. Length Diagram · 4. Pitch Diagram · 5. Area Diagram · 6. Notes Diagram**.
- The "Download PDF" button calls `supabase.functions.invoke('render-measurement-pdf', { body: { ai_measurement_job_id } })` and opens the returned `pdf_url` in a new tab. **No more `html2canvas` / `jsPDF` browser-print path.**
- Keeps the existing `ComprehensiveMeasurementReport` component only as a side-tab "Details / Tags" view (legacy data). The primary view is the 6-page sequence.

**`UnifiedMeasurementPanel.tsx`:**
- Pass `aiMeasurementJobId={ai.ai_measurement_job_id}` and the full `ai` row (which already has `validation_status`, `requires_manual_review`, `geometry_report_json`, `facet_count`) to `<MeasurementReportDialog />` so the QC gate has the data it needs.
- When the latest AI measurement is in `needs_manual_measurement` state (job `failed` with `error === 'needs_manual_measurement'`), replace the "View Report" button with a small inline warning chip: "Manual measurement required" + "Re-run AI Measurement" button.

---

### What is intentionally NOT done

- **No U-Net wiring.** Per the request, U-Net is not required. The system simply refuses to publish bad Solar-bbox geometry.
- **No Gemini fallback.** No new geometry source replaces Solar.
- **No new "AI Measurement" button.** Same `useMeasurementJob` flow.
- **No fake geometry.** When real footprint/planes/edges are missing, the only outcome is `needs_manual_measurement`.

### Files touched

```
supabase/functions/start-ai-measurement/index.ts          (modify ~80 lines)
supabase/functions/render-measurement-pdf/index.ts        (new)
supabase/migrations/<ts>_measurement_reports_bucket.sql   (new, idempotent)
src/components/measurements/MeasurementReportDialog.tsx   (rewrite, ~180 lines)
src/components/measurements/UnifiedMeasurementPanel.tsx   (~10-line edit at the two MeasurementReportDialog call sites)
```

### Acceptance for 8359 Huntsman regression

After the change, re-running AI Measurement on 8359 Huntsman Pl will:
1. Fetch Mapbox + Solar (Solar returns 2 bboxes).
2. QC fails: `planes_are_not_all_rectangles` → `needs_manual_measurement`.
3. No diagrams written, no `roof_measurements` row, no approval row.
4. `measurement_jobs.status = 'failed'`, `error = 'needs_manual_measurement'`.
5. The lead page shows: **"Manual measurement required — roof geometry did not align with the property."** with a re-run button. Download PDF is disabled.

No "two generic rectangles" customer-ready report is ever produced again.