
# AI Roof Measurement Pipeline - Complete Implementation (Phases 5-14)

## Overview

This plan implements the remaining 10 phases to complete the unified AI Measurement system. The implementation wires together all the new modules created in earlier phases and adds the required frontend/backend integration for a fully functional end-to-end system.

---

## Phase-by-Phase Implementation

### Phase 5: Unified Pipeline Integration into analyze-roof-aerial

**File:** `supabase/functions/analyze-roof-aerial/index.ts`

**Changes:**
1. Add import for unified pipeline at the top of the file:
```typescript
import { 
  runUnifiedAIPipeline, 
  transformToLegacyFormat,
  type UnifiedPipelineInput 
} from '../_shared/unified-pipeline.ts'
```

2. Add a new `useUnifiedPipeline` flag handler (around line 162):
```typescript
const { 
  address, 
  coordinates, 
  customerId, 
  userId, 
  forceFullAnalysis, 
  pitchOverride,
  useUnifiedPipeline  // NEW FLAG
} = await req.json()
```

3. Add unified pipeline path after the Solar Fast Path check (~line 254):
```typescript
// NEW: UNIFIED AI PIPELINE PATH
if (useUnifiedPipeline) {
  console.log('🔬 Using Unified AI Pipeline...')
  
  const pipelineInput: UnifiedPipelineInput = {
    coordinates,
    address,
    customerId,
    solarData,
    footprint: authoritativeFootprint ? {
      vertices: authoritativeFootprint.vertices,
      source: authoritativeFootprint.source,
      confidence: authoritativeFootprint.confidence,
    } : undefined,
    pitchOverride,
    imageryUrl: googleImage?.url || mapboxImage?.url,
    analysisZoom: IMAGE_ZOOM,
    imageSize: IMAGE_SIZE,
  }
  
  // Invoke roof-segmentation for AI detection
  const segmentationResponse = await fetch(`${SUPABASE_URL}/functions/v1/roof-segmentation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      imageBase64: googleImage?.base64,
      lat: coordinates.lat,
      lng: coordinates.lng,
      imageSize: IMAGE_SIZE,
      zoom: IMAGE_ZOOM,
    }),
  })
  
  if (segmentationResponse.ok) {
    const segmentationResult = await segmentationResponse.json()
    pipelineInput.segmentationResult = segmentationResult.data
  }
  
  // Run unified pipeline
  const pipelineResult = await runUnifiedAIPipeline(pipelineInput)
  
  if (pipelineResult.success) {
    // Transform to legacy format for backward compatibility
    const { measurement, tags } = transformToLegacyFormat(pipelineResult)
    
    // Save to database with new fields
    // ... (database save logic with facets_json, etc.)
    
    return new Response(JSON.stringify({
      success: true,
      data: {
        measurements: measurement,
        aiAnalysis: { roofType: pipelineResult.data.roofType },
        confidence: pipelineResult.data.confidence,
        facets: pipelineResult.data.facets,
        linearFeatures: pipelineResult.data.linearFeatures,
      },
      measurementId: savedMeasurement.id,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
}
```

---

### Phase 6: SVG Overlay Edge Function

**New File:** `supabase/functions/generate-roof-overlay/index.ts`

Creates an edge function that generates annotated satellite overlays:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { 
  generateSVGOverlay, 
  calculateImageBounds,
  linearFeaturesFromWKT,
  svgToBase64 
} from '../_shared/svg-overlay-generator.ts'

const corsHeaders = { /* standard CORS */ }

serve(async (req) => {
  const { 
    measurementId,
    footprint,
    facets,
    linearFeatures,
    centerLat,
    centerLng,
    width = 640,
    height = 640,
    zoom = 20
  } = await req.json()
  
  // Calculate image bounds
  const bounds = calculateImageBounds(centerLat, centerLng, zoom, width, height)
  
  // Generate SVG overlay
  const svgContent = generateSVGOverlay(
    footprint,
    linearFeatures,
    facets,
    bounds,
    {
      width,
      height,
      showFacets: true,
      showLinearFeatures: true,
      showLengthLabels: true,
      showFacetLabels: true,
      showNorthArrow: true,
      showLegend: true,
    }
  )
  
  // Upload to storage
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const fileName = `overlays/${measurementId || Date.now()}.svg`
  
  await supabase.storage
    .from('roof-overlays')
    .upload(fileName, svgContent, { contentType: 'image/svg+xml' })
  
  const { data: urlData } = supabase.storage
    .from('roof-overlays')
    .getPublicUrl(fileName)
  
  return new Response(JSON.stringify({
    success: true,
    svgContent,
    svgBase64: svgToBase64(svgContent),
    overlayUrl: urlData.publicUrl,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
```

**Config update:** Add to `supabase/config.toml`:
```toml
[functions.generate-roof-overlay]
verify_jwt = false
```

---

### Phase 7: Enhanced PDF Report Generation

**File:** `supabase/functions/generate-roofr-style-report/index.ts`

**Changes:**

1. Update interface to include new data fields:
```typescript
interface ReportData {
  // ... existing fields
  
  // NEW: Per-facet data
  facets?: Array<{
    id: string;
    facetNumber: number;
    planAreaSqft: number;
    surfaceAreaSqft: number;
    pitch: string;
    orientation: string;
  }>;
  
  // NEW: Overlay data
  satelliteOverlaySvg?: string;
  satelliteImageUrl?: string;
  
  // NEW: QA data
  qaResult?: {
    overallPass: boolean;
    passedChecks: number;
    totalChecks: number;
  };
  
  confidence?: {
    overallConfidence: number;
    confidenceLevel: string;
  };
}
```

2. Add new page generators for the 7-page format:

**Page 4: Per-Facet Area Table**
```html
<div class="page">
  <h2>Area Measurements - Per Facet Breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Facet</th>
        <th>Plan Area</th>
        <th>Surface Area</th>
        <th>Pitch</th>
        <th>Direction</th>
      </tr>
    </thead>
    <tbody>
      ${facets.map((f, i) => `
        <tr>
          <td class="facet-indicator" style="background: ${FACET_COLORS[i % 8]}">${i + 1}</td>
          <td>${f.planAreaSqft.toFixed(0)} sqft</td>
          <td>${f.surfaceAreaSqft.toFixed(0)} sqft</td>
          <td>${f.pitch}</td>
          <td>${f.orientation}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</div>
```

**Page 5: Pitch & Direction Analysis**
```html
<div class="page">
  <h2>Pitch & Direction Analysis</h2>
  <div class="compass-diagram">
    <!-- SVG compass with colored facet indicators -->
  </div>
  <table class="pitch-breakdown">
    <!-- Area grouped by pitch -->
  </table>
</div>
```

---

### Phase 8: SchematicRoofDiagram Facets Enhancement

**File:** `src/components/measurements/SchematicRoofDiagram.tsx`

**Changes:**

1. Add facets_json parsing (around line 235):
```typescript
// NEW: Parse facets from facets_json field
const parsedFacetsFromJson = useMemo(() => {
  const facetsJson = measurement?.facets_json;
  if (!facetsJson) return [];
  
  try {
    const facets = typeof facetsJson === 'string' 
      ? JSON.parse(facetsJson) 
      : facetsJson;
    
    return facets.map((f: any, idx: number) => ({
      id: f.id || `F${idx + 1}`,
      polygon: f.polygon || f.polygonGps || [],
      areaSqft: f.areaSqft || f.area_flat_sqft || 0,
      pitch: f.estimatedPitch || f.pitch || '6/12',
      orientation: f.orientation || 'unknown',
      color: FACET_COLORS[idx % 8],
    }));
  } catch {
    return [];
  }
}, [measurement?.facets_json]);
```

2. Add interactive facet click handlers:
```typescript
const handleFacetClick = (facetId: string) => {
  setHoveredSegment({ type: 'facet', id: facetId });
  
  // Scroll to corresponding row in measurement table if visible
  const tableRow = document.getElementById(`facet-row-${facetId}`);
  if (tableRow) {
    tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tableRow.classList.add('highlight-row');
    setTimeout(() => tableRow.classList.remove('highlight-row'), 2000);
  }
};
```

3. Render facets from JSON when database facets unavailable:
```typescript
// In the facet rendering section, prioritize parsedFacetsFromJson
const facetsToRender = facets.length > 0 ? facets : parsedFacetsFromJson;
```

---

### Phase 9: Manual Editor with AI Geometry Pre-loading

**File:** `src/components/measurements/ManualMeasurementEditor.tsx`

**Changes:**

1. Add new props for AI geometry pre-loading:
```typescript
interface ManualMeasurementEditorProps {
  // ... existing props
  preloadMeasurementId?: string;  // NEW: Pre-load from existing AI measurement
}
```

2. Import and use the vertex editing hook:
```typescript
import { useVertexEditing, type Vertex } from '@/hooks/useVertexEditing';

// Inside the component:
const [editingState, editingActions] = useVertexEditing();

// Load AI geometry when prop provided
useEffect(() => {
  if (preloadMeasurementId) {
    editingActions.loadAIGeometry(preloadMeasurementId);
  }
}, [preloadMeasurementId]);
```

3. Add UI controls for snapping and undo/redo:
```typescript
<div className="editing-toolbar">
  <Button 
    variant={snapEnabled ? 'default' : 'outline'} 
    size="sm"
    onClick={() => setSnapEnabled(!snapEnabled)}
  >
    <Grid className="h-4 w-4 mr-1" />
    Snap to Grid
  </Button>
  
  <Button 
    variant="outline" 
    size="sm"
    onClick={editingActions.undo}
    disabled={!editingState.canUndo}
  >
    <Undo className="h-4 w-4" />
  </Button>
  
  <Button 
    variant="outline" 
    size="sm"
    onClick={editingActions.redo}
    disabled={!editingState.canRedo}
  >
    <Redo className="h-4 w-4" />
  </Button>
</div>
```

4. Add real-time measurements display:
```typescript
const measurements = editingActions.getCalculatedMeasurements();

<div className="realtime-measurements">
  <div>Area: {measurements.areaSqft.toFixed(0)} sqft</div>
  <div>Perimeter: {measurements.perimeterFt.toFixed(0)} ft</div>
  <div>Ridge: {measurements.ridgeFt.toFixed(0)} ft</div>
  <div>Hip: {measurements.hipFt.toFixed(0)} ft</div>
  <div>Valley: {measurements.valleyFt.toFixed(0)} ft</div>
</div>
```

---

### Phase 10: Database Persistence Updates

**File:** `supabase/functions/analyze-roof-aerial/index.ts`

**Changes to database save logic (add to measurement insert):**

```typescript
const { data: savedMeasurement, error: saveError } = await supabaseClient
  .from('roof_measurements')
  .insert({
    customer_id: customerId,
    property_address: address,
    // ... existing fields
    
    // NEW: Detailed geometry data
    facets_json: pipelineResult.data.facets,
    perimeter_vertices: pipelineResult.data.footprint,
    
    // NEW: Quality metrics
    measurement_method: 'ai_segmentation',
    segmentation_confidence: pipelineResult.data.confidence.overallConfidence,
    qa_passed: pipelineResult.data.qaResult.overallPass,
    manual_review_recommended: pipelineResult.data.confidence.requiresManualReview,
    
    // Existing calculations
    total_area_flat_sqft: pipelineResult.data.facetTotals.totalPlanAreaSqft,
    total_area_adjusted_sqft: pipelineResult.data.facetTotals.totalSurfaceAreaSqft,
    facet_count: pipelineResult.data.facets.length,
    predominant_pitch: pipelineResult.data.predominantPitch,
    
    // Linear totals
    total_ridge_length: pipelineResult.data.linearTotals.breakdown.ridge?.total || 0,
    total_hip_length: pipelineResult.data.linearTotals.breakdown.hip?.total || 0,
    total_valley_length: pipelineResult.data.linearTotals.breakdown.valley?.total || 0,
    total_eave_length: pipelineResult.data.linearTotals.breakdown.eave?.total || 0,
    total_rake_length: pipelineResult.data.linearTotals.breakdown.rake?.total || 0,
  })
  .select()
  .single();
```

---

### Phase 11: PullMeasurementsButton Integration

**File:** `src/components/measurements/PullMeasurementsButton.tsx`

**Changes:**

1. Add unified pipeline flag to the invoke call (around line 266):
```typescript
const { data, error } = await supabase.functions.invoke('analyze-roof-aerial', {
  body: {
    address: address || 'Unknown Address',
    coordinates: { lat: pullLat, lng: pullLng },
    customerId: propertyId,
    userId: user?.id,
    pitchOverride: pitchOverride || undefined,
    useUnifiedPipeline: true  // NEW: Enable unified pipeline
  }
});
```

2. Add confidence-based toast messages (around line 410):
```typescript
// Enhanced confidence display with tier badges
const confidence = data.data?.confidence?.overallConfidence || 0;
const qaPass = data.data?.qaResult?.overallPass;

let accuracyTier = 'bronze';
let tierEmoji = '🥉';
if (confidence >= 0.98) { accuracyTier = 'diamond'; tierEmoji = '💎'; }
else if (confidence >= 0.95) { accuracyTier = 'platinum'; tierEmoji = '🏆'; }
else if (confidence >= 0.90) { accuracyTier = 'gold'; tierEmoji = '🥇'; }
else if (confidence >= 0.85) { accuracyTier = 'silver'; tierEmoji = '🥈'; }

toast({
  title: `${tierEmoji} ${accuracyTier.charAt(0).toUpperCase() + accuracyTier.slice(1)} Measurement`,
  description: `${data.data.facets?.length || 0} facets • ${(confidence * 100).toFixed(0)}% confidence${qaPass ? ' ✓ QA Passed' : ''}`,
});
```

3. Add handler for measurement completion automation:
```typescript
// After successful save, trigger automation
if (data?.measurementId) {
  await triggerAutomation(AUTOMATION_EVENTS.MeasurementCompleted, {
    pipelineEntryId: propertyId,
    measurementId: data.measurementId,
    totalAreaSqft: data.data?.facetTotals?.totalSurfaceAreaSqft,
    facetCount: data.data?.facets?.length,
    accuracyTier,
    qaPass: data.data?.qaResult?.overallPass,
  });
}
```

---

### Phase 12: RoofrStyleReportPreview Enhancements

**File:** `src/components/measurements/RoofrStyleReportPreview.tsx`

**Changes:**

1. Add facets table to area measurements page (around line 600):
```typescript
// NEW: Per-facet breakdown section
{enrichedMeasurement?.facets_json && (
  <div className="facet-breakdown mt-6">
    <h3 className="text-lg font-semibold mb-3">Per-Facet Breakdown</h3>
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-2">Facet</th>
          <th className="text-right py-2">Plan Area</th>
          <th className="text-right py-2">Surface Area</th>
          <th className="text-right py-2">Pitch</th>
          <th className="text-center py-2">Direction</th>
        </tr>
      </thead>
      <tbody>
        {(typeof enrichedMeasurement.facets_json === 'string' 
          ? JSON.parse(enrichedMeasurement.facets_json) 
          : enrichedMeasurement.facets_json
        ).map((facet: any, idx: number) => (
          <tr key={facet.id || idx} className="border-b border-muted">
            <td className="py-2 flex items-center gap-2">
              <div 
                className="w-4 h-4 rounded" 
                style={{ backgroundColor: FACET_COLORS[idx % 8] }}
              />
              {idx + 1}
            </td>
            <td className="text-right py-2">
              {facet.areaSqft?.toFixed(0) || '—'} sqft
            </td>
            <td className="text-right py-2">
              {(facet.areaSqft * getSlopeFactor(facet.estimatedPitch))?.toFixed(0) || '—'} sqft
            </td>
            <td className="text-right py-2">{facet.estimatedPitch || '—'}</td>
            <td className="text-center py-2">{facet.orientation || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

2. Add QA badge to report header:
```typescript
{enrichedMeasurement?.qa_passed !== undefined && (
  <Badge variant={enrichedMeasurement.qa_passed ? 'default' : 'destructive'}>
    {enrichedMeasurement.qa_passed ? '✓ QA Passed' : '⚠ Review Required'}
  </Badge>
)}
```

---

### Phase 13: CRM Automation Integration

**File:** `src/lib/automations/triggerAutomation.ts`

**Add new event type:**
```typescript
export const AUTOMATION_EVENTS = {
  // ... existing events
  MeasurementCompleted: 'measurement_completed',
  MeasurementHighConfidence: 'measurement_high_confidence',
  MeasurementNeedsReview: 'measurement_needs_review',
};
```

**File:** `supabase/functions/automation-processor/index.ts`

**Add handler for measurement events:**
```typescript
case 'measurement_completed':
  // Auto-advance pipeline if high confidence
  if (payload.accuracyTier === 'diamond' || payload.accuracyTier === 'platinum') {
    await advancePipelineStage(payload.pipelineEntryId, 'measured');
  }
  
  // Create task if review needed
  if (!payload.qaPass || payload.accuracyTier === 'bronze') {
    await createTask({
      pipelineEntryId: payload.pipelineEntryId,
      title: 'Review AI Measurement',
      description: `Measurement requires manual verification (${payload.accuracyTier} tier)`,
      assignTo: 'measurement_reviewer',
    });
  }
  break;
```

---

### Phase 14: Testing Framework

**New File:** `supabase/functions/roof-segmentation/index_test.ts`

```typescript
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

Deno.test("roof-segmentation returns valid response structure", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/roof-segmentation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      lat: 27.9881,
      lng: -82.7329,
      imageSize: 640,
      zoom: 20,
      // Note: In real test, would include imageBase64
    }),
  });
  
  const body = await response.json();
  
  // Should return structured response even without image
  assertExists(body);
  
  await response.body?.cancel();
});

Deno.test("unified-pipeline calculates correct facet totals", async () => {
  // Import the function directly for unit testing
  const { aggregateFacetTotals } = await import('../_shared/roofWorksheetEngine.ts');
  
  const testFacets = [
    { id: 'F1', planAreaSqft: 1000, pitch: '6/12', orientation: 'N' },
    { id: 'F2', planAreaSqft: 1200, pitch: '6/12', orientation: 'S' },
  ];
  
  const result = aggregateFacetTotals(testFacets);
  
  assertEquals(result.totalPlanAreaSqft, 2200);
  assertEquals(result.facetCount, 2);
  assertEquals(result.predominantPitch, '6/12');
});
```

---

## Config Updates Required

**File:** `supabase/config.toml`

Add new function configuration:
```toml
[functions.generate-roof-overlay]
verify_jwt = false

[functions.roof-segmentation]
verify_jwt = false
wall_clock_limit = 120
```

---

## Implementation Order

| Step | Phase | Effort | Files Changed |
|------|-------|--------|---------------|
| 1 | Phase 5 | 2 hours | `analyze-roof-aerial/index.ts` |
| 2 | Phase 10 | 1 hour | `analyze-roof-aerial/index.ts` (DB save) |
| 3 | Phase 6 | 2 hours | New `generate-roof-overlay/index.ts` |
| 4 | Phase 11 | 1 hour | `PullMeasurementsButton.tsx` |
| 5 | Phase 8 | 2 hours | `SchematicRoofDiagram.tsx` |
| 6 | Phase 12 | 1.5 hours | `RoofrStyleReportPreview.tsx` |
| 7 | Phase 7 | 2 hours | `generate-roofr-style-report/index.ts` |
| 8 | Phase 9 | 3 hours | `ManualMeasurementEditor.tsx` |
| 9 | Phase 13 | 1 hour | Automation files |
| 10 | Phase 14 | 1.5 hours | Test files |

**Total: ~17 hours of implementation**

---

## Testing the System

After implementation, you can test by:

1. **Navigate to any lead page** (you're currently on `/lead/cf3d0f5d-18bf-45d1-b90d-857be321a22e`)
2. **Click "AI Measurement" button** in the lead sidebar or measurement section
3. **Confirm PIN location** on the structure selector map
4. **Observe the progress toasts** showing "Analyzing satellite imagery..."
5. **View the report preview** with per-facet breakdown when complete
6. **Check the SchematicRoofDiagram** for rendered facets and linear features
7. **Generate PDF** to verify 7-page format with embedded diagrams

---

## Success Metrics

| Metric | Target |
|--------|--------|
| End-to-end time | <15 seconds |
| Facet detection accuracy | ≥95% |
| Area accuracy vs EagleView | ±2% |
| QA pass rate | >90% first attempt |
| PDF generation time | <5 seconds |
