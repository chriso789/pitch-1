
# Plan: Unified Roof Outline Tracing and Measurement Pipeline

## Overview

This plan unifies the existing measurement components into a single, coherent pipeline that traces roof outlines from high-resolution aerial images, derives roof lines, labels perimeter edges, and computes accurate areas. The key insight from analyzing the codebase is that all the necessary building blocks already exist but are scattered across multiple edge functions with redundant logic.

## Current State Analysis

### Existing Components (Already Built)

| Component | Location | Status |
|-----------|----------|--------|
| **Footprint Sources** | `analyze-roof-aerial/index.ts` (lines 277-540) | Mapbox, Microsoft, OSM, Regrid, Solar bbox - all working |
| **Straight Skeleton** | `measure/straight-skeleton.ts` | Generates ridges, hips, valleys from footprint |
| **Eave/Rake Classification** | `measure/gable-detector.ts` | `classifyBoundaryEdges()` uses ridge direction |
| **Solar Segment Analysis** | `_shared/roof-analysis-helpers.ts` | `analyzeSegmentOrientation()` for ridge direction |
| **Facet Splitting** | `measure/facet-splitter.ts` | `splitFootprintIntoFacets()` creates roof planes |
| **QA Validation** | `measure/qa-validator.ts` | PLANIMETER_THRESHOLDS, topological checks |
| **Coordinate Conversion** | `_shared/roof-analysis-helpers.ts` | `pixelToGeo()`, `geoToPixel()` |
| **Worksheet Engine** | `_shared/roofWorksheetEngine.ts` | Authoritative calculations with formulas |

### Current Issues Identified

1. **Duplicate Logic**: `analyze-roof-aerial` and `measure` functions both contain footprint fetching and skeleton generation code
2. **Inconsistent Footprint Validation**: PLANIMETER_THRESHOLDS defined in `roof-analysis-helpers.ts` but not consistently applied during footprint selection
3. **Ridge Direction Sources**: Solar API orientation and skeleton-derived ridges can conflict; no clear priority order
4. **Incomplete Integration**: The `measure` function has the cleanest topology pipeline but doesn't consistently use all footprint sources
5. **Area Calculation Fragmentation**: Shoelace formula appears in 5+ places with slight variations

---

## Unified Pipeline Architecture

```text
+------------------+     +--------------------+     +----------------------+
|  1. IMAGERY      | --> |  2. FOOTPRINT      | --> |  3. SKELETON         |
|  - Mapbox sat    |     |  - Mapbox vector   |     |  - Straight skeleton |
|  - Google Static |     |  - Microsoft/Esri  |     |  - Ridge extraction  |
|  - Zoom 20       |     |  - OSM Overpass    |     |  - Hip/valley gen    |
|  - North-up      |     |  - Regrid (paid)   |     +----------+-----------+
+------------------+     |  - Solar bbox      |                |
                         |  + Validation      |                v
                         +--------------------+     +----------------------+
                                                    |  4. SOLAR MERGE      |
+------------------+     +--------------------+     |  - Segment azimuths  |
|  8. PERSIST      | <-- |  7. REPORT         |     |  - Ridge direction   |
|  - roof_measure  |     |  - Area totals     |     |  - Override priority |
|  - linear_feat   |     |  - Linear lengths  |     +----------+-----------+
|  - qa_metrics    |     |  - Waste calc      |                |
+------------------+     |  - QA flags        |                v
                         +--------------------+     +----------------------+
          ^                                         |  5. EDGE CLASSIFY    |
          |              +--------------------+     |  - Eave: parallel    |
          +------------- |  6. FACET SPLIT    | <-- |  - Rake: perpen.     |
                         |  - Extend lines    |     |  - Hip corners       |
                         |  - Polygon split   |     +----------------------+
                         |  - Shoelace area   |
                         +--------------------+
```

---

## Technical Implementation

### Step 1: Create Unified Footprint Resolver

**File**: `supabase/functions/_shared/footprint-resolver.ts`

Consolidates all footprint fetching logic with consistent validation.

```typescript
// Interfaces
export interface ResolvedFootprint {
  vertices: Array<{ lat: number; lng: number }>;
  source: FootprintSource;
  confidence: number;
  validation: ValidationResult;
  qaMetrics: {
    spanXPct: number;
    spanYPct: number;
    vertexCount: number;
    longestSegmentFt: number;
    expectedMinVertices: number;
  };
}

export interface FootprintResolverOptions {
  lat: number;
  lng: number;
  solarData?: SolarAPIData;
  mapboxToken: string;
  regridApiKey?: string;
  enableAIFallback?: boolean;
  imageUrl?: string;
}

// Main function - tries sources in priority order
export async function resolveFootprint(options: FootprintResolverOptions): Promise<ResolvedFootprint | null> {
  const candidates: ResolvedFootprint[] = [];
  
  // 1. Mapbox Vector (highest fidelity)
  const mapbox = await tryMapboxVector(options);
  if (mapbox) candidates.push(mapbox);
  
  // 2. Microsoft/Esri (FREE, 92% accuracy)
  const microsoft = await tryMicrosoftBuildings(options);
  if (microsoft) candidates.push(microsoft);
  
  // 3. OSM Overpass (FREE)
  const osm = await tryOSMBuildings(options);
  if (osm) candidates.push(osm);
  
  // 4. Regrid (PAID - only if free sources fail)
  if (candidates.length === 0 && options.regridApiKey) {
    const regrid = await tryRegridParcel(options);
    if (regrid) candidates.push(regrid);
  }
  
  // Select best candidate using PLANIMETER_THRESHOLDS
  const best = selectBestCandidate(candidates, options.solarData);
  
  // 5. Solar bbox as last resort
  if (!best && options.solarData?.boundingBox) {
    return createSolarBboxFallback(options.solarData);
  }
  
  return best;
}

// Validation against PLANIMETER_THRESHOLDS
function validateCandidate(footprint: ResolvedFootprint, solarData?: SolarAPIData): boolean {
  const { vertices } = footprint;
  const perimeterFt = calculatePerimeterFt(vertices);
  
  // MIN_SPAN_PCT check
  const bounds = getBounds(vertices);
  // ... calculate span percentage
  
  // MAX_SEGMENT_LENGTH_FT check
  const maxSegment = findLongestSegment(vertices);
  if (maxSegment > PLANIMETER_THRESHOLDS.MAX_SEGMENT_LENGTH_FT) {
    return false; // Likely missing corners
  }
  
  // MIN_VERTICES_PER_100FT check
  const expectedMin = Math.ceil(perimeterFt * PLANIMETER_THRESHOLDS.MIN_VERTICES_PER_100FT / 100);
  if (vertices.length < expectedMin) {
    return false;
  }
  
  // RE_DETECT_THRESHOLD against Solar perimeter
  if (solarData?.estimatedPerimeterFt) {
    const ratio = perimeterFt / solarData.estimatedPerimeterFt;
    if (ratio < PLANIMETER_THRESHOLDS.RE_DETECT_THRESHOLD) {
      return false;
    }
  }
  
  return true;
}
```

### Step 2: Create Unified Roof Topology Builder

**File**: `supabase/functions/_shared/roof-topology-builder.ts`

Combines skeleton generation with Solar orientation analysis.

```typescript
export interface RoofTopology {
  footprintCoords: XY[]; // Expanded for overhang
  skeleton: SkeletonEdge[];
  ridgeDirection: XY; // Normalized direction vector
  ridgeSource: 'solar_segments' | 'skeleton_derived' | 'manual_override';
  boundaryClassification: BoundaryClassification;
  isComplexShape: boolean;
  warnings: string[];
}

export interface RoofTopologyOptions {
  footprint: ResolvedFootprint;
  solarSegments?: SolarSegment[];
  manualRidgeOverride?: { start: XY; end: XY };
  eaveOffsetFt?: number; // Default 1.0ft
}

export function buildRoofTopology(options: RoofTopologyOptions): RoofTopology {
  const { footprint, solarSegments, manualRidgeOverride, eaveOffsetFt = 1.0 } = options;
  const warnings: string[] = [];
  
  // 1. Convert to coordinate array and expand for overhang
  const coords = vertexArrayToXY(footprint.vertices);
  const expandedCoords = expandFootprintForOverhang(coords, eaveOffsetFt);
  
  // 2. Compute straight skeleton
  const skeleton = computeStraightSkeleton(expandedCoords);
  
  // 3. Determine ridge direction - PRIORITY ORDER:
  //    a) Manual override (from user trace)
  //    b) Solar segment analysis (high confidence)
  //    c) Skeleton-derived (fallback)
  let ridgeDirection: XY;
  let ridgeSource: RoofTopology['ridgeSource'];
  
  if (manualRidgeOverride) {
    ridgeDirection = normalizeVector([
      manualRidgeOverride.end[0] - manualRidgeOverride.start[0],
      manualRidgeOverride.end[1] - manualRidgeOverride.start[1]
    ]);
    ridgeSource = 'manual_override';
    
  } else if (solarSegments && solarSegments.length >= 2) {
    const solarOrientation = analyzeSegmentOrientation(solarSegments);
    
    if (solarOrientation.confidence >= 0.7) {
      // Use Solar-derived ridge direction
      ridgeDirection = solarOrientation.primaryRidgeDirection === 'east-west' 
        ? [1, 0]  // East-West ridge
        : [0, 1]; // North-South ridge
      ridgeSource = 'solar_segments';
      
      // Merge with skeleton if multi-ridge detected
      if (solarOrientation.hasMultipleRidges) {
        warnings.push('Multiple ridge directions detected - complex footprint');
      }
    } else {
      ridgeDirection = getRidgeDirectionFromSkeleton(skeleton);
      ridgeSource = 'skeleton_derived';
    }
  } else {
    ridgeDirection = getRidgeDirectionFromSkeleton(skeleton);
    ridgeSource = 'skeleton_derived';
  }
  
  // 4. Classify boundary edges (eave vs rake)
  const boundaryClassification = classifyBoundaryEdges(
    expandedCoords, 
    skeleton, 
    manualRidgeOverride
  );
  
  // 5. Detect complex shapes
  const reflexCount = countReflexVertices(expandedCoords);
  const isComplexShape = expandedCoords.length > 6 || reflexCount > 0;
  
  return {
    footprintCoords: expandedCoords,
    skeleton,
    ridgeDirection,
    ridgeSource,
    boundaryClassification,
    isComplexShape,
    warnings
  };
}
```

### Step 3: Create Unified Facet Splitter

**File**: `supabase/functions/_shared/facet-area-calculator.ts`

Uses skeleton lines to split footprint into facets with area calculations.

```typescript
export interface ComputedFacet {
  id: string;
  polygon: XY[];
  planAreaSqft: number;
  slopedAreaSqft: number;
  pitch: string;
  pitchDegrees: number;
  azimuthDegrees: number;
  direction: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
}

export interface AreaCalculationResult {
  facets: ComputedFacet[];
  totals: {
    planAreaSqft: number;
    slopedAreaSqft: number;
    squares: number; // slopedArea / 100
    predominantPitch: string;
  };
  linearTotals: {
    ridgeFt: number;
    hipFt: number;
    valleyFt: number;
    eaveFt: number;
    rakeFt: number;
    perimeterFt: number;
  };
  calculationMethod: string;
}

export function computeFacetsAndAreas(
  topology: RoofTopology,
  solarSegments?: SolarSegment[],
  predominantPitch?: string
): AreaCalculationResult {
  
  // 1. Extend ridge/hip lines to intersect footprint boundary
  const extendedLines = extendSkeletonLinesToBoundary(
    topology.skeleton,
    topology.footprintCoords
  );
  
  // 2. Split footprint polygon using extended lines
  const facetPolygons = splitPolygonByLines(
    topology.footprintCoords,
    extendedLines
  );
  
  // 3. Assign pitch/azimuth to each facet
  const facets: ComputedFacet[] = facetPolygons.map((polygon, index) => {
    const facetCentroid = getCentroid(polygon);
    
    // Find matching Solar segment by centroid proximity
    const matchedSegment = findNearestSolarSegment(facetCentroid, solarSegments);
    
    const pitchDegrees = matchedSegment?.pitchDegrees || pitchStringToDegrees(predominantPitch || '6/12');
    const pitch = matchedSegment ? degreesToPitchRatio(matchedSegment.pitchDegrees) : (predominantPitch || '6/12');
    const azimuth = matchedSegment?.azimuthDegrees || estimateAzimuthFromPosition(facetCentroid, topology);
    
    // Calculate plan area using Shoelace formula
    const planAreaSqft = calculatePolygonAreaSqft(polygon);
    
    // Calculate sloped area: plan_area * slope_factor
    const slopeFactor = getSlopeFactorFromPitch(pitch);
    const slopedAreaSqft = planAreaSqft * slopeFactor;
    
    return {
      id: String.fromCharCode(65 + index), // A, B, C, ...
      polygon,
      planAreaSqft,
      slopedAreaSqft,
      pitch,
      pitchDegrees,
      azimuthDegrees: azimuth,
      direction: getCardinalDirection(azimuth)
    };
  });
  
  // 4. Calculate totals
  const planAreaSqft = facets.reduce((sum, f) => sum + f.planAreaSqft, 0);
  const slopedAreaSqft = facets.reduce((sum, f) => sum + f.slopedAreaSqft, 0);
  
  // 5. Calculate linear feature totals from topology
  const linearTotals = calculateLinearTotals(topology);
  
  return {
    facets,
    totals: {
      planAreaSqft,
      slopedAreaSqft,
      squares: slopedAreaSqft / 100,
      predominantPitch: findPredominantPitch(facets)
    },
    linearTotals,
    calculationMethod: `skeleton_split_${topology.ridgeSource}`
  };
}
```

### Step 4: Create Unified QA Gate

**File**: `supabase/functions/_shared/measurement-qa-gate.ts`

Consolidates all quality checks before persistence.

```typescript
export interface QAGateResult {
  passed: boolean;
  overallScore: number; // 0-1
  checks: {
    areaWithinTolerance: boolean;
    perimeterWithinTolerance: boolean;
    noFloatingEndpoints: boolean;
    noCrossingHips: boolean;
    ridgeLengthReasonable: boolean;
    facetsClosed: boolean;
  };
  warnings: string[];
  errors: string[];
  requiresManualReview: boolean;
}

export function runQAGate(
  topology: RoofTopology,
  areaResult: AreaCalculationResult,
  solarData?: SolarAPIData
): QAGateResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let score = 1.0;
  
  // Check 1: Area within ±3% of Solar (if available)
  if (solarData?.buildingFootprintSqft) {
    const diff = Math.abs(areaResult.totals.planAreaSqft - solarData.buildingFootprintSqft);
    const pct = diff / solarData.buildingFootprintSqft;
    if (pct > PLANIMETER_THRESHOLDS.AREA_TOLERANCE) {
      errors.push(`Area differs from Solar by ${(pct * 100).toFixed(1)}%`);
      score -= 0.2;
    }
  }
  
  // Check 2: Perimeter match (eave+rake = footprint perimeter ±1%)
  const footprintPerimeter = calculatePerimeterFt(topology.footprintCoords);
  const classifiedPerimeter = areaResult.linearTotals.eaveFt + areaResult.linearTotals.rakeFt;
  const perimeterDiff = Math.abs(classifiedPerimeter - footprintPerimeter) / footprintPerimeter;
  if (perimeterDiff > 0.01) {
    warnings.push(`Perimeter mismatch: ${(perimeterDiff * 100).toFixed(1)}%`);
    score -= 0.1;
  }
  
  // Check 3: No floating endpoints
  const floatingEndpoints = findFloatingEndpoints(topology.skeleton, topology.footprintCoords);
  if (floatingEndpoints.length > 0) {
    errors.push(`${floatingEndpoints.length} floating endpoint(s)`);
    score -= 0.15;
  }
  
  // Check 4: No crossing hips
  const hipCrossings = checkForEdgeCrossings(topology.skeleton.filter(e => e.type === 'hip'));
  if (hipCrossings > 0) {
    errors.push(`${hipCrossings} hip crossing(s) - geometrically impossible`);
    score -= 0.25;
  }
  
  // Check 5: Ridge length sanity
  const maxDimension = getMaxBuildingDimension(topology.footprintCoords);
  if (areaResult.linearTotals.ridgeFt > maxDimension * 2) {
    errors.push('Ridge length exceeds 200% of building dimension');
    score -= 0.2;
  }
  
  return {
    passed: errors.length === 0,
    overallScore: Math.max(0, score),
    checks: {
      areaWithinTolerance: !errors.some(e => e.includes('Area differs')),
      perimeterWithinTolerance: perimeterDiff <= 0.01,
      noFloatingEndpoints: floatingEndpoints.length === 0,
      noCrossingHips: hipCrossings === 0,
      ridgeLengthReasonable: areaResult.linearTotals.ridgeFt <= maxDimension * 2,
      facetsClosed: true // Checked during facet generation
    },
    warnings,
    errors,
    requiresManualReview: errors.length > 0 || score < 0.7
  };
}
```

### Step 5: Refactor Main Measure Function

**File**: `supabase/functions/measure/index.ts` (Refactored)

Replace the scattered logic with unified pipeline calls.

```typescript
// Main handler
Deno.serve(async (req) => {
  const { property_id, lat, lng, address, pitch_override } = await req.json();
  
  // STEP 1: Fetch satellite imagery
  const imagery = await Promise.all([
    fetchMapboxSatellite(lat, lng, MAPBOX_TOKEN),
    fetchGoogleStaticMap(lat, lng, GOOGLE_API_KEY)
  ]);
  const selectedImage = selectBestImage(imagery);
  
  // STEP 2: Fetch and validate footprint
  const footprint = await resolveFootprint({
    lat, lng,
    solarData: await fetchGoogleSolarData(lat, lng),
    mapboxToken: MAPBOX_TOKEN,
    regridApiKey: REGRID_API_KEY,
    enableAIFallback: true,
    imageUrl: selectedImage.url
  });
  
  if (!footprint) {
    return errorResponse('No valid footprint found');
  }
  
  // STEP 3: Build roof topology (skeleton + ridge direction)
  const topology = buildRoofTopology({
    footprint,
    solarSegments: footprint.solarData?.roofSegments,
    eaveOffsetFt: 1.0
  });
  
  // STEP 4: Split into facets and compute areas
  const areaResult = computeFacetsAndAreas(
    topology,
    footprint.solarData?.roofSegments,
    pitch_override || '6/12'
  );
  
  // STEP 5: Run QA gate
  const qaResult = runQAGate(topology, areaResult, footprint.solarData);
  
  // STEP 6: Persist to database
  const measurement = await persistMeasurement({
    property_id,
    footprint,
    topology,
    areaResult,
    qaResult,
    imagery: selectedImage
  });
  
  // STEP 7: Return response
  return jsonResponse({
    success: true,
    measurement_id: measurement.id,
    summary: {
      total_area_sqft: areaResult.totals.slopedAreaSqft,
      plan_area_sqft: areaResult.totals.planAreaSqft,
      squares: areaResult.totals.squares,
      predominant_pitch: areaResult.totals.predominantPitch,
      ...areaResult.linearTotals
    },
    facets: areaResult.facets,
    qa: qaResult,
    footprint_source: footprint.source,
    topology_source: topology.ridgeSource,
    requires_review: qaResult.requiresManualReview
  });
});
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/_shared/footprint-resolver.ts` | Unified footprint fetching with validation |
| `supabase/functions/_shared/roof-topology-builder.ts` | Skeleton + ridge direction + edge classification |
| `supabase/functions/_shared/facet-area-calculator.ts` | Facet splitting with area/pitch assignment |
| `supabase/functions/_shared/measurement-qa-gate.ts` | Consolidated QA validation |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/measure/index.ts` | Refactor to use unified modules (reduce from ~3900 lines to ~400) |
| `supabase/functions/analyze-roof-aerial/index.ts` | Remove duplicate footprint logic, delegate to `footprint-resolver` |

## Files to Keep (Unchanged)

| File | Reason |
|------|--------|
| `_shared/roofWorksheetEngine.ts` | Authoritative calculation engine |
| `_shared/roof-analysis-helpers.ts` | Helper functions and PLANIMETER_THRESHOLDS |
| `_shared/straight-skeleton.ts` | Core skeleton algorithm |
| `measure/gable-detector.ts` | Edge classification (already clean) |
| `measure/qa-validator.ts` | QA checks (to be called by qa-gate) |

---

## Expected Improvements

1. **Single Source of Truth**: All measurements flow through one pipeline
2. **Consistent Footprint Validation**: PLANIMETER_THRESHOLDS applied uniformly
3. **Clear Ridge Priority**: Manual override supersedes Solar supersedes skeleton
4. **Reduced Code Duplication**: ~3000 lines removed across functions
5. **Better Debugging**: Each step has clear inputs/outputs
6. **Improved Accuracy**: Proper integration of Solar segment data with skeleton topology

---

## Testing Strategy

1. **Unit Tests**: Each shared module (`footprint-resolver`, `topology-builder`, etc.)
2. **Integration Test**: Full pipeline with known addresses
3. **Regression Test**: Compare outputs against existing measurements in database
4. **Edge Cases**: 
   - L-shaped and T-shaped footprints
   - Florida addresses (screen enclosure detection)
   - Solar bbox fallback scenarios
   - Multi-ridge complex roofs

---

## Deployment Sequence

1. Deploy new shared modules (no breaking changes)
2. Deploy updated `measure` function with feature flag
3. Run parallel comparison on 100 recent measurements
4. Validate accuracy improvements
5. Switch `analyze-roof-aerial` to use shared modules
6. Remove deprecated code paths
