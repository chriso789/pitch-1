

# Show Full Measurement Report with Roof Diagram for AI Results

## Problem
When AI measurements are pulled, the "Latest AI Measurement" card only shows basic stats (squares, sqft, pitch) and a satellite thumbnail. It does not display a roof diagram with ridge, hip, valley, eave, and rake measurements drawn on the actual roof shape.

## Solution
Embed the existing `SchematicRoofDiagram` component directly into the "Latest AI Measurement" card, and expand the linear measurement summary. The diagram already supports rendering all edge types from `linear_features_wkt` data.

## Changes

### 1. Update AI measurement query to fetch diagram data
**File: `src/components/measurements/UnifiedMeasurementPanel.tsx`**
- Add `linear_features_wkt`, `perimeter_wkt`, `target_lat`, `target_lng`, `footprint_vertices_geo`, `footprint_confidence`, `google_maps_image_url`, `satellite_overlay_url` to the `select()` call in the `aiMeasurements` query (line ~314).

### 2. Add SchematicRoofDiagram to the Latest AI Measurement card
**File: `src/components/measurements/UnifiedMeasurementPanel.tsx`**
- Import `SchematicRoofDiagram` from `@/components/measurements/SchematicRoofDiagram`.
- Inside the `latestUnapprovedAI` card (line ~588-641), replace the static satellite image with:
  - A `SchematicRoofDiagram` rendered with the AI measurement data, satellite overlay, and length labels enabled.
  - Show legend for edge types (ridge, hip, valley, eave, rake).
- Below the diagram, add a linear measurements summary grid showing: Ridge, Hip, Valley, Eave, Rake totals (already available as `total_ridge_length`, `total_hip_length`, etc.).

### 3. Build tags object for the diagram
- Construct a `tags` record from the AI measurement's linear length totals (`linear.ridge_ft`, `linear.hip_ft`, etc.) so the diagram renders correctly, similar to how `TrainingSchematicWrapper` does it.

### 4. Also show diagram on saved MeasurementCards
- When a saved measurement has `source: 'ai_pulled'`, add a collapsible "View Report" section that renders the same `SchematicRoofDiagram` by fetching the linked `roof_measurements` record.

## Technical Details
- `SchematicRoofDiagram` accepts a `measurement` prop with `linear_features_wkt` (array of `{type, wkt, length_ft}`) and `perimeter_wkt` — both stored in `roof_measurements`.
- The component handles GPS-to-pixel projection, edge coloring by type, and length label rendering internally.
- Satellite overlay uses `google_maps_image_url` or `satellite_overlay_url`.
- No new components needed — reusing existing `SchematicRoofDiagram`.

