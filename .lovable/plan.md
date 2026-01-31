
# AI Roof Measurement Pipeline Overhaul - Implementation Plan

## Executive Summary

This plan outlines a comprehensive overhaul of Pitch CRM's AI Measurement system to replace the current Google Solar API + Mapbox hybrid approach with a unified, image-based pipeline using deep learning segmentation. The goal is to produce EagleView-quality measurements and professional PDF reports with per-facet details from a single "AI Measurement" button click.

---

## Current Architecture Analysis

### Existing Components (to be retained/enhanced)
- **`analyze-roof-aerial/index.ts`** (~5,600 lines): Main orchestrator using Solar Fast Path + AI fallback
- **`measure/index.ts`** (~3,900 lines): Secondary measurement endpoint with topology analysis
- **`_shared/roofWorksheetEngine.ts`**: Authoritative calculation backbone (pitch, slope factors, QA)
- **`_shared/unified-measurement-pipeline.ts`**: Consolidated API orchestration
- **`generate-roofr-style-report/index.ts`**: HTML-to-PDF report generation via `smart-docs-pdf`
- **`PullMeasurementsButton.tsx`**: Frontend entry point calling `analyze-roof-aerial`
- **`RoofrStyleReportPreview.tsx`**: Multi-page report preview with diagram

### Current Limitations Addressed by This Overhaul
1. **No individual facet polygons** from Solar API (only aggregate totals)
2. **Incomplete diagrams** - placeholders instead of actual geometry
3. **Multiple code paths** (Solar Fast Path vs AI Analysis vs Manual) causing inconsistency
4. **No deep learning segmentation** - relies on GPT-4 Vision for polygon detection
5. **PDF reports lack actual satellite overlay** with detected roof

---

## Phase 1: High-Resolution Satellite Image Acquisition

### 1.1 Enhanced Image Fetching Service

Create/update: `supabase/functions/_shared/satellite-image-fetcher.ts`

```text
┌─────────────────────────────────────────────────┐
│           Satellite Image Fetcher               │
├─────────────────────────────────────────────────┤
│ Input: lat, lng, propertyId                     │
│                                                 │
│ 1. Try Google Static Maps API (zoom 21, 2560px)│
│ 2. Fallback to Mapbox Static (zoom 20, 2x)     │
│ 3. Tile stitching for large properties         │
│ 4. Return: base64 image + geospatial bounds    │
└─────────────────────────────────────────────────┘
```

**Key specifications:**
- Primary: Google Static Maps API at zoom 21, size 1280x1280, scale 2 (2560x2560 effective)
- Secondary: Mapbox satellite-v9 at zoom 20 with @2x retina
- Cache images in Supabase Storage for re-analysis
- Return geospatial bounds for coordinate transformation

### 1.2 Image Caching Layer

Update: `supabase/functions/_shared/cache.ts`

- Store fetched satellite images with TTL of 30 days
- Key format: `sat_{lat6}_{lng6}_z{zoom}_{timestamp}`
- Check cache before API call to reduce costs

---

## Phase 2: Image Preprocessing Pipeline

### 2.1 Preprocessing Service

Create: `supabase/functions/_shared/image-preprocessor.ts`

**Preprocessing steps:**
1. **Brightness/Contrast normalization** - Auto-adjust histogram
2. **Shadow mitigation** - Adaptive histogram equalization (CLAHE)
3. **Noise reduction** - Median filter for JPEG artifacts
4. **Edge enhancement** - High-pass sharpening for roof lines

**Technical approach:**
- Use Sharp.js (available in Deno) or pure TypeScript canvas operations
- Output preprocessed base64 image ready for ML inference
- Calculate and store "image_quality_score" (0-1) for QA

---

## Phase 3: Deep Learning Roof Segmentation

### 3.1 ML Model Integration Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                 AI Detection Service                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌─────────────────┐    ┌───────────┐ │
│  │ Preprocessed │ -> │  ML Inference   │ -> │ Polygon   │ │
│  │ Image        │    │  (External API) │    │ Extraction│ │
│  └──────────────┘    └─────────────────┘    └───────────┘ │
│                                                             │
│  Model Options:                                             │
│  1. Segment Anything Model (SAM) via Replicate             │
│  2. Custom U-Net via Hugging Face                          │
│  3. Enhanced Gemini 2.5 Vision (current, optimized)        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Roof Segmentation Edge Function

Create: `supabase/functions/roof-segmentation/index.ts`

**Responsibilities:**
1. Accept preprocessed satellite image
2. Call ML inference endpoint (prioritize external GPU service)
3. Post-process mask to clean polygon
4. Apply Douglas-Peucker simplification
5. Snap corners to orthogonal angles (90°, 45°)
6. Return footprint polygon + optional facet subdivisions

### 3.3 Enhanced AI Prompt (Gemini 2.5 Flash - Short Term)

Until external ML model is integrated, enhance current Gemini approach:

Update: `supabase/functions/_shared/interior-line-detector.ts`

**Improved prompt engineering:**
- Request per-facet polygons, not just interior lines
- Enforce closed polygon validation
- Include pitch estimation per facet
- Request confidence scores per detected element

---

## Phase 4: Roof Feature Identification

### 4.1 Automated Feature Classification

Update: `supabase/functions/_shared/roof-geometry-reconstructor.ts`

**Feature detection from segmented facets:**

```text
┌─────────────────────────────────────────────────────┐
│              Feature Classifier                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Input: Facet polygons + adjacency graph             │
│                                                     │
│ Classification Rules:                               │
│ ─────────────────────────────────────────────────  │
│ RIDGE: Shared edge at highest elevation             │
│        between two sloped facets                    │
│                                                     │
│ HIP: External convex edge where facets meet         │
│      at perimeter (diagonal from corner)            │
│                                                     │
│ VALLEY: Internal concave edge where facets          │
│         meet (water collection line)                │
│                                                     │
│ EAVE: Horizontal perimeter edge at roof base        │
│       (parallel to ground, gutter line)             │
│                                                     │
│ RAKE: Sloped perimeter edge at gable end            │
│       (inclined, follows roof pitch)                │
│                                                     │
│ Output: Classified LinearFeature[] with WKT         │
└─────────────────────────────────────────────────────┘
```

### 4.2 Pitch Estimation Module

Update: `supabase/functions/_shared/shadow-pitch-analyzer.ts`

**Pitch detection methods (priority order):**
1. Solar API segments (if available) - ground truth
2. Shadow analysis (sun angle + shadow length)
3. ML model prediction per facet
4. User override
5. Default regional assumption (6/12 for Florida)

---

## Phase 5: Measurement Calculation Engine

### 5.1 Unified Calculation Pipeline

Update: `supabase/functions/_shared/roofWorksheetEngine.ts`

**Existing capabilities (already robust):**
- `parsePitch()` - Parse pitch strings to slope factor
- `calculatePlanArea()` - Shape-based area with formulas
- `calculateSurfaceArea()` - Apply pitch multiplier
- `sumLinearSegments()` - Total linear features by type
- `recommendWaste()` - Complexity-based waste factor
- `calculateOrder()` - Material quantities
- `runQCChecks()` - Validation suite

**New additions:**
- `calculateFacetFromPolygon()` - WKT polygon to facet with area
- `calculateLinearFromWKT()` - WKT linestring to length in feet
- `aggregateFacetTotals()` - Sum all facets with breakdown

### 5.2 Coordinate Transformation

Update: `supabase/functions/_shared/geometry-validator.ts`

**Enhancements:**
- Haversine distance for WKT coordinate pairs
- Pixel-to-GPS transformation with image bounds
- GPS-to-pixel for overlay rendering
- Area calculation via Shoelace formula on GPS coordinates

---

## Phase 6: Roof Diagram Generation

### 6.1 Satellite Overlay Diagram

Create: `supabase/functions/generate-roof-overlay/index.ts`

**Output 1 - Annotated satellite image:**
- Render detected polygon on satellite image
- Color-coded linear features (ridge=green, hip=purple, valley=red, eave=cyan, rake=orange)
- Length labels on each segment
- Facet numbers in polygon centers
- North arrow indicator
- Save to Supabase Storage, return URL

### 6.2 Clean Vector Diagram

Update: `src/components/measurements/SchematicRoofDiagram.tsx`

**Output 2 - Professional schematic:**
- SVG rendering of facet polygons
- Color-coded by pitch or facet ID
- Indexed labels matching PDF table
- Compass rose for orientation
- Dimensions in feet on each segment

### 6.3 Diagram Data Structure

```typescript
interface RoofDiagramData {
  facets: Array<{
    id: string;
    polygon_wkt: string;
    plan_area_sqft: number;
    surface_area_sqft: number;
    pitch: string;
    orientation: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
    color: string;
  }>;
  linear_features: Array<{
    id: string;
    type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
    wkt: string;
    length_ft: number;
    label: string;
    color: string;
  }>;
  bounds: { minLat, maxLat, minLng, maxLng };
  center: { lat, lng };
  satellite_url: string;
  overlay_url: string;
}
```

---

## Phase 7: Automated PDF Report Generation

### 7.1 Report Template Structure

Update: `supabase/functions/generate-roofr-style-report/index.ts`

**7-Page Report Format (matching EagleView/Roofr quality):**

| Page | Title | Content |
|------|-------|---------|
| 1 | Cover | Company logo, address, key stats (area, facets, pitch), satellite image with overlay |
| 2 | Roof Diagram | Clean vector schematic with north arrow, legend, facet numbers |
| 3 | Length Measurements | Color-coded linear boxes + table (eave, rake, ridge, hip, valley totals) |
| 4 | Area Measurements | Per-facet breakdown table, total pitched/flat area, waste table |
| 5 | Pitch & Direction | Facet-by-pitch breakdown, orientation compass diagram |
| 6 | Materials Summary | Shingle bundles, starter, ice/water, underlayment, ridge cap, drip edge |
| 7 | Terms & Disclaimer | Accuracy disclaimer, measurement methodology, company contact |

### 7.2 PDF Generation via Puppeteer

**Current flow (working):**
1. Generate HTML with inline CSS
2. Call `smart-docs-pdf` edge function (uses Puppeteer)
3. Upload PDF to `measurement-reports` storage bucket
4. Return signed URL

**Enhancements:**
- Embed actual satellite overlay image (base64)
- Embed vector diagram SVG inline
- Improve print margins and page breaks
- Add branded header/footer on each page

---

## Phase 8: CRM Integration & Data Persistence

### 8.1 Database Schema Updates

The `roof_measurements` table already has comprehensive columns. Verify and add if missing:

| Column | Type | Purpose |
|--------|------|---------|
| `facets_json` | JSONB | Per-facet polygon/area/pitch data |
| `satellite_overlay_url` | TEXT | URL to annotated satellite image |
| `vector_diagram_svg` | TEXT | Inline SVG for clean diagram |
| `pdf_report_url` | TEXT | URL to generated PDF |
| `measurement_method` | TEXT | 'ai_segmentation' or 'solar_api' or 'manual' |
| `segmentation_model` | TEXT | Model version used |

### 8.2 Measurement Saving Flow

Update: `supabase/functions/analyze-roof-aerial/index.ts`

After successful analysis:
1. Save complete measurement to `roof_measurements`
2. Generate and save overlay image
3. Generate and save PDF report
4. Update `documents` table with PDF link
5. Trigger automation: `MEASUREMENT_COMPLETED`
6. Return measurement ID to frontend

### 8.3 Frontend Integration

Update: `src/components/measurements/PullMeasurementsButton.tsx`

**Flow:**
1. User clicks "AI Measurement"
2. Structure selector opens (existing)
3. User confirms PIN location
4. Show progress toast: "Analyzing satellite imagery..."
5. Call `analyze-roof-aerial` with coordinates
6. On success, open `RoofrStyleReportPreview` with PDF
7. Auto-invalidate measurement caches for UI refresh

---

## Phase 9: Manual Measurement Fallback

### 9.1 Unified Manual Editor

Update: `src/components/measurements/ManualMeasurementEditor.tsx`

**Enhancements:**
- Use same satellite image as AI analysis
- Snap drawing to common angles (0°, 45°, 90°)
- Auto-close polygon on near-starting-point click
- Interior line drawing tools (ridge, valley, hip)
- Real-time area/length calculations using worksheet engine
- Same PDF report generation as AI measurements

### 9.2 Override Flow

1. User reviews AI measurement in `RoofrStyleReportPreview`
2. Clicks "Edit Measurement" button
3. Opens manual editor with AI-detected geometry pre-loaded
4. User adjusts vertices/lines
5. Save triggers re-calculation and new PDF

---

## Phase 10: Consolidation & Cleanup

### 10.1 Code Path Simplification

**Remove redundant pathways:**
- Eliminate "Solar Fast Path vs AI Analysis" toggle in favor of unified pipeline
- Deprecate direct OpenAI/GPT-4 Vision calls (replace with Gemini or external ML)
- Remove `forceFullAnalysis` flag - always run full pipeline
- Consolidate `analyze-roof-aerial` and `measure` into single orchestrator

### 10.2 Unified Entry Point

Refactor: `supabase/functions/analyze-roof-aerial/index.ts`

**Simplified flow:**
```text
1. fetchSatelliteImage(lat, lng) 
   -> Enhanced image at 2560px
   
2. preprocessImage(image)
   -> Shadow removal, edge enhancement
   
3. segmentRoof(preprocessedImage)
   -> ML-based polygon extraction
   
4. classifyFeatures(footprint, facets)
   -> Ridge/hip/valley/eave/rake classification
   
5. calculateMeasurements(features, pitch)
   -> Worksheet engine calculations
   
6. generateDiagrams(measurements, satellite)
   -> Overlay + vector diagrams
   
7. generatePDFReport(measurements, diagrams, companyInfo)
   -> Professional multi-page PDF
   
8. saveMeasurement(all_data)
   -> Persist to database
   
9. return { measurementId, pdfUrl, success }
```

---

## Dependencies & External Services

### Required API Keys (already configured)
- `GOOGLE_MAPS_API_KEY` - Static Maps API
- `GOOGLE_SOLAR_API_KEY` - Solar API for pitch/segments
- `MAPBOX_PUBLIC_TOKEN` - Mapbox satellite fallback
- `LOVABLE_API_KEY` - Gemini 2.5 access via Lovable gateway

### New Dependencies (optional, for enhanced ML)
- Replicate API for Segment Anything Model (SAM)
- Hugging Face Inference for custom U-Net
- Sharp.js for image preprocessing (included in Deno)

### Storage Requirements
- Supabase Storage bucket: `measurement-reports` (existing)
- New bucket: `satellite-imagery` for cached images
- New bucket: `roof-overlays` for annotated images

---

## Testing & Validation Plan

### 10.1 Test Panel Updates

Update: `src/components/measurements/MeasurementTestPanel.tsx`

**Test cases:**
- Simple gable roof (4 facets, 1 ridge)
- Complex hip roof (4 facets, 4 hips)
- L-shaped with valley (6+ facets)
- Multi-structure property (2+ buildings)
- Steep pitch (10/12+)
- Flat commercial roof

### 10.2 Accuracy Targets

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| Total Area | ±2% | Compare to EagleView report |
| Linear Measurements | ±6 inches | Compare to professional reports |
| Pitch Detection | ±1° | Solar API ground truth |
| PDF Generation | <5 seconds | Performance monitoring |
| End-to-End | <15 seconds | Stopwatch from click to PDF |

---

## Implementation Timeline

| Phase | Duration | Priority |
|-------|----------|----------|
| Phase 1: Image Acquisition | 1 week | High |
| Phase 2: Preprocessing | 3 days | High |
| Phase 3: ML Segmentation | 2 weeks | High |
| Phase 4: Feature Classification | 1 week | High |
| Phase 5: Calculation Engine | 3 days | Medium |
| Phase 6: Diagram Generation | 1 week | High |
| Phase 7: PDF Report | 1 week | High |
| Phase 8: CRM Integration | 3 days | Medium |
| Phase 9: Manual Fallback | 1 week | Medium |
| Phase 10: Cleanup | 3 days | Low |

**Total Estimated Duration: 6-8 weeks**

---

## Success Criteria

1. Single "AI Measurement" button produces complete PDF report
2. Per-facet area breakdown with polygon visualization
3. Accurate linear feature totals (ridge, hip, valley, eave, rake)
4. Professional diagram matching Roofr/EagleView quality
5. <15 second end-to-end processing time
6. 98%+ accuracy vs professional vendor reports
7. Manual edit capability for corrections
8. Automatic CRM updates and estimate population

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| ML model accuracy | Start with enhanced Gemini, add external model incrementally |
| API costs | Implement caching, batch processing |
| Processing timeout | Increase wall_clock_limit, implement streaming updates |
| Large buildings | Tile stitching for properties >10,000 sqft |
| Image quality | Shadow mitigation, multiple imagery sources |

---

## Technical Notes

### Files to Create
- `supabase/functions/_shared/satellite-image-fetcher.ts`
- `supabase/functions/_shared/image-preprocessor.ts`
- `supabase/functions/roof-segmentation/index.ts`

### Files to Update
- `supabase/functions/analyze-roof-aerial/index.ts` (refactor to unified flow)
- `supabase/functions/generate-roofr-style-report/index.ts` (add overlay embedding)
- `supabase/functions/_shared/roof-geometry-reconstructor.ts` (feature classification)
- `supabase/functions/_shared/interior-line-detector.ts` (enhanced prompts)
- `src/components/measurements/SchematicRoofDiagram.tsx` (vector diagram)
- `src/components/measurements/PullMeasurementsButton.tsx` (progress UI)
- `src/components/measurements/ManualMeasurementEditor.tsx` (override flow)

### Database Migrations
- Add columns to `roof_measurements`: `facets_json`, `satellite_overlay_url`, `vector_diagram_svg`
- Create storage bucket: `satellite-imagery` (private)
- Create storage bucket: `roof-overlays` (public)
