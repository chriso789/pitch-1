## Goal

Fix the five upstream defects identified in the AI Measurement audit so the diagram, overlay, and customer PDF actually match the aerial — without rebuilding the engine.

The audit confirms what we keep seeing in the field:
- The roof outline appears mirrored / on the wrong side of the house.
- "Saved" measurements blow up to one giant facet (no multi-plane structure).
- The PDF still downloads even when geometry is clearly wrong (single-plane fallback, low alignment).
- The schematic and the patent report sometimes disagree because the schematic re-derives transforms.

Patch 3 (frontend prefer `patent_model`) is already in place — confirmed in `MeasurementReportDialog.tsx` lines 109–114. The remaining four fixes are below, in dependency order.

---

## Changes

### 1. Remove the forced horizontal mirror in `alignAuthoritativeToImage`
File: `supabase/functions/start-ai-measurement/index.ts` (lines ~504–617)

Replace the "USER-DIRECTED CORNER TRANSLATION" + "HORIZONTAL MIRROR" adoption block with a safe identity-translate-and-scale return. Keep the diagnostic 4-orientation scoring as logs only — never adopt a flip. This is the single highest-impact fix; it's the most likely cause of the overlay landing on the wrong side of the roof.

Result: `_alignment_transform.flipX` will always be `false`. `applyAlignmentTransformToLines` already no-ops when there's no flip, so interior ridge/hip/valley lines stay registered correctly.

### 2. Persist full-roof overlay polygon (not just the largest plane)
File: `supabase/functions/start-ai-measurement/index.ts` (lines ~3650–3678)

Add a small `convexHull(Pt[])` helper near the existing geometry helpers, then change `reportOverlaySchema`:
- `polygon`: convex hull of **all** plane vertices combined (full roof footprint), not the largest plane.
- Add `polygons: [{ plane_index, polygon }]` so consumers that need per-plane geometry still have it.

This stops the schematic and patent viewer from cropping/fitting against a single facet on multi-plane roofs.

### 3. Tighten `qcGate` — block PDF on single-plane fallback and weak alignment
File: `supabase/functions/render-measurement-pdf/index.ts` (lines ~122–130)

Convert the existing soft `warnings.push(...)` for `single_plane_fallback === true` and `overlay_alignment_score < OVERLAY_THRESHOLD (0.75)` into hard `{ ok: false, reason: ... }` returns. Preview/inspection in the UI is unaffected (that path doesn't go through this function). The PDF endpoint already returns 422 on `!gate.ok`, and `MeasurementReportDialog` already surfaces that as a clear toast.

### 4. Lock `SchematicRoofDiagram` to the canonical overlay schema when present
File: `src/components/measurements/SchematicRoofDiagram.tsx`

In the overlay-resolution `useMemo`, gate the legacy GPS/WKT/auto-fit branches behind `!hasCanonicalOverlay`. If `overlay_schema.transform.imageWidth/imageHeight` exist and `polygon.length >= 3`, render only via the canonical transform — never recompute from `gps_coordinates`, `image_bounds`, or WKT. This eliminates the "backend was right but the UI redrew it differently" class of bugs.

### 5. Upgrade `overlay_alignment_score` from "centered/in-frame" to image-supported
File: `supabase/functions/start-ai-measurement/index.ts` (`computeOverlayAlignment`)

Replace the centroid-near-center / points-in-image heuristic with an edge-supported score: combine the existing `polygonIoU(planePolygon, imageFootprintPx)` (when a raster footprint exists) and `scorePolygonEdgeSupport(...)` (using the Sobel evidence already computed). Report the blended score into `geometry_report_json.overlay_alignment_score`. With patch 3 above, this score now actually gates customer PDFs.

---

## Out of scope (for this pass)

- The `extractRoofFootprintAndEdges` flood-fill leak (driveway/canopy bleed) — needs a separate seed-and-mask hardening pass.
- Replacing legacy `roof_measurements` rows already published with bad geometry — those should be re-run, not migrated.
- Surfacing `roof_measurements.validation_status` in the job-status banner — useful but not on the critical path for this fix.

---

## Acceptance criteria

After deploy, on a known-good single-family roof:
- Server logs no longer contain `FORCED-CORNER-TRANSLATE` or `HORIZONTAL MIRROR`.
- New `roof_measurements.overlay_schema.polygon` encloses **all** plane vertices (verify in DB: hull area ≥ largest single plane area).
- New rows have `overlay_schema.polygons` populated with one entry per plane.
- `MeasurementReportDialog` PDF download:
  - Returns 422 with a clear reason when `single_plane_fallback === true`.
  - Returns 422 when `overlay_alignment_score < 0.75`.
  - Succeeds otherwise and renders a PDF whose roof outline visibly sits on the house in the aerial page.
- `SchematicRoofDiagram` and `PatentRoofReport` show the same polygon extent for jobs that have `overlay_schema.transform`.

---

## Technical notes

- All changes are additive/replacement-in-place — no new tables, no migrations, no new secrets.
- Edge functions auto-deploy. The two affected functions (`start-ai-measurement`, `render-measurement-pdf`) are already on the `npm:`/`Deno.serve` standard required by project memory.
- Existing rows are not rewritten. Only new AI runs get the corrected geometry. Old broken rows can be regenerated by re-running AI Measurement on the affected leads.
