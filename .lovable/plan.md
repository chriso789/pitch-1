
# Comprehensive AI Roof Measurement & Diagram Generation - Implementation Plan

## Overview

This implementation plan enhances the existing AI Measurement Pipeline with rigorous polygon cleanup, intelligent feature classification, advanced pitch estimation, real-time validation, and an interactive user correction interface. The goal is to achieve **98%+ accuracy** matching professional EagleView/Roofr measurements with fully automated processing.

---

## Phase 1: Enhanced Mask-to-Polygon Pipeline

### 1.1 Morphological Mask Cleanup Module

**New File:** `supabase/functions/_shared/mask-processor.ts`

This module handles the conversion of raw segmentation masks to clean, architectural-quality polygons.

**Core Functions:**

| Function | Purpose |
|----------|---------|
| `fillInteriorHoles(mask, maxHoleArea)` | Removes small holes (<15 m²) in roof mask |
| `morphologicalOpen(mask, kernelSize)` | Erosion→Dilation to remove noise/jaggies |
| `removeSmallFragments(mask, minArea)` | Filters out tiny mask regions (<1 m²) |
| `mergeNearbyFragments(mask, distanceThreshold)` | Connects disjoint roof sections within proximity |
| `applyMaskToPolygon(cleanedMask)` | Contour trace to extract boundary polygon |

**Implementation Approach:**
- Since Deno Edge Functions lack OpenCV, we'll implement:
  - Pure TypeScript raster operations for hole filling
  - Flood-fill algorithm for connected component analysis
  - Marching squares algorithm for contour extraction
- For production quality, consider calling an external Python service with OpenCV

### 1.2 Douglas-Peucker Polygon Simplification

**Update:** `supabase/functions/_shared/polygon-simplifier.ts` (new shared module)

Move and enhance the existing Douglas-Peucker from `regrid-footprint-extractor.ts`:

```text
┌─────────────────────────────────────────────────────────────┐
│             Polygon Simplification Pipeline                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 1. Douglas-Peucker (tolerance ≈ 0.3m / 1 pixel)             │
│    → Reduce vertex count while preserving shape              │
│                                                              │
│ 2. Angle Snapping                                            │
│    → Snap corners within ±12° to exact 90°/45°               │
│                                                              │
│ 3. Edge Straightening                                        │
│    → Force near-parallel edges to be truly parallel          │
│                                                              │
│ 4. Closure Validation                                        │
│    → Ensure polygon start == end, no self-intersections      │
│                                                              │
│ 5. Minimum Vertex Check                                      │
│    → Buildings must have ≥4 vertices                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**New Functions:**
- `snapToOrthogonal(polygon, angleTolerance)` - Forces ~90° corners to exact 90°
- `snap45Degrees(polygon)` - Forces diagonal lines to exact 45°
- `straightenEdges(polygon, deviationThreshold)` - Makes wobbly edges straight
- `validateClosedPolygon(polygon)` - Ensures closure and no self-intersection
- `simplifyAndClean(rawPolygon, options)` - Master orchestration function

### 1.3 Edge Detection Refinement

**New File:** `supabase/functions/_shared/edge-snapper.ts`

Uses satellite image analysis to snap polygon edges to actual visible roof boundaries.

**Algorithm:**
1. For each simplified polygon edge, sample pixels perpendicular to edge
2. Detect highest-contrast line within ±5 pixel corridor
3. Adjust polygon vertices to align with detected edge
4. Use Hough Line Transform approximation for precise line fitting
5. Re-validate polygon after adjustments

**Note:** Full Hough Transform requires image processing - we'll implement a simplified gradient-based approach or integrate external service call.

---

## Phase 2: Intelligent Roof Feature Classification

### 2.1 Enhanced Feature Classifier

**Update:** `supabase/functions/_shared/roof-geometry-reconstructor.ts`

Add rigorous classification logic based on geometric analysis:

```text
┌─────────────────────────────────────────────────────────────┐
│              Feature Classification Rules                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ INPUT: Footprint polygon + Facet polygons                    │
│                                                              │
│ STEP 1: Build Adjacency Graph                                │
│ - Identify which facets share edges                          │
│ - Classify edges as interior (shared) vs exterior (boundary) │
│                                                              │
│ STEP 2: Classify Exterior Edges (Perimeter)                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ EAVE: Exterior edge at facet's lowest elevation         │ │
│ │       - Usually horizontal in plan view                 │ │
│ │       - Parallel to building's longer dimension         │ │
│ │       - Where gutters attach                            │ │
│ │                                                          │ │
│ │ RAKE: Exterior edge at gable end (sloped perimeter)     │ │
│ │       - Inclined relative to ground                     │ │
│ │       - At sides of gable roofs                         │ │
│ │       - Runs from eave up to ridge                      │ │
│ │                                                          │ │
│ │ HIP (exterior): Diagonal line from corner to ridge      │ │
│ │       - External convex angle                           │ │
│ │       - On hip/pyramid roofs                            │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ STEP 3: Classify Interior Edges                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ RIDGE: Shared edge at highest elevation                 │ │
│ │        - Generally horizontal in plan view              │ │
│ │        - Between two opposing sloped facets             │ │
│ │        - Usually runs along building centerline         │ │
│ │                                                          │ │
│ │ VALLEY: Shared edge at concave intersection             │ │
│ │         - Where footprint has inward angle              │ │
│ │         - Water collection line (internal gutter)       │ │
│ │         - Common in L/T-shaped buildings                │ │
│ │                                                          │ │
│ │ HIP (interior): Diagonal from ridge to corner           │ │
│ │         - Convex junction on exterior                   │ │
│ │         - Connects ridge endpoint to building corner    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ STEP 4: Validation                                           │
│ - Ridge never on outer boundary                              │
│ - Every gable roof has ≥1 ridge                              │
│ - Valleys at reflex (concave) vertices only                  │
│ - Hips at convex corners only                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**New Functions:**
- `buildFacetAdjacencyGraph(facets)` - Creates edge adjacency data structure
- `classifyExteriorEdge(edge, facet, adjacentFacets)` - Eave vs Rake vs Hip logic
- `classifyInteriorEdge(edge, facet1, facet2)` - Ridge vs Valley vs Hip logic
- `validateClassifications(features)` - Check for logical consistency
- `detectReflexVertices(polygon)` - Find concave corners for valley placement

### 2.2 Facet Subdivision from Single Footprint

**Update:** `supabase/functions/_shared/facet-generator.ts` (new)

When AI returns only footprint (no facets), generate facets geometrically:

| Roof Shape | Facet Generation Strategy |
|------------|---------------------------|
| Rectangle | Split along centerline for gable (2 facets) or create 4 triangular for hip |
| L-Shape | Decompose into 2 rectangles, generate facets per wing + valley |
| T-Shape | Decompose into 3 sections with valleys at intersections |
| U-Shape | 3 wings with valleys |
| Complex | Convex decomposition + ridge/valley inference |

**Algorithm for L-Shape:**
1. Identify reflex vertices using cross-product
2. Project from reflex vertex to find wing boundaries
3. Generate 2 rectangular wings
4. Create valley line from reflex vertex toward nearest ridge
5. Generate facets per wing using rectangular strategy

---

## Phase 3: Advanced Pitch Estimation

### 3.1 Multi-Source Pitch Detection

**Update:** `supabase/functions/_shared/pitch-estimator.ts` (new)

```text
┌─────────────────────────────────────────────────────────────┐
│                  Pitch Detection Priority                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 1. SOLAR API (if available)                                  │
│    - Ground truth from Google's analysis                     │
│    - Per-segment tiltDegrees available                       │
│    - Highest confidence source                               │
│                                                              │
│ 2. SHADOW ANALYSIS                                           │
│    - Measure shadow length from visible roof edges           │
│    - Requires: sun altitude angle + shadow measurement       │
│    - Formula: pitch_angle ≈ atan(height / shadow_length)     │
│    - Works best with clear shadows (morning/evening imagery) │
│                                                              │
│ 3. AI MODEL PREDICTION                                       │
│    - Gemini prompt: "Estimate pitch for each roof facet"     │
│    - Returns X/12 format per facet                           │
│    - Confidence score per prediction                         │
│                                                              │
│ 4. USER OVERRIDE                                             │
│    - Manual input from UI                                    │
│    - Stored with measurement                                 │
│                                                              │
│ 5. REGIONAL DEFAULT                                          │
│    - Florida: 6/12 (hurricane resistance)                    │
│    - Northeast: 8/12 (snow shedding)                         │
│    - Flat: 1/12 to 2/12                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Shadow Analysis Module

**New File:** `supabase/functions/_shared/shadow-pitch-analyzer.ts`

**Implementation:**
1. Detect shadows in satellite image (dark regions adjacent to roof)
2. Measure shadow length in pixels → convert to feet via scale
3. If image timestamp available, calculate sun altitude:
   - Use latitude + date + time → solar position algorithm
   - Solar altitude = degrees above horizon
4. Calculate pitch: `tan(pitch) = (shadow_length × tan(sun_altitude)) / overhang`
5. Cross-validate with AI prediction

**Note:** Many satellite images are captured near noon with minimal shadows - this method works best when shadows are visible.

---

## Phase 4: Measurement Calculation Enhancements

### 4.1 Unified Coordinate Transformation

**Update:** `supabase/functions/_shared/geometry-validator.ts`

Add precise GPS↔Pixel conversion functions:

```typescript
// New functions to add:
pixelToGps(x, y, bounds, imageSize) → { lat, lng }
gpsToPixel(lat, lng, bounds, imageSize) → { x, y }
calculateAreaFromWKT(wktPolygon) → sqft
calculateLengthFromWKT(wktLinestring) → ft
haversineDistance(lat1, lng1, lat2, lng2) → ft  // Already exists
shoelaceAreaGPS(vertices) → sqft  // Already exists
```

### 4.2 Facet Area Calculation with Pitch Multiplier

**Update:** `supabase/functions/_shared/roofWorksheetEngine.ts`

Add new function:

```typescript
calculateFacetSurfaceArea(planArea: number, pitch: string): {
  planArea: number;      // Flat/horizontal projection
  surfaceArea: number;   // Actual inclined area
  slopeFactor: number;   // Multiplier used
  formula: string;       // "2450 × 1.118 = 2739.1"
}
```

### 4.3 Aggregation Functions

Add to worksheet engine:

- `aggregateFacetTotals(facets)` - Sum all facet areas with breakdown
- `aggregateLinearByType(linearFeatures)` - Totals per line type
- `calculateRoofSquares(totalSurfaceArea)` - Total / 100
- `determinePredominantPitch(facets)` - Pitch covering largest area

---

## Phase 5: Diagram Generation Improvements

### 5.1 Satellite Overlay with Polygon Rendering

**Update:** `supabase/functions/generate-roof-overlay/index.ts` (new - placeholder exists)

**Implementation:**
1. Fetch satellite image at coordinates
2. Draw polygon outline on image:
   - Footprint in dark outline (#343A40)
   - Facets filled with semi-transparent colors (FACET_COLORS array)
3. Draw linear features with color coding:
   - Ridge: Light green (#90EE90)
   - Hip: Purple (#9B59B6)
   - Valley: Red (#DC3545)
   - Eave: Dark green (#006400)
   - Rake: Cyan (#17A2B8)
4. Add length labels along each segment
5. Add facet number labels at centroids
6. Add north arrow indicator
7. Save to Supabase Storage `roof-overlays` bucket
8. Return public URL

**Technical Approach:**
- Use Canvas API (if available) or generate SVG overlay + composite
- Alternative: Call external image processing service (Python/Sharp)

### 5.2 Vector Schematic Diagram

**Update:** `src/components/measurements/SchematicRoofDiagram.tsx`

The existing component is already robust. Enhancements:

1. **Facet rendering from `facets_json`:**
   - Parse per-facet polygons
   - Color-code by facet ID or pitch
   - Show facet number labels

2. **Linear feature rendering from `linear_features_wkt`:**
   - Already parsing WKT
   - Add individual length labels per segment
   - Interactive hover to highlight corresponding table row

3. **Legend improvements:**
   - Color-coded boxes for each feature type
   - Total lengths per type

4. **Compass rose:**
   - Already implemented (north arrow)
   - Ensure correct orientation based on GPS coordinates

---

## Phase 6: PDF Report Enhancements

### 6.1 Multi-Page Report Structure

**Update:** `supabase/functions/generate-roofr-style-report/index.ts`

Expand to 7-page EagleView-quality format:

| Page | Content |
|------|---------|
| **1. Cover** | Company logo, address, satellite overlay with detected polygon, key stats (total area, facets, pitch) |
| **2. Roof Diagram** | Vector schematic SVG (clean, no photo), legend, facet numbers |
| **3. Length Measurements** | Diagram with line labels + table (Eave, Rake, Ridge, Hip, Valley totals) |
| **4. Area Measurements** | Per-facet table (ID, Plan Area, Surface Area, Pitch, Direction), waste calculator |
| **5. Pitch & Direction** | Facet-by-pitch breakdown, compass orientation diagram |
| **6. Materials Summary** | Shingle bundles, ridge cap, drip edge, etc. based on measurements |
| **7. Terms & Disclaimer** | Accuracy methodology, company contact, legal disclaimer |

### 6.2 Satellite Overlay Embedding

- Embed base64 of annotated satellite image on cover page
- Embed SVG diagram inline on page 2
- Ensure high resolution for print quality

---

## Phase 7: Quality Assurance Framework

### 7.1 QA Checks Module

**Update:** `supabase/functions/_shared/qa-checks.ts` (new)

```text
┌─────────────────────────────────────────────────────────────┐
│                   QA Validation Suite                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ GEOMETRY CHECKS:                                             │
│ ☐ Polygon is closed (start == end)                          │
│ ☐ No self-intersections                                     │
│ ☐ At least 4 vertices for building                          │
│ ☐ No extremely acute angles (<15°)                          │
│ ☐ Reasonable aspect ratio (<10:1)                           │
│                                                              │
│ FACET CHECKS:                                                │
│ ☐ Facets tile footprint without gaps                        │
│ ☐ Facets don't overlap                                      │
│ ☐ Sum of facet areas ≈ footprint area (±5%)                 │
│ ☐ Each interior edge shared by exactly 2 facets             │
│                                                              │
│ CLASSIFICATION CHECKS:                                       │
│ ☐ No ridge on outer boundary                                │
│ ☐ At least 1 ridge for non-flat roofs                       │
│ ☐ Valleys only at reflex vertices                           │
│ ☐ Hips connect ridge to corners                             │
│                                                              │
│ MEASUREMENT CHECKS:                                          │
│ ☐ Area within reasonable range (500-50,000 sqft)            │
│ ☐ Perimeter proportional to area                            │
│ ☐ Pitch values are valid (0-18/12)                          │
│ ☐ All linear features have length > 3ft                     │
│                                                              │
│ CROSS-VALIDATION:                                            │
│ ☐ If Solar API available, area within ±5%                   │
│ ☐ If EagleView/vendor report available, area within ±2%     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Confidence Scoring

**Function:** `calculateOverallConfidence(segmentation, facets, features, pitch)`

**Scoring Components:**
| Factor | Weight | High Score Criteria |
|--------|--------|---------------------|
| Segmentation confidence | 25% | AI returns >0.85 |
| Facet closure | 20% | All facets properly closed |
| Edge continuity | 15% | Lines >3ft, <100ft |
| Pitch detection | 15% | From Solar API or high-confidence AI |
| QA checks passed | 25% | All checks pass |

**Thresholds:**
- ≥0.85: "High" - Auto-accept
- 0.70-0.84: "Medium" - Prompt user review
- <0.70: "Low" - Require manual verification

---

## Phase 8: Interactive User Correction Interface

### 8.1 Enhanced Manual Measurement Editor

**Update:** `src/components/measurements/ManualMeasurementEditor.tsx`

**Features to Add:**

1. **Pre-load AI Geometry:**
   - Display AI-detected polygon on canvas
   - Show all vertices as draggable handles
   - Show interior lines (ridges, valleys, hips) as editable segments

2. **Vertex Editing:**
   - Click-and-drag to move vertices
   - Snap to 90°/45° angles during drag
   - Add new vertex by clicking on edge
   - Remove vertex by right-click or delete key

3. **Interior Line Editing:**
   - Draw new lines between points
   - Classify line type (ridge/valley/hip) via dropdown
   - Delete line by clicking in "delete mode"
   - Auto-classify based on context

4. **Real-time Calculations:**
   - Update area/perimeter as user edits
   - Show individual segment lengths
   - Display pitch input per facet

5. **Snapping Grid:**
   - Optional grid overlay (5ft increments)
   - Snap vertices to grid when enabled
   - Snap to common angles (0°, 45°, 90°)

6. **Undo/Redo:**
   - History stack for all edits
   - Keyboard shortcuts (Ctrl+Z, Ctrl+Y)

### 8.2 Override Workflow

1. User reviews AI measurement in `RoofrStyleReportPreview`
2. Clicks "Edit Measurement" button
3. `ManualMeasurementEditor` opens with AI geometry pre-loaded
4. User makes adjustments
5. Click "Save" → triggers recalculation via worksheet engine
6. New PDF generated automatically
7. Original vs edited saved for accuracy training

---

## Phase 9: CRM Integration Updates

### 9.1 Database Schema (Already Migrated)

Columns already added to `roof_measurements`:
- `facets_json` - Per-facet polygon/area/pitch data
- `satellite_overlay_url` - Annotated satellite image URL
- `vector_diagram_svg` - Inline SVG for diagram
- `measurement_method` - 'ai_segmentation' | 'solar_api' | 'manual'
- `segmentation_confidence` - 0-1 score
- `qa_passed` - Boolean

### 9.2 Measurement Saving Flow

**Update:** `supabase/functions/analyze-roof-aerial/index.ts`

```text
1. fetchSatelliteImage() → High-res image
2. preprocessImage() → Enhanced image
3. segmentRoof() → AI detection (existing roof-segmentation function)
4. cleanPolygon() → NEW: Mask cleanup + simplification
5. classifyFeatures() → NEW: Enhanced classification
6. estimatePitch() → NEW: Multi-source pitch
7. calculateMeasurements() → Worksheet engine
8. runQAChecks() → NEW: Validation suite
9. generateOverlay() → Annotated satellite image
10. generatePDF() → Professional report
11. saveMeasurement() → Persist all data
12. return { measurementId, pdfUrl, confidence }
```

---

## Phase 10: Files to Create/Update Summary

### New Files
| Path | Purpose |
|------|---------|
| `supabase/functions/_shared/mask-processor.ts` | Morphological cleanup for segmentation masks |
| `supabase/functions/_shared/polygon-simplifier.ts` | Douglas-Peucker + angle snapping |
| `supabase/functions/_shared/edge-snapper.ts` | Align polygon to image edges |
| `supabase/functions/_shared/facet-generator.ts` | Generate facets from footprint |
| `supabase/functions/_shared/pitch-estimator.ts` | Multi-source pitch detection |
| `supabase/functions/_shared/qa-checks.ts` | QA validation suite |
| `supabase/functions/generate-roof-overlay/index.ts` | Annotated satellite overlay |

### Files to Update
| Path | Changes |
|------|---------|
| `supabase/functions/roof-segmentation/index.ts` | Integrate mask cleanup, facet generation |
| `supabase/functions/_shared/roof-geometry-reconstructor.ts` | Enhanced classification rules |
| `supabase/functions/_shared/geometry-validator.ts` | Add GPS↔pixel transforms |
| `supabase/functions/_shared/roofWorksheetEngine.ts` | Add facet aggregation functions |
| `supabase/functions/analyze-roof-aerial/index.ts` | Orchestrate full pipeline |
| `supabase/functions/generate-roofr-style-report/index.ts` | 7-page format, overlay embedding |
| `src/components/measurements/ManualMeasurementEditor.tsx` | Pre-load AI geometry, snapping |
| `src/components/measurements/SchematicRoofDiagram.tsx` | Render facets_json, interactive |

---

## Implementation Priority & Timeline

| Priority | Phase | Effort |
|----------|-------|--------|
| **P0** | Phase 2: Feature Classification | 3 days |
| **P0** | Phase 4: Measurement Calculations | 2 days |
| **P0** | Phase 7: QA Framework | 2 days |
| **P1** | Phase 1: Polygon Cleanup | 4 days |
| **P1** | Phase 6: PDF Report | 3 days |
| **P2** | Phase 5: Diagram Generation | 3 days |
| **P2** | Phase 8: User Correction UI | 4 days |
| **P3** | Phase 3: Advanced Pitch | 3 days |

**Total Estimated Effort:** 3-4 weeks

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Total Area Accuracy | ±2% vs EagleView |
| Linear Measurements | ±6 inches |
| Pitch Detection | ±1° (X/12 format) |
| Facet Count | 100% match |
| End-to-End Time | <15 seconds |
| QA Pass Rate | >90% first-attempt |
| Manual Override Rate | <10% of measurements |

---

## Technical Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Mask cleanup needs image processing | Start with simplified TypeScript; add external service for production |
| Shadow analysis unreliable | Use as secondary source; prioritize Solar API and AI prediction |
| Complex roof shapes fail | Fall back to single footprint with manual facet override |
| Edge function timeout | Increase `wall_clock_limit` to 120s; parallelize where possible |
| AI hallucinated geometry | QA checks catch invalid topologies; require manual review for low confidence |
