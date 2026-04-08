
Goal
- Make the lead-page AI measurement preview place eaves/rakes directly on the same roof edges visible in the aerial image, not just zoom closer.

What is still wrong
1. `UnifiedMeasurementPanel` is not fetching the alignment fields the preview needs (`gps_coordinates`, `analysis_zoom`, `analysis_image_size`, `image_bounds`, `selected_image_source`, `mapbox_image_url`, etc.), so the card falls back to synthetic center/zoom values.
2. The preview image is chosen as `satellite_overlay_url || google_maps_image_url`, but the measurement row stores multiple imagery sources plus `selected_image_source`; the diagram can be rendering on a different image than the one used during analysis.
3. `SchematicRoofDiagram` still rebuilds image bounds with `calculateImageBounds()` and linear `gpsToPixel()` math, while the table already has fields like `image_bounds` and the project has Mercator-aware utilities. That keeps vertical drift in the overlay.
4. Low-confidence geometry still renders because `shouldShowLinearFeatures` is not being enforced, so users see exact-looking eaves even when the data is marked approximate.

Implementation plan

1. Fix the lead-page measurement query
- File: `src/components/measurements/UnifiedMeasurementPanel.tsx`
- Expand the `roof_measurements` select to include:
  - `gps_coordinates`
  - `analysis_zoom`
  - `analysis_image_size`
  - `image_bounds`
  - `bounding_box`
  - `mapbox_image_url`
  - `selected_image_source`
  - `image_source`
  - `measurement_confidence`
  - `requires_manual_review`
  - `overlay_schema`
- Pass those real values into the preview instead of rebuilding them from `target_lat/target_lng` and defaults.

2. Use the exact imagery source the AI measured against
- File: `src/components/measurements/UnifiedMeasurementPanel.tsx`
- Add one helper for image selection:
  1. image matching `selected_image_source`
  2. `satellite_overlay_url`
  3. remaining Google/Mapbox fallback
- Use that same helper for both the card preview and `MeasurementReportDialog` so they cannot drift apart.

3. Make `SchematicRoofDiagram` prefer authoritative image-space metadata
- Files:
  - `src/components/measurements/SchematicRoofDiagram.tsx`
  - `src/utils/gpsCalculations.ts` or `src/utils/geoCoordinates.ts`
- First use stored `measurement.image_bounds` when available.
- Only fall back to computed bounds if no stored bounds exist.
- Replace the current linear lat/lng projection path with a single Mercator-correct image-to-SVG transform.

4. Tighten the crop around roof edges, not loose bounds
- File: `src/components/measurements/SchematicRoofDiagram.tsx`
- Build crop extents in this order:
  1. eave/rake endpoints
  2. `footprint_vertices_geo`
  3. `perimeter_wkt`
  4. full image
- Keep only a minimal margin so the roof fills the preview enough for verification.

5. Add an eave-first verification mode to the lead-page card
- Files:
  - `src/components/measurements/UnifiedMeasurementPanel.tsx`
  - `src/components/measurements/SchematicRoofDiagram.tsx`
- In the “Latest AI Measurement” card, show only:
  - satellite image
  - perimeter
  - eaves
  - rakes
- Hold ridges/hips/valleys back there until edge alignment is proven.

6. Enforce confidence gating
- File: `src/components/measurements/SchematicRoofDiagram.tsx`
- Respect `geometrySourceInfo.shouldShowLinearFeatures`, `requires_manual_review`, and low-confidence sources.
- If exact alignment metadata is missing or confidence is low, render perimeter-only plus the warning state instead of misaligned edge lines.

7. Add focused debug output for this specific issue
- File: `src/components/measurements/SchematicRoofDiagram.tsx`
- Show:
  - actual image source used
  - whether stored `image_bounds` or fallback math was used
  - analysis zoom/size
  - crop source (`eaves/rakes`, footprint, perimeter, fallback)
  - transform mode (`exact image-space` vs fallback)
- This will make future alignment failures obvious on the lead page.

Expected result
- The lead-page preview uses the same image and same transform the measurement used.
- The roof fills the preview tightly enough to verify edges.
- Eaves/rakes either align to the visible roof edges or are hidden when the system cannot prove accuracy.
- The report dialog and card preview stay visually consistent.

Technical details
- The remaining misalignment is not just “needs more zoom.”
- It is caused by four concrete gaps:
  - missing alignment metadata in the lead-page query,
  - wrong image source selection,
  - fallback projection math in `SchematicRoofDiagram`,
  - and no enforcement of low-confidence line hiding.
- Main files to update:
  - `src/components/measurements/UnifiedMeasurementPanel.tsx`
  - `src/components/measurements/SchematicRoofDiagram.tsx`
  - `src/utils/gpsCalculations.ts`
  - optionally `src/utils/geoCoordinates.ts`
