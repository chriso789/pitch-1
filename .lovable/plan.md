

# Fix Roof Diagram Alignment and Zoom

## Problem
Two issues cause the diagram to not align with the satellite image and not zoom in enough:

1. **Coordinate field mismatch**: The `diagramMeasurement` object passes `target_lat`/`target_lng`, but `SchematicRoofDiagram` looks for `gps_coordinates.lat`, `measurement.lat`, or `measurement.center_lat`. None match, so `imageBounds` returns `null` and the GPS-to-pixel transform fails silently — lines are drawn using bounds-fit math that doesn't align with the satellite image underneath.

2. **Missing metadata fields**: `analysis_zoom` and `analysis_image_size` are not passed to the diagram, though the defaults (zoom=20, 640x640) happen to match what the edge function stores. Still needs explicit pass-through for correctness.

## Changes

### 1. Fix coordinate mapping in `diagramMeasurement`
**File: `src/components/measurements/UnifiedMeasurementPanel.tsx` (~line 601)**

Add the fields that `SchematicRoofDiagram` needs for satellite alignment:

```typescript
const diagramMeasurement = {
  id: ai.id,
  target_lat: ai.target_lat,
  target_lng: ai.target_lng,
  // ADD THESE for imageBounds calculation:
  gps_coordinates: { lat: ai.target_lat, lng: ai.target_lng },
  analysis_zoom: 20,
  analysis_image_size: { width: 640, height: 640 },
  // existing fields...
  linear_features_wkt: ai.linear_features_wkt,
  perimeter_wkt: ai.perimeter_wkt,
  footprint_vertices_geo: ai.footprint_vertices_geo,
  footprint_confidence: ai.footprint_confidence,
  footprint_source: ai.footprint_source,
  detection_method: ai.detection_method,
  total_adjusted_area: ai.total_area_adjusted_sqft || 0,
};
```

### 2. Same fix for the MeasurementReportDialog data
**File: `src/components/measurements/UnifiedMeasurementPanel.tsx` (~line 733)**

Add `gps_coordinates`, `analysis_zoom`, and `analysis_image_size` to the measurement object passed to `MeasurementReportDialog` so the report's diagram also aligns correctly.

### 3. Increase diagram size for better roof visibility
**File: `src/components/measurements/UnifiedMeasurementPanel.tsx` (~line 639)**

Increase the `SchematicRoofDiagram` rendering height from 280 to 350 to give the roof more visual space in the card.

These three changes will make the ridge/hip/valley/eave lines align precisely with the satellite imagery, matching the roof structure visible in the photo.

