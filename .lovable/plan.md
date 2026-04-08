

# Fix Top/Bottom Eave Misalignment with Satellite Image

## Root Cause (confirmed by data inspection)

The eave coordinates come from the OSM footprint (`footprint_source: osm_overpass`, `footprint_confidence: 0.8`). For this property, the OSM polygon is slightly taller in the north-south direction than the actual roof visible in the satellite image. The left/right rakes align because the east-west dimension of the OSM polygon happens to be accurate; the top/bottom eaves overshoot because the north-south dimension is slightly too large.

This is a **data accuracy** issue, not a rendering/transform bug. The coordinate transforms are mathematically correct.

## Implementation Plan

### 1. Fix backend bounds calculation bug (satellite-image-fetcher.ts)

The `calculateBounds` function on line 211 passes `size * scale` (1280) instead of `size` (640). Google Static Maps with `scale=2` returns more pixels but covers the same geographic area. This bug doesn't currently affect the frontend (since `image_bounds` is null), but fixing it is prerequisite for step 2.

Also fix the `calculateBounds` function itself to use Mercator Y math instead of linear latitude approximation. At latitude 26°, the linear approximation introduces ~5% vertical error.

**File:** `supabase/functions/_shared/satellite-image-fetcher.ts`

### 2. Store correct image_bounds in the DB during measurement

After fetching the satellite image, persist the corrected bounds into the `image_bounds` column so the frontend uses authoritative bounds instead of recomputing. This eliminates any potential mismatch between how the backend fetched the image and how the frontend interprets it.

**File:** The measure edge function that calls `satellite-image-fetcher` — update it to write `image_bounds` on the measurement row.

### 3. Apply footprint area correction when OSM confidence is low

When `footprint_confidence < 0.85` and Solar API area is available, compute a scale correction:
- Calculate the area of the OSM perimeter polygon
- Compare to `solar_building_footprint_sqft`
- If OSM is >5% larger, scale the perimeter inward toward its centroid by the ratio
- Apply the same correction to eave/rake endpoints

This corrects oversized OSM polygons to better match the actual building footprint.

**File:** `src/components/measurements/SchematicRoofDiagram.tsx` (in the perimeter/eave coordinate preparation section, lines ~390-450)

### 4. Add visual indicator for low-confidence footprint alignment

When the eave coordinates come from a low-confidence source (OSM with < 0.85 confidence), render eave/rake lines with a dashed stroke instead of solid, communicating to the user that edge placement is approximate. Add a small badge: "Edges approximate — tap to adjust."

**File:** `src/components/measurements/SchematicRoofDiagram.tsx` (in the SVG rendering section)

## Technical Details

- Backend bounds bug: line 211 of `satellite-image-fetcher.ts` — change `size * scale` to `size`
- Backend Mercator fix: replace linear `111320` approximation with proper `Math.log(Math.tan(...))` Mercator Y math in `calculateBounds`
- Frontend area correction: use `calculateGPSPolygonArea()` from existing `gpsCalculations.ts` to compute OSM polygon area, compare with `solar_building_footprint_sqft`, and apply centroid-based scaling if deviation > 5%
- The scaling transform: for each vertex, `new_coord = centroid + (vertex - centroid) * sqrt(solarArea / osmArea)`

