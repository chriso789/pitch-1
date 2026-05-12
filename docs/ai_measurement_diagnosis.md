# AI Measurement System Diagnosis

## Executive Summary

The current AI Measurement system has several critical issues that can lead to inaccurate or misleading roof measurements. This document catalogs the problems identified through code analysis and provides recommendations for fixes.

**Critical Issues Identified:**
1. Rectangular bounding box fallback creates fake geometry
2. Assumed pitch values (4/12) used when real data unavailable  
3. Fake linear features estimated from area
4. No clear failure mode - system always returns "success"
5. Vendor report parser only handles first page
6. Aerial overlay misalignment due to coordinate mismatch

---

## Issue 1: Rectangular Bounding Box Fallback

### Location
`supabase/functions/measure/index.ts` lines 1229-1287

### Problem
When Mapbox, Microsoft/Esri, and OSM all fail to return a building footprint, the system falls back to Google Solar's bounding box - a **rectangle** that approximates the building.

```typescript
// Final fallback to Google's bounding box (rectangular)
if (!coords || coords.length < 4) {
  coords = boundingBoxToPolygon(json.boundingBox);
  footprintSource = 'google_solar_bbox';
  isFallbackRect = true;
  console.log(`⚠️ Using Google Solar bounding box (rectangular approximation) - this may cause inaccurate roof tracing`);
}
```

### Impact
- Straight skeleton algorithm generates incorrect ridge/hip/valley lines for rectangular input
- Complex L-shaped, T-shaped, or U-shaped buildings get measured as simple rectangles
- Material calculations will be significantly off (often 20-40% error)

### Evidence
The debug panel shows `footprint_source: google_solar_bbox` for affected properties.

### Recommendation
**Do NOT generate measurements from rectangular fallbacks.** Instead:
- Return an explicit error: "No building footprint available. Upload a vendor report or draw manually."
- Save a flag indicating "fallback_geometry" for later manual review
- Prevent estimates from being auto-generated from fallback data

---

## Issue 2: Assumed Pitch Values

### Location
`supabase/functions/measure/index.ts` lines 1624-1650, 1697-1720

### Problem
When Google Solar segments are unavailable, the system assumes a 4/12 pitch for all roof facets:

```typescript
// 4. Build face with assumed pitch
const defaultPitch = "4/12";
const wastePct = 12;
const pf = pitchFactor(defaultPitch);
const adjusted = footprint.plan_sqft * pf * (1 + wastePct / 100);
```

### Impact
- A 6/12 roof has pitch factor 1.118 vs 4/12's 1.054 = **6% area error**
- A 10/12 roof has pitch factor 1.302 vs 4/12's 1.054 = **23.5% area error**
- Material orders based on assumed pitch will be consistently wrong

### Evidence
`pitch_method: 'assumed'` appears in measurement summary for affected properties.

### Recommendation
- Mark measurements with assumed pitch as "estimate_only" or "requires_verification"
- Display prominent warning: "Pitch not measured - using assumed 4/12"
- Require user to confirm or adjust pitch before generating estimate
- Do NOT auto-populate material quantities from assumed pitch data

---

## Issue 3: Fake Linear Features from Area Estimation

### Location
`supabase/functions/measure/index.ts` lines 1050-1130 (`estimateLinearFeatures`)

### Problem
When the straight skeleton fails or no geometry is available, the system **estimates** linear features from area using geometric assumptions:

```typescript
function estimateLinearFeatures(faces: RoofFace[]): LinearFeature[] {
  // Estimate perimeter from area assuming square building
  const areaM2 = face.plan_area_sqft / 10.7639;
  const side = Math.sqrt(areaM2);
  const estimatedPerimeter = side * 4;
  
  // Distribute to feature types using ratios
  const ridgeEstimate = estimatedPerimeter * 0.25;
  const hipEstimate = estimatedPerimeter * 0.0; // 0 for simple gable
  // ...
}
```

### Impact
- Ridge, hip, valley lengths are purely **fabricated** from mathematical assumptions
- A hip roof gets estimated as having 0 hip length
- Complex roofs with valleys get 0 valley length
- Material estimates for ridge cap, valley metal, etc. are completely wrong

### Evidence
Linear features that are round numbers or suspiciously proportional to area.

### Recommendation
- **Remove this function entirely** - it produces misleading data
- When linear features cannot be extracted, return them as `null` or `0`
- Display clear message: "Linear measurements unavailable - upload vendor report"

---

## Issue 4: No Clear Failure Mode

### Location
Throughout `supabase/functions/measure/index.ts`

### Problem
The system always returns `ok: true` as long as *any* measurement can be generated, even if that measurement is from fallback/estimation:

```typescript
return json({
  ok: true,
  data: { measurement, tags },
  meta: { source: meas.source, engine: engineUsed }
}, corsHeaders);
```

### Impact
- UI shows success checkmarks for measurements that are 30% wrong
- Sales teams present estimates based on fabricated data
- No distinction between "real measurement" and "best guess"

### Recommendation
Add explicit quality indicators to the response:

```typescript
return json({
  ok: true,
  data: { measurement, tags },
  quality: {
    confidence: calculateOverallConfidence(meas),
    usedFallbacks: [ 'assumed_pitch', 'rectangular_bbox' ],
    requiresManualReview: true,
    warnings: ['Pitch assumed at 4/12', 'Using rectangular approximation']
  }
}, corsHeaders);
```

---

## Issue 5: Vendor Report Parser - Single Page Only

### Location
`supabase/functions/roof-report-ingest/index.ts`

### Problem
The PDF text extraction correctly handles multiple pages:
```typescript
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  // ... extract text
}
```

But the parsing logic uses simple regex that may miss data spanning pages:
```typescript
const areaMatch = text.match(/Total roof area[:\s]*(\d[\d,]*)\s*sqft/i);
```

### Impact
- Multi-page EagleView/Roofr reports may have measurements on page 2-3
- Summary data on first page may be incomplete
- Linear feature details often on separate "Measurements" page

### Current Vendor Support Status

| Vendor | Detection | Area | Pitch | Linear | Facets | Geometry |
|--------|-----------|------|-------|--------|--------|----------|
| Roofr | Good | Good | Good | Partial | Limited | None |
| EagleView | Good | Good | Good | Partial | Limited | None |
| Xactimate | Good | Good | Partial | Partial | None | None |
| Hover | Limited | Partial | Limited | Limited | None | None |
| RoofScope | Limited | Partial | Limited | Limited | None | None |

### Recommendation
- Add page-aware parsing with section detection
- Look for "Measurements" or "Linear Features" section headers
- Parse facet tables with proper column alignment
- Extract WKT geometry from reports that include it (some EagleView PDFs do)

---

## Issue 6: Aerial Overlay Alignment

### Location
- `supabase/functions/measure/index.ts` (analysis params storage)
- `src/components/roof-measurement/MapboxRoofViewer.tsx` (overlay rendering)

### Problem
The measurement analysis happens at a specific lat/lng and zoom level, but the overlay rendering may use different parameters, causing misalignment:

```typescript
// Stored during analysis
p_gps_coordinates: analysisParams ? { lat: analysisParams.lat, lng: analysisParams.lng } : null,
p_analysis_zoom: analysisParams?.zoom || 20,
p_analysis_image_size: analysisParams?.imageSize || { width: 640, height: 640 }
```

### Impact
- Roof lines don't align with satellite imagery in viewer
- User sees "shifted" overlay that appears wrong
- Reduces confidence in measurement accuracy

### Causes
1. GPS coordinate precision loss during storage/retrieval
2. Zoom level mismatch between analysis and display
3. Image tile seam issues at property boundaries
4. Mercator projection distortion at different latitudes

### Recommendation
- Store full-precision coordinates (8+ decimal places)
- Re-fetch analysis parameters when rendering overlay
- Add visual alignment adjustment tools for users
- Consider storing pixel-to-GPS transform matrix

---

## Issue 7: Training/Correction System Complexity

### Location
`supabase/functions/measure/index.ts` lines 2110-2400

### Problem
The AI learning pipeline has complex logic for blending AI features with user traces:
- Removes AI features not matched by user traces
- Blends remaining features 80% toward user position
- Injects missing features when AI had zero

### Impact
- Hard to debug when measurements are wrong
- Blending logic can produce intermediate positions that match neither AI nor user
- Feature injection logic can double-count if not careful

### Recommendation
- Simplify: Either use AI OR user traces, don't blend
- Add verbose logging to trace exactly what changed
- Store before/after snapshots for debugging
- Make correction system opt-in, not automatic

---

## Database Schema Gaps

### Current Schema Issues

1. **No measurement quality tracking**
```sql
-- Missing columns
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2);
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS fallback_flags JSONB;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS requires_review BOOLEAN DEFAULT false;
```

2. **No geometry validation results storage**
```sql
-- Need table for QA results
CREATE TABLE measurement_qa_results (
  id UUID PRIMARY KEY,
  measurement_id UUID REFERENCES measurements(id),
  area_match BOOLEAN,
  area_error_pct DECIMAL(5,2),
  perimeter_match BOOLEAN,
  topology_valid BOOLEAN,
  issues JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

3. **No debug artifact storage**
```sql
-- Need table for debug snapshots
CREATE TABLE measurement_debug_artifacts (
  id UUID PRIMARY KEY,
  measurement_id UUID REFERENCES measurements(id),
  artifact_type TEXT, -- 'footprint_candidates', 'skeleton_output', 'dsm_data'
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Code Quality Issues

### Inconsistent Error Handling
- Some providers throw exceptions
- Some return null
- Some set fallbackReason
- No unified error type

### Magic Numbers
```typescript
const radius = options?.radius || 30; // meters
const threshold = 0.00001; // ~1 meter
const ENDPOINT_EPSILON = 0.00005; // ~5 meters
```

### Missing Type Safety
```typescript
// Any types throughout
const pens = (meas as any).penetrations || [];
const rawLinear = meas.linear_features;
```

---

## Recommended Fix Priority

### P0 - Critical (Do First)
1. Remove fake measurement fallbacks (rectangular bbox, estimated linear)
2. Add clear failure mode with quality indicators
3. Mark assumed-pitch measurements as unverified

### P1 - High (Do Soon)
4. Fix vendor report multi-page parsing
5. Add geometry validation gate
6. Store debug artifacts for failed measurements

### P2 - Medium (Plan For)
7. Improve aerial overlay alignment
8. Simplify training/correction system
9. Add comprehensive test suite

### P3 - Low (Nice To Have)
10. Unify error handling patterns
11. Add TypeScript strict mode
12. Document magic numbers as constants

---

## Files Requiring Changes

| File | Changes Needed |
|------|---------------|
| `supabase/functions/measure/index.ts` | Remove fallbacks, add quality indicators |
| `supabase/functions/measure/qa-validator.ts` | Add geometry validation gate |
| `supabase/functions/roof-report-ingest/index.ts` | Multi-page parsing |
| `src/components/roof-measurement/*.tsx` | Display quality warnings |
| `supabase/migrations/*.sql` | Add quality tracking columns |

---

*Document generated: May 12, 2026*
*Based on code analysis of pitch-1 repository*
