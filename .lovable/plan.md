

# Fix Measurement Report: Add Roof Diagram + Interactive Edit Mode

## Problem
The Measurement Report dialog shows "No visualization available" because it references a non-existent `mapbox_visualization_url` column. There is no roof diagram drawn. The "Edit Mode" is not functional for manual pin-drop measurements.

## Changes

### 1. Replace "Satellite Visualization" with SchematicRoofDiagram (View Mode)
**File: `src/components/measurements/ComprehensiveMeasurementReport.tsx`**
- Import `SchematicRoofDiagram` and `SegmentHoverProvider` from existing components.
- In **View Mode**, render `SchematicRoofDiagram` with the measurement data instead of checking for `mapbox_visualization_url`. The diagram draws the roof outline with color-coded edges (ridge=green, hip=purple, valley=red, eave=dark green, rake=teal) and length labels — matching EagleView/Roofr style reports.
- Use `google_maps_image_url` or `satellite_overlay_url` as the satellite background for the diagram.
- Rename section title from "Satellite Visualization" to "Roof Diagram".

### 2. Build Interactive Pin-Drop Edit Mode
**File: `src/components/measurements/ComprehensiveMeasurementReport.tsx`**
- In **Edit Mode**, render an interactive canvas over the satellite image where users can:
  - Click to drop pins on roof corners/vertices
  - Connect pins to form edges (ridge, hip, valley, eave, rake)
  - Select edge type from a toolbar
  - See real-time length calculations between pins (GPS-based)
- This replaces the current `ComprehensiveMeasurementOverlay` which just displays static geometry.

**New File: `src/components/measurements/ManualPinDropEditor.tsx`**
- SVG-based editor rendered over a satellite image
- Tools: Add Point, Connect Points, Select Edge Type, Delete
- Edge type selector (Ridge/Hip/Valley/Eave/Rake) with matching colors
- Real-time distance calculation using haversine formula
- Save capability that writes manual edges back to the measurement

### 3. Pass correct satellite URL to report
**File: `src/components/measurements/UnifiedMeasurementPanel.tsx`**
- When constructing the measurement object for the report dialog, map `google_maps_image_url` or `satellite_overlay_url` to a `satelliteImageUrl` field so the diagram and editor have a background image.

### 4. Wire up data flow
- The `SchematicRoofDiagram` already parses `linear_features_wkt` and `perimeter_wkt` from the measurement object — these fields are already being fetched and passed through.
- Ensure `center_lat`, `center_lng` are passed for coordinate transformations.

## Technical Details
- `SchematicRoofDiagram` is a 1900-line component that already handles GPS-to-SVG projection, edge coloring, length labels, facet fills, compass rose, and legend. It just needs to be wired into the report.
- The `ManualPinDropEditor` will use the same `calculateImageBounds` + `gpsToPixel` utilities for coordinate conversion.
- Edge type colors match Roofr conventions already defined in `FEATURE_COLORS`.

