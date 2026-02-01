
# Refine Roof Diagram to Align with Satellite Imagery

## Problem Analysis

Based on the screenshot comparison, there are several issues with the current diagram:

### 1. **Misaligned Facet Overlays**
The colored facet polygons (blue, pink, green, purple areas) don't align with the actual roof planes visible in the satellite image. Looking at the satellite, this is an **L-shaped hip roof** with:
- A main rectangular section with a hip roof
- A smaller wing/addition on the left side
- Clear visible ridge lines running through the center of each section

But the diagram shows overlapping, conflicting facets that create visual chaos.

### 2. **OSM Footprint Inaccuracy (80%)**
The badge shows "OSM Footprint (80%)" indicating the building outline came from OpenStreetMap, which is often simplified/inaccurate. The low-confidence footprint is causing:
- Incorrect perimeter shape
- Misplaced linear features (ridges, hips)
- Facets that don't match actual roof planes

### 3. **Multiple Overlapping Geometry Sources**
The diagram is rendering:
- Database facets (if any)
- Client-reconstructed geometry from perimeter
- Linear features from AI detection
- Possibly stale/conflicting data

### 4. **Slope/Pitch Data Not Consolidated**
Each facet might have different pitch data from different sources (Solar API, AI detection, manual input) that aren't being merged into a coherent model.

---

## Root Cause Analysis

| Issue | Source |
|-------|--------|
| Misaligned facets | Facets generated from low-quality OSM footprint, not actual roof geometry |
| Overlapping colors | Multiple facets drawn from both database AND reconstructed geometry |
| Linear features crossing roof | AI-detected ridges/hips based on image analysis, not connected to accurate footprint |
| "Geometry Estimated" warning | System acknowledges the geometry is a guess, not verified |

---

## Proposed Solution: Multi-Phase Diagram Refinement

### Phase 1: Single Source of Truth for Geometry

**Problem:** Multiple geometry sources are conflicting.

**Solution:** Implement a strict priority hierarchy:

```
Priority 1: Manual Override (user-drawn/corrected)
Priority 2: AI-detected linear_features_wkt (validated)
Priority 3: Reconstructed from authoritative footprint
Priority 4: OSM/estimated (show warning, hide facets)
```

**File Changes:**
- `src/components/measurements/SchematicRoofDiagram.tsx` (lines 440-520)
  - Add explicit source selection logic
  - Only render facets when source confidence > 90%
  - Display "Estimated" warning when using low-confidence sources

### Phase 2: Improve Facet Generation from Linear Features

**Problem:** Facets are generated from perimeter, not from detected ridges/hips/valleys.

**Solution:** Build facets by "walking" the linear features:

1. Start from perimeter vertices
2. Connect each vertex to nearest ridge/hip endpoint
3. Create facet polygons bounded by eaves→hips→ridge→hips→eaves
4. Validate facets don't overlap

**New Utility:**
- `src/lib/measurements/facetFromLinearFeatures.ts`
  - `buildFacetsFromGeometry(perimeter, ridges, hips, valleys): Facet[]`
  - Uses topological analysis to create proper connected facets

### Phase 3: Satellite Image Alignment Mode

**Problem:** Diagram doesn't overlay precisely on satellite.

**Solution:** Implement proper GPS-to-SVG coordinate transformation:

**File Changes:**
- `src/components/measurements/SchematicRoofDiagram.tsx` (lines 320-340)
  - Fix `calculateImageBounds` to match actual satellite viewport
  - Ensure `gpsToPixel` transformation accounts for SVG viewBox
  - Add calibration markers to verify alignment

### Phase 4: Merge Slope/Pitch Data into Unified Model

**Problem:** Pitch data exists in multiple places (Solar API, AI detection, per-facet).

**Solution:** Create a unified pitch merger:

```typescript
function mergePitchData(sources: PitchSource[]): FacetPitch[] {
  // Priority: Manual > Solar API segments > AI detection > Default 6/12
  // For each facet region, select highest-confidence pitch
}
```

**File Changes:**
- `src/lib/measurements/pitchMerger.ts` (new file)
  - Consolidates pitch from: `solar_api_response.roofSegments`, `ai_detection_data`, `measurement.predominant_pitch`
  - Assigns pitch per-facet based on azimuth matching

### Phase 5: Hide Low-Confidence Elements

**Problem:** User sees chaotic geometry when data is poor.

**Solution:** Progressive disclosure based on confidence:

| Confidence | What to Show |
|------------|--------------|
| >90% | Full facets, all linear features, areas |
| 70-90% | Perimeter + linear features only (no facets) |
| <70% | Perimeter outline only + strong warning |

**File Changes:**
- `src/components/measurements/SchematicRoofDiagram.tsx`
  - Add `showFacets` conditional based on `footprint_confidence`
  - Add prominent warning banner for estimated geometry
  - Simplify visual when confidence is low

---

## Detailed Implementation

### Step 1: Update SchematicRoofDiagram.tsx - Source Selection

```typescript
// Lines 440-480 - Implement strict source hierarchy
const getGeometrySource = (measurement: any): {
  source: 'manual' | 'validated' | 'reconstructed' | 'estimated';
  confidence: number;
  shouldShowFacets: boolean;
} => {
  // Manual override takes priority
  if (measurement.manual_perimeter_wkt) {
    return { source: 'manual', confidence: 1.0, shouldShowFacets: true };
  }
  
  // High-confidence footprint with linear features
  if (measurement.footprint_confidence >= 0.9 && 
      measurement.linear_features_wkt?.length > 0) {
    return { source: 'validated', confidence: measurement.footprint_confidence, shouldShowFacets: true };
  }
  
  // Medium confidence - show lines but not facets
  if (measurement.footprint_confidence >= 0.7) {
    return { source: 'reconstructed', confidence: measurement.footprint_confidence, shouldShowFacets: false };
  }
  
  // Low confidence - perimeter only
  return { source: 'estimated', confidence: measurement.footprint_confidence || 0.5, shouldShowFacets: false };
};
```

### Step 2: Create Facet Builder from Linear Features

**New file: `src/lib/measurements/facetFromLinearFeatures.ts`**

```typescript
/**
 * Build facets by connecting perimeter edges to interior linear features.
 * Creates topologically correct, non-overlapping facet polygons.
 */
export function buildFacetsFromLinearFeatures(
  perimeterCoords: GPSCoord[],
  ridges: LinearSegment[],
  hips: LinearSegment[],
  valleys: LinearSegment[]
): FacetPolygon[] {
  // 1. Find all junction points (where lines meet)
  // 2. Create graph of connected segments
  // 3. Walk graph to form closed facet polygons
  // 4. Assign pitch to each facet based on adjacent segments
}
```

### Step 3: Update Rendering to Respect Confidence

```typescript
// Around line 1004 - Conditional facet rendering
{showFacets && 
 geometrySource.shouldShowFacets && 
 geometrySource.confidence >= 0.85 && 
 facetPaths.map((facet) => (
   // Render facet...
))}

// Show warning when geometry is estimated
{geometrySource.source === 'estimated' && (
  <div className="absolute top-2 left-2 bg-amber-100 border border-amber-300 rounded px-2 py-1 text-xs">
    <AlertTriangle className="h-3 w-3 inline mr-1" />
    Geometry estimated from satellite - measurements approximate
  </div>
)}
```

### Step 4: Create Pitch Merger Utility

**New file: `src/lib/measurements/pitchMerger.ts`**

```typescript
export function mergeAllPitchSources(measurement: any): Map<number, string> {
  const facetPitches = new Map<number, string>();
  
  // Source 1: Solar API segments (highest priority for pitch accuracy)
  const solarSegments = measurement.solar_api_response?.roofSegments || [];
  solarSegments.forEach((seg, idx) => {
    if (seg.pitchDegrees) {
      const pitchRatio = Math.round(Math.tan(seg.pitchDegrees * Math.PI / 180) * 12);
      facetPitches.set(idx, `${pitchRatio}/12`);
    }
  });
  
  // Source 2: Database facets (manual overrides)
  // Source 3: AI detection data
  // Source 4: Default predominant pitch
  
  return facetPitches;
}
```

---

## Files to Create/Modify

| File | Action | Changes |
|------|--------|---------|
| `src/components/measurements/SchematicRoofDiagram.tsx` | Modify | Add source selection, confidence-based rendering, warning banners |
| `src/lib/measurements/facetFromLinearFeatures.ts` | Create | Build facets from linear features topologically |
| `src/lib/measurements/pitchMerger.ts` | Create | Consolidate pitch data from all sources |
| `src/lib/measurements/geometryConfidenceScorer.ts` | Create | Calculate overall geometry confidence score |

---

## Testing Verification

After implementation:
1. Navigate to a lead with AI measurements
2. Verify diagram shows perimeter aligned with satellite
3. Verify facets only appear when confidence is high
4. Verify linear features (ridges, hips) follow visible roof lines
5. Verify pitch data is consistent across UI

---

## Technical Notes

- The current OSM footprint (80%) is causing most alignment issues
- The system already has `footprint_confidence` and `footprint_source` fields - just need to use them for rendering decisions
- The `roofGeometryReconstructor.ts` generates fake triangular facets from perimeter - should only be used as last resort
- Solar API segments are bounding boxes, not actual roof planes - already correctly excluded from geometry
- The pitch multiplier calculation is correct (in `PITCH_MULTIPLIERS`) - just need to apply per-facet consistently
