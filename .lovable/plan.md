

# Align Diagram Lines to Satellite Roof — Plan

## Problem
The roof diagram overlay shows lines (valleys, ridges, eaves, rakes) that don't match the actual roof edges visible in the satellite image. The lines are close but drift by several pixels, making the diagram look inaccurate.

## Root Causes
1. **image_bounds computed from center/zoom** — When no stored `image_bounds` exist, the system calculates bounds using Mercator math from the satellite image center + zoom. Any mismatch with how Mapbox actually tiles the image causes uniform drift.
2. **@2x retina correction** — The code halves image dimensions > 1280, but if the actual image IS high-res, this introduces a 2x scaling error in the GPS-to-pixel mapping.
3. **Edge auto-fit only applies to eaves/rakes** — The existing `edgeAutoFit.ts` uses luminance contrast detection to snap eave/rake lines to visible roof edges, but ridges, hips, and valleys are never auto-fitted.
4. **Perimeter snap tolerance too generous** — Eave/rake endpoints snap to footprint vertices within ~30m, which can pull lines to wrong corners.

## Plan (3 changes)

### 1. Extend edge auto-fit to interior lines (ridges, hips, valleys)
**File:** `src/lib/measurements/edgeAutoFit.ts`

- Add `ridgeSegments`, `hipSegments`, `valleySegments` to `AutoFitAllEdgesOptions`
- For interior lines, use a tighter search range (±3px vs ±8px for eaves) since they're usually closer to correct
- Interior lines have contrast between adjacent facets (different shading angles) — use the same luminance gradient detection
- Return fitted versions of all line types

### 2. Pass interior lines to auto-fit in SchematicRoofDiagram
**File:** `src/components/measurements/SchematicRoofDiagram.tsx`

- Extract ridge/hip/valley segments in the same format as eave/rake segments (with SVG coords + GPS coords)
- Pass them to `autoFitAllEdges` alongside eaves/rakes
- Use the fitted results for rendering instead of raw GPS-projected positions
- This makes ALL lines snap to the visible roof edges in the satellite image

### 3. Improve image bounds accuracy with stored bounds preference
**File:** `src/components/measurements/SchematicRoofDiagram.tsx`

- When `image_bounds` is missing and bounds are computed from center/zoom, add a global offset correction: compare where the perimeter centroid lands vs where the roof center appears in the image, and apply a uniform translation to all lines
- Reduce the `@2x` correction threshold from 1280 to only apply when `analysis_zoom >= 19` (high zoom produces smaller tiles)
- Log the computed vs stored bounds discrepancy for debugging

## Technical Details
- The auto-fit algorithm samples luminance contrast along the perpendicular to each line at 8 points, finding the offset with maximum contrast (= roof edge). This already works well for eaves — extending it to interior lines leverages the same proven approach.
- Interior lines have weaker contrast (facet-to-facet vs roof-to-ground), so the improvement threshold is lowered from 4% to 2%.
- No database or edge function changes needed — this is purely client-side rendering improvement.

