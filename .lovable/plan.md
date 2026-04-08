
Goal: make the AI measurement preview place eaves/rakes exactly on top of the roof edges in the satellite image instead of just “zooming tighter.”

What’s causing the mismatch
1. The preview is using a cropped geographic viewport in `SchematicRoofDiagram`, but that crop is still an approximation built from lat/lng min/max bounds.
2. The background image and the SVG lines are being aligned with simple linear lat/lng math, while the imagery pipeline supports higher-fidelity image-space metadata and even 2D registration tools in the measurement system.
3. The current preview favors “show something” behavior even for low-confidence geometry, which is why users can still see green eaves that visibly miss the roof.

Implementation plan

1. Upgrade the preview transform from “bounds crop” to “exact image-space fit”
- File: `src/components/measurements/SchematicRoofDiagram.tsx`
- Replace the current `overlayViewport`-based transform as the primary overlay mode.
- Compute SVG positions from the original analysis image pixel space first, then scale/crop that pixel-space rectangle into the preview.
- Use the same transform for both:
  - the satellite `<img>`
  - all eave/rake SVG coordinates
- This removes drift caused by separate geographic approximation paths.

2. Use authoritative roof extents for the crop box
- Prioritize crop bounds in this order:
  1. eave + rake endpoints
  2. `footprint_vertices_geo`
  3. `perimeter_wkt`
  4. full analysis image
- Build the crop rectangle from the actual roof outline, not just loose min/max of arbitrary features.
- Add a very small safety margin only for labels, with a stricter default than today.

3. Match the analysis image dimensions correctly
- The imagery pipeline supports scaled images (`@2x` / effective dimensions), but the diagram currently assumes the stored size directly.
- Normalize `analysis_image_size` handling so the overlay math uses the true source image dimensions consistently.
- Ensure the preview uses the exact same image-space width/height assumptions as the image fetch pipeline.

4. Add a strict “eave-first verification mode”
- In the AI preview card, render only:
  - satellite image
  - perimeter
  - eaves
  - rakes
- Temporarily suppress hips/ridges/valleys when alignment confidence is not yet proven.
- This matches the user request to start with eaves/rakes and verify them first before layering in the rest.

5. Stop showing exact-looking overlays when geometry is only estimated
- Tighten the confidence gating in `SchematicRoofDiagram` using existing geometry confidence logic.
- If the geometry source is estimated/low-confidence, either:
  - show perimeter-only, or
  - show an explicit “alignment not yet verified” state instead of misleading exact eaves.
- This is important because the current UI can imply precision that the data does not actually have.

6. Pass through any available alignment metadata
- File: `src/components/measurements/UnifiedMeasurementPanel.tsx`
- Expand the measurement object sent into the preview/report so `SchematicRoofDiagram` has all available overlay fields, including:
  - `footprint_vertices_geo`
  - `bounding_box`
  - `gps_coordinates`
  - `analysis_zoom`
  - `analysis_image_size`
  - any existing alignment/calibration fields already stored on the measurement
- This prepares the component to use stronger alignment data without fallback loss.

7. Add debug instrumentation for exact verification
- File: `src/components/measurements/SchematicRoofDiagram.tsx`
- Expand the debug panel to show:
  - crop source used (`eaves+rakes`, `footprint_vertices_geo`, `perimeter_wkt`, fallback)
  - source image dimensions
  - crop rectangle in image pixels
  - edge coverage %
  - whether the render is image-space exact vs geographic fallback
- This will make future alignment problems diagnosable instead of guesswork.

8. Optional next-step enhancement if residual mismatch remains
- If eaves still miss after exact image-space fitting, the remaining issue is upstream geometry, not preview zoom.
- Then the next implementation should use the project’s existing spatial alignment/registration pipeline to store a per-measurement transform and render through that transform in the preview.
- That would be the true “exact” path when AI geometry and aerial imagery are not naturally aligned.

Expected result
- The roof fills the preview much more tightly.
- Eaves and rakes render directly on the visible roof edges instead of outside the structure.
- Users can visually confirm edge placement before adding hips/ridges/valleys.
- Low-confidence measurements stop pretending to be exact.

Technical notes
- Main issue is not just zoom; it is transform fidelity.
- Current code mixes:
  - geographic bounds fitting
  - cropped overlay viewport math
  - CSS image cropping
- The fix is to unify everything around one image-space transform.
- Relevant files:
  - `src/components/measurements/SchematicRoofDiagram.tsx`
  - `src/components/measurements/UnifiedMeasurementPanel.tsx`
  - `src/utils/gpsCalculations.ts`
- Existing system context suggests the measurement pipeline already has stronger alignment concepts available, so the preview should be built to consume them rather than relying on loose viewport fitting.
