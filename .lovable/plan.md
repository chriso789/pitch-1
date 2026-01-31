
# AI Roof Measurement Pipeline - Full Implementation Plan
## Phases 5-14: Completing the Unified AI Measurement System

---

## Current State Assessment

### Already Implemented (Phases 1-4):
1. **Satellite Image Fetcher** (`_shared/satellite-image-fetcher.ts`) - High-res image acquisition
2. **Image Preprocessor** (`_shared/image-preprocessor.ts`) - Shadow mitigation, edge enhancement
3. **Roof Segmentation** (`roof-segmentation/index.ts`) - Gemini 2.5 Flash for facet detection
4. **Polygon Simplifier** (`_shared/polygon-simplifier.ts`) - Douglas-Peucker + angle snapping
5. **QA Checks** (`_shared/qa-checks.ts`) - Comprehensive validation suite
6. **Facet Generator** (`_shared/facet-generator.ts`) - Geometric subdivision
7. **Pitch Estimator** (`_shared/pitch-estimator.ts`) - Multi-source detection
8. **Worksheet Engine Enhancements** (`_shared/roofWorksheetEngine.ts`) - Aggregation functions

### Still To Implement:
- Integration of new modules into main pipeline
- Satellite overlay diagram generation
- Enhanced PDF report with embedded imagery
- Manual editor with AI geometry pre-loading
- End-to-end orchestration in `analyze-roof-aerial`

---

## Phase 5: Unified Pipeline Orchestration

### Goal: Wire all new modules into `analyze-roof-aerial/index.ts`

### Files to Update:
| File | Changes |
|------|---------|
| `supabase/functions/analyze-roof-aerial/index.ts` | Add new unified pipeline path |

### Implementation:

```typescript
// Add new import at top of analyze-roof-aerial/index.ts
import { fetchHighResSatelliteImage } from '../_shared/satellite-image-fetcher.ts'
import { preprocessImage, analyzeImageQuality } from '../_shared/image-preprocessor.ts'
import { simplifyAndClean, snapToOrthogonal } from '../_shared/polygon-simplifier.ts'
import { runFullQAChecks, calculateOverallConfidence } from '../_shared/qa-checks.ts'
import { generateFacetsFromFootprint } from '../_shared/facet-generator.ts'
import { estimatePitchMultiSource } from '../_shared/pitch-estimator.ts'
import { aggregateFacetTotals, aggregateLinearByType, buildWorksheetFromFacets } from '../_shared/roofWorksheetEngine.ts'
```

### New Unified Pipeline Function (~200 lines):

```typescript
async function runUnifiedAIPipeline(
  coordinates: { lat: number; lng: number },
  address: string,
  customerId: string,
  solarData: any,
  supabase: any
): Promise<{ success: boolean; data: any; error?: string }> {
  
  // STEP 1: Fetch high-resolution satellite image
  const satImage = await fetchHighResSatelliteImage(coordinates.lat, coordinates.lng, {
    zoom: 21,
    size: 2560,
    provider: 'google_then_mapbox'
  });
  
  // STEP 2: Preprocess image for AI detection
  const { preprocessedImage, qualityMetrics } = await preprocessImage(satImage.imageBase64, {
    enhanceEdges: true,
    mitigateShadows: qualityMetrics.shadowRatio > 0.3,
    normalizeContrast: true
  });
  
  // STEP 3: Call roof-segmentation for AI facet detection
  const segmentationResult = await supabase.functions.invoke('roof-segmentation', {
    body: {
      imageBase64: preprocessedImage,
      lat: coordinates.lat,
      lng: coordinates.lng,
      imageSize: 2560,
      zoom: 21,
      hints: {
        expectedAreaSqft: solarData?.buildingFootprintSqft || null
      }
    }
  });
  
  // STEP 4: Clean and simplify polygon
  const cleanedPolygon = simplifyAndClean(segmentationResult.data.footprint.polygonGps, {
    tolerance: 0.5,
    snapAngles: true,
    angleThreshold: 12
  });
  
  // STEP 5: Generate facets if not detected
  let facets = segmentationResult.data.facets;
  if (facets.length === 0) {
    facets = generateFacetsFromFootprint(cleanedPolygon, {
      roofType: segmentationResult.data.roofType,
      solarSegments: solarData?.roofSegments || null
    });
  }
  
  // STEP 6: Estimate pitch for each facet
  for (const facet of facets) {
    if (!facet.estimatedPitch || facet.estimatedPitch === 'unknown') {
      facet.estimatedPitch = await estimatePitchMultiSource({
        facet,
        solarData,
        coordinates,
        state: extractStateFromAddress(address)
      });
    }
  }
  
  // STEP 7: Aggregate measurements
  const facetTotals = aggregateFacetTotals(facets.map(f => ({
    id: f.id,
    planAreaSqft: f.areaSqft,
    pitch: f.estimatedPitch,
    orientation: f.orientation
  })));
  
  const linearTotals = aggregateLinearByType(segmentationResult.data.linearFeatures.map(lf => ({
    type: lf.type,
    lengthFt: lf.lengthFt
  })));
  
  // STEP 8: Run QA checks
  const qaResult = runFullQAChecks({
    footprint: cleanedPolygon,
    facets,
    linearFeatures: segmentationResult.data.linearFeatures,
    solarData
  });
  
  // STEP 9: Calculate overall confidence
  const confidence = calculateOverallConfidence({
    segmentationConfidence: segmentationResult.data.qualityMetrics.segmentationConfidence,
    facetClosureScore: segmentationResult.data.qualityMetrics.facetClosureScore,
    edgeContinuityScore: segmentationResult.data.qualityMetrics.edgeContinuityScore,
    qaResult
  });
  
  return {
    success: true,
    data: {
      footprint: cleanedPolygon,
      facets,
      facetTotals,
      linearFeatures: segmentationResult.data.linearFeatures,
      linearTotals,
      predominantPitch: facetTotals.predominantPitch,
      roofType: segmentationResult.data.roofType,
      confidence,
      qaResult,
      qualityMetrics,
      satelliteImageUrl: satImage.url
    }
  };
}
```

---

## Phase 6: Satellite Overlay Diagram Generation

### Goal: Annotate satellite image with detected roof geometry

### Files to Update:
| File | Changes |
|------|---------|
| `supabase/functions/generate-roof-overlay/index.ts` | Add actual polygon rendering |

### Implementation Details:

**6.1 SVG Overlay Generation Function:**

```typescript
function generateSVGOverlay(
  imageWidth: number,
  imageHeight: number,
  footprint: Array<{ lat: number; lng: number }>,
  linearFeatures: Array<{ type: string; start: { lat: number; lng: number }; end: { lat: number; lng: number }; lengthFt: number }>,
  facets: Array<{ id: string; polygon: Array<{ lat: number; lng: number }>; areaSqft: number }>,
  bounds: ImageBounds
): string {
  
  const gpsToPixel = (coord: { lat: number; lng: number }) => {
    const x = ((coord.lng - bounds.west) / (bounds.east - bounds.west)) * imageWidth;
    const y = ((bounds.north - coord.lat) / (bounds.north - bounds.south)) * imageHeight;
    return { x, y };
  };
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}">`;
  
  // Draw facets with semi-transparent fill
  facets.forEach((facet, idx) => {
    const points = facet.polygon.map(p => {
      const px = gpsToPixel(p);
      return `${px.x},${px.y}`;
    }).join(' ');
    svg += `<polygon points="${points}" fill="${FACET_COLORS[idx % 8]}" stroke="#343A40" stroke-width="2"/>`;
    
    // Add facet label at centroid
    const centroid = calculateCentroid(facet.polygon);
    const cpx = gpsToPixel(centroid);
    svg += `<text x="${cpx.x}" y="${cpx.y}" text-anchor="middle" fill="white" font-size="14" font-weight="bold">${idx + 1}</text>`;
  });
  
  // Draw linear features with color coding
  const lineColors = { ridge: '#90EE90', hip: '#9B59B6', valley: '#DC3545', eave: '#006400', rake: '#17A2B8' };
  
  linearFeatures.forEach((lf, idx) => {
    const startPx = gpsToPixel(lf.start);
    const endPx = gpsToPixel(lf.end);
    const color = lineColors[lf.type] || '#FFFFFF';
    
    svg += `<line x1="${startPx.x}" y1="${startPx.y}" x2="${endPx.x}" y2="${endPx.y}" stroke="${color}" stroke-width="3"/>`;
    
    // Add length label at midpoint
    const midX = (startPx.x + endPx.x) / 2;
    const midY = (startPx.y + endPx.y) / 2;
    svg += `<text x="${midX}" y="${midY - 5}" text-anchor="middle" fill="${color}" font-size="11" font-weight="bold">${lf.lengthFt.toFixed(0)}'</text>`;
  });
  
  // Draw footprint outline
  const perimeterPoints = footprint.map(p => {
    const px = gpsToPixel(p);
    return `${px.x},${px.y}`;
  }).join(' ');
  svg += `<polygon points="${perimeterPoints}" fill="none" stroke="#343A40" stroke-width="3"/>`;
  
  // Add north arrow
  svg += `
    <g transform="translate(${imageWidth - 50}, 50)">
      <polygon points="0,20 8,8 0,-15 -8,8" fill="#ef4444"/>
      <text x="0" y="-20" text-anchor="middle" fill="#ef4444" font-size="16" font-weight="bold">N</text>
    </g>
  `;
  
  svg += '</svg>';
  return svg;
}
```

**6.2 Composite Image Generation:**

```typescript
async function generateAnnotatedSatelliteImage(
  satelliteImageBase64: string,
  overlaysSVG: string
): Promise<string> {
  // Since Deno Edge Functions don't have canvas, we'll:
  // Option 1: Return SVG overlay separately for frontend compositing
  // Option 2: Call external image service (Sharp/Puppeteer)
  
  // For now, store SVG overlay and let frontend composite
  return overlaysSVG;
}
```

---

## Phase 7: Enhanced PDF Report Generation

### Goal: 7-page professional report with embedded imagery

### Files to Update:
| File | Changes |
|------|---------|
| `supabase/functions/generate-roofr-style-report/index.ts` | Add satellite overlay embedding, facet breakdown |

### Implementation:

**7.1 Update ReportData Interface:**

```typescript
interface ReportData {
  // Existing fields...
  
  // NEW: Image data
  satelliteOverlaySvg?: string;
  satelliteImageUrl?: string;
  vectorDiagramSvg?: string;
  
  // NEW: Per-facet data
  facets: Array<{
    id: string;
    facetNumber: number;
    planAreaSqft: number;
    surfaceAreaSqft: number;
    pitch: string;
    orientation: string;
  }>;
  
  // NEW: Company branding
  companyLogo?: string;
  primaryColor?: string;
}
```

**7.2 New Page Templates:**

```html
<!-- PAGE 1: COVER with actual satellite overlay -->
<div class="page">
  <div class="header"><!-- company branding --></div>
  <div class="satellite-container">
    <!-- Embed actual satellite with polygon overlay -->
    <img src="${satelliteImageUrl}" style="width: 100%; border-radius: 8px;"/>
    <svg class="overlay">${satelliteOverlaySvg}</svg>
  </div>
  <div class="stat-grid"><!-- key metrics --></div>
</div>

<!-- PAGE 4: AREA MEASUREMENTS with per-facet table -->
<table>
  <thead>
    <tr>
      <th>Facet</th>
      <th>Plan Area</th>
      <th>Surface Area</th>
      <th>Pitch</th>
      <th>Orientation</th>
    </tr>
  </thead>
  <tbody>
    ${facets.map((f, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${f.planAreaSqft.toFixed(0)} sqft</td>
        <td>${f.surfaceAreaSqft.toFixed(0)} sqft</td>
        <td>${f.pitch}</td>
        <td>${f.orientation}</td>
      </tr>
    `).join('')}
  </tbody>
</table>

<!-- PAGE 5: PITCH & DIRECTION compass diagram -->
<div class="pitch-direction-page">
  <div class="compass-diagram">
    <svg viewBox="0 0 200 200">
      <!-- Compass rose with facets colored by pitch -->
    </svg>
  </div>
  <table class="pitch-breakdown">
    <!-- Pitch breakdown table -->
  </table>
</div>
```

---

## Phase 8: SchematicRoofDiagram Enhancements

### Goal: Render facets_json with interactive features

### Files to Update:
| File | Changes |
|------|---------|
| `src/components/measurements/SchematicRoofDiagram.tsx` | Add facets_json parsing, hover sync |

### Implementation:

**8.1 Parse facets_json from Database:**

```typescript
// Add to existing useMemo in SchematicRoofDiagram
const parsedFacets = useMemo(() => {
  const facetsJson = measurement?.facets_json;
  if (!facetsJson) return [];
  
  try {
    const facets = typeof facetsJson === 'string' ? JSON.parse(facetsJson) : facetsJson;
    return facets.map((f: any) => ({
      id: f.id,
      polygon: f.polygonGps || f.polygon,
      areaSqft: f.areaSqft || f.area_flat_sqft,
      pitch: f.estimatedPitch || f.pitch,
      orientation: f.orientation,
      color: FACET_COLORS[parseInt(f.id.replace('F', '')) - 1 % 8]
    }));
  } catch {
    return [];
  }
}, [measurement?.facets_json]);
```

**8.2 Interactive Hover with SegmentHoverContext:**

```typescript
// Already using useSegmentHover - enhance interaction
const handleFacetClick = (facetId: string) => {
  setHoveredSegment({ type: 'facet', id: facetId });
  // Scroll to corresponding row in measurement table
  const tableRow = document.getElementById(`facet-row-${facetId}`);
  tableRow?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
```

---

## Phase 9: Manual Measurement Editor Upgrade

### Goal: Pre-load AI geometry, vertex editing with snapping

### Files to Update:
| File | Changes |
|------|---------|
| `src/components/measurements/ManualMeasurementEditor.tsx` | Add AI geometry loading, drag handles, snapping |

### Implementation:

**9.1 Load AI Geometry on Mount:**

```typescript
interface ManualMeasurementEditorProps {
  pipelineEntryId: string;
  onSave: (geometry: EditedGeometry) => void;
  preloadMeasurementId?: string;  // NEW: Pre-load from existing AI measurement
}

const ManualMeasurementEditor: React.FC<ManualMeasurementEditorProps> = ({
  pipelineEntryId,
  onSave,
  preloadMeasurementId
}) => {
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [interiorLines, setInteriorLines] = useState<InteriorLine[]>([]);
  const [editHistory, setEditHistory] = useState<EditState[]>([]);
  
  // Load AI geometry if provided
  useEffect(() => {
    if (preloadMeasurementId) {
      loadAIGeometry(preloadMeasurementId);
    }
  }, [preloadMeasurementId]);
  
  const loadAIGeometry = async (measurementId: string) => {
    const { data } = await supabase
      .from('roof_measurements')
      .select('perimeter_vertices, linear_features_wkt, facets_json')
      .eq('id', measurementId)
      .single();
    
    if (data?.perimeter_vertices) {
      setVertices(data.perimeter_vertices.map((v: any, i: number) => ({
        id: `V${i + 1}`,
        lat: v.lat,
        lng: v.lng,
        isDraggable: true,
        isAIDetected: true
      })));
    }
    
    if (data?.linear_features_wkt) {
      // Parse WKT to interior lines
      setInteriorLines(parseWKTToInteriorLines(data.linear_features_wkt));
    }
  };
};
```

**9.2 Vertex Dragging with Angle Snapping:**

```typescript
const handleVertexDrag = (vertexId: string, newLat: number, newLng: number) => {
  const snapResult = snapToAngles(vertexId, newLat, newLng, vertices, {
    enableSnap: snapEnabled,
    snapThreshold: 10,  // ±10 degrees
    snapAngles: [0, 45, 90, 135, 180]
  });
  
  const updatedVertices = vertices.map(v => 
    v.id === vertexId 
      ? { ...v, lat: snapResult.lat, lng: snapResult.lng, snapped: snapResult.wasSnapped }
      : v
  );
  
  setVertices(updatedVertices);
  recalculateMeasurements(updatedVertices, interiorLines);
};

const snapToAngles = (vertexId: string, lat: number, lng: number, allVertices: Vertex[], options: SnapOptions) => {
  if (!options.enableSnap) return { lat, lng, wasSnapped: false };
  
  const vertexIndex = allVertices.findIndex(v => v.id === vertexId);
  const prevVertex = allVertices[(vertexIndex - 1 + allVertices.length) % allVertices.length];
  const nextVertex = allVertices[(vertexIndex + 1) % allVertices.length];
  
  // Calculate angle from previous vertex
  const angle = Math.atan2(lat - prevVertex.lat, lng - prevVertex.lng) * 180 / Math.PI;
  
  // Find closest snap angle
  const closestSnap = options.snapAngles.reduce((closest, snapAngle) => {
    const diff = Math.abs(((angle - snapAngle + 180) % 360) - 180);
    return diff < Math.abs(((angle - closest + 180) % 360) - 180) ? snapAngle : closest;
  }, options.snapAngles[0]);
  
  const angleDiff = Math.abs(((angle - closestSnap + 180) % 360) - 180);
  
  if (angleDiff <= options.snapThreshold) {
    // Snap to the angle while preserving distance
    const distance = Math.sqrt((lat - prevVertex.lat) ** 2 + (lng - prevVertex.lng) ** 2);
    const snapAngleRad = closestSnap * Math.PI / 180;
    return {
      lat: prevVertex.lat + distance * Math.sin(snapAngleRad),
      lng: prevVertex.lng + distance * Math.cos(snapAngleRad),
      wasSnapped: true
    };
  }
  
  return { lat, lng, wasSnapped: false };
};
```

**9.3 Undo/Redo System:**

```typescript
const [historyIndex, setHistoryIndex] = useState(0);

const pushHistory = () => {
  const newHistory = editHistory.slice(0, historyIndex + 1);
  newHistory.push({ vertices: [...vertices], interiorLines: [...interiorLines] });
  setEditHistory(newHistory);
  setHistoryIndex(newHistory.length - 1);
};

const undo = () => {
  if (historyIndex > 0) {
    setHistoryIndex(historyIndex - 1);
    const prevState = editHistory[historyIndex - 1];
    setVertices(prevState.vertices);
    setInteriorLines(prevState.interiorLines);
  }
};

const redo = () => {
  if (historyIndex < editHistory.length - 1) {
    setHistoryIndex(historyIndex + 1);
    const nextState = editHistory[historyIndex + 1];
    setVertices(nextState.vertices);
    setInteriorLines(nextState.interiorLines);
  }
};

// Keyboard shortcuts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      undo();
    } else if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      redo();
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [historyIndex, editHistory]);
```

---

## Phase 10: Database Persistence Updates

### Goal: Store all new fields in roof_measurements

### Files to Update:
| File | Changes |
|------|---------|
| `supabase/functions/analyze-roof-aerial/index.ts` | Save facets_json, satellite_overlay_url |

### Database Fields (Already Migrated):
- `facets_json` - JSONB
- `satellite_overlay_url` - TEXT
- `vector_diagram_svg` - TEXT
- `measurement_method` - TEXT
- `segmentation_confidence` - DECIMAL
- `qa_passed` - BOOLEAN

### Save Function Update:

```typescript
// At end of runUnifiedAIPipeline, save to database
const { data: savedMeasurement, error: saveError } = await supabase
  .from('roof_measurements')
  .insert({
    customer_id: customerId,
    address,
    lat: coordinates.lat,
    lng: coordinates.lng,
    
    // Core measurements
    total_area_sqft: facetTotals.totalSurfaceAreaSqft,
    plan_area_sqft: facetTotals.totalPlanAreaSqft,
    predominant_pitch: facetTotals.predominantPitch,
    faces_count: facets.length,
    
    // Linear features
    ridge_ft: linearTotals.breakdown.ridge?.total || 0,
    hip_ft: linearTotals.breakdown.hip?.total || 0,
    valley_ft: linearTotals.breakdown.valley?.total || 0,
    eave_ft: linearTotals.breakdown.eave?.total || 0,
    rake_ft: linearTotals.breakdown.rake?.total || 0,
    
    // NEW: Detailed data
    facets_json: facets,
    linear_features_wkt: convertToWKT(segmentationResult.data.linearFeatures),
    perimeter_wkt: polygonToWKT(cleanedPolygon),
    perimeter_vertices: cleanedPolygon,
    
    // NEW: Imagery
    satellite_overlay_url: overlaySvgUrl,
    satellite_image_url: satImage.url,
    
    // NEW: Quality metrics
    measurement_method: 'ai_segmentation',
    segmentation_confidence: segmentationResult.data.qualityMetrics.segmentationConfidence,
    qa_passed: qaResult.overallPass,
    manual_review_recommended: confidence.overallConfidence < 0.7,
    
    // Analysis metadata
    analysis_zoom: 21,
    analysis_image_size: 2560,
    solar_building_footprint_sqft: solarData?.buildingFootprintSqft || null,
    
    created_at: new Date().toISOString()
  })
  .select()
  .single();
```

---

## Phase 11: PullMeasurementsButton Integration

### Goal: Seamless UI flow with new pipeline

### Files to Update:
| File | Changes |
|------|---------|
| `src/components/measurements/PullMeasurementsButton.tsx` | Update toast messages, handle new response |

### Implementation:

```typescript
// Update handlePull to show detailed progress
const handlePull = async (confirmedLat: number, confirmedLng: number) => {
  setLoading(true);
  
  // Step 1: Show satellite fetching
  toast({ title: "Step 1/5", description: "Fetching high-resolution satellite imagery..." });
  
  // Step 2: Invoke new unified pipeline
  const { data, error } = await supabase.functions.invoke('analyze-roof-aerial', {
    body: {
      address,
      coordinates: { lat: confirmedLat, lng: confirmedLng },
      customerId: propertyId,
      useUnifiedPipeline: true  // NEW: Flag to use enhanced pipeline
    }
  });
  
  if (data?.success) {
    // Show confidence-based result
    const confidence = data.data?.confidence?.overallConfidence || 0;
    const qaPass = data.data?.qaResult?.overallPass;
    
    if (confidence >= 0.85 && qaPass) {
      toast({
        title: "High Confidence Measurement",
        description: `Area: ${data.data.facetTotals.totalSurfaceAreaSqft.toLocaleString()} sqft (${(confidence * 100).toFixed(0)}% confidence)`,
      });
    } else {
      toast({
        title: "Measurement Complete - Review Recommended",
        description: `${data.data.facets.length} facets detected. Manual review suggested.`,
        variant: "default"
      });
    }
    
    // Show report preview
    setVerificationData({
      measurement: transformNewMeasurementToLegacyFormat(data.data).measurement,
      tags: transformNewMeasurementToLegacyFormat(data.data).tags,
      satelliteImageUrl: data.data.satelliteImageUrl,
      overlayUrl: data.data.satelliteOverlayUrl
    });
    setShowReportPreview(true);
  }
  
  setLoading(false);
};
```

---

## Phase 12: RoofrStyleReportPreview Enhancements

### Goal: Display actual diagrams instead of placeholders

### Files to Update:
| File | Changes |
|------|---------|
| `src/components/measurements/RoofrStyleReportPreview.tsx` | Render actual satellite overlay, vector diagram |

### Implementation:

**12.1 Replace Placeholder with Real Satellite:**

```tsx
// In RoofrStyleReportPreview, replace the placeholder divs:

{/* PAGE 1: Cover with real satellite overlay */}
<div className="page cover-page">
  {measurement.satellite_overlay_url ? (
    <div className="satellite-with-overlay">
      <img 
        src={measurement.google_image_url || measurement.satellite_image_url} 
        alt="Satellite view"
        className="satellite-image"
      />
      <div 
        className="svg-overlay"
        dangerouslySetInnerHTML={{ __html: measurement.vector_diagram_svg || '' }}
      />
    </div>
  ) : (
    <SchematicRoofDiagram
      measurement={measurement}
      tags={tags}
      showSatelliteOverlay={true}
      satelliteImageUrl={satelliteImageUrl}
    />
  )}
</div>

{/* PAGE 2: Vector schematic */}
<div className="page diagram-page">
  <SchematicRoofDiagram
    measurement={measurement}
    tags={tags}
    width={700}
    height={500}
    showLengthLabels={true}
    showFacets={true}
    showCompass={true}
    showLegend={true}
    showQAPanel={false}
  />
</div>
```

---

## Phase 13: CRM Automation Integration

### Goal: Trigger automations on measurement completion

### Files to Update:
| File | Changes |
|------|---------|
| `src/components/measurements/PullMeasurementsButton.tsx` | Fire MEASUREMENT_COMPLETED event |
| `src/lib/automations/triggerAutomation.ts` | Handle accuracy tier logic |

### Implementation:

```typescript
// After successful measurement save
const handleMeasurementComplete = async (measurement: any, qaResult: any) => {
  // Calculate accuracy tier for automation
  const confidence = measurement.confidence?.overallConfidence || 0;
  let accuracyTier = 'bronze';
  if (confidence >= 0.98) accuracyTier = 'diamond';
  else if (confidence >= 0.95) accuracyTier = 'platinum';
  else if (confidence >= 0.90) accuracyTier = 'gold';
  else if (confidence >= 0.85) accuracyTier = 'silver';
  
  // Trigger automation
  await triggerAutomation(AUTOMATION_EVENTS.MeasurementCompleted, {
    pipelineEntryId: propertyId,
    measurementId: measurement.id,
    totalAreaSqft: measurement.facetTotals?.totalSurfaceAreaSqft,
    facetCount: measurement.facets?.length,
    accuracyTier,
    qaPass: qaResult?.overallPass,
    advanceToMeasured: accuracyTier !== 'bronze'  // Auto-advance if not low confidence
  });
};
```

---

## Phase 14: Testing & Validation Framework

### Goal: Comprehensive test coverage

### Files to Create/Update:
| File | Changes |
|------|---------|
| `supabase/functions/roof-segmentation/index_test.ts` | Unit tests for segmentation |
| `src/components/measurements/MeasurementTestPanel.tsx` | Enhanced test UI |

### Test Cases:

```typescript
// supabase/functions/roof-segmentation/index_test.ts

Deno.test("should detect simple gable roof", async () => {
  const result = await segmentRoof({
    imageBase64: SIMPLE_GABLE_IMAGE,
    lat: 27.9881,
    lng: -82.7329,
    imageSize: 640,
    zoom: 20
  });
  
  assertEquals(result.success, true);
  assertEquals(result.roofType, 'gable');
  assertEquals(result.facets.length, 2);
  assertGreater(result.footprint.areaSqft, 1500);
  assertLess(result.footprint.areaSqft, 3000);
});

Deno.test("should detect complex hip roof", async () => {
  const result = await segmentRoof({
    imageBase64: COMPLEX_HIP_IMAGE,
    lat: 28.0394,
    lng: -81.9498,
    imageSize: 640,
    zoom: 20
  });
  
  assertEquals(result.success, true);
  assertEquals(result.roofType, 'hip');
  assertGreater(result.facets.length, 3);
  assertGreater(result.qualityMetrics.facetClosureScore, 0.8);
});

Deno.test("should detect L-shaped with valley", async () => {
  const result = await segmentRoof({
    imageBase64: L_SHAPED_IMAGE,
    lat: 27.8461,
    lng: -82.6324,
    imageSize: 640,
    zoom: 20
  });
  
  assertEquals(result.success, true);
  const valleys = result.linearFeatures.filter(lf => lf.type === 'valley');
  assertGreater(valleys.length, 0);  // Must detect valley
});
```

---

## Implementation Order

| Order | Phase | Effort | Dependencies |
|-------|-------|--------|--------------|
| 1 | Phase 5: Pipeline Orchestration | 1 day | Phases 1-4 complete |
| 2 | Phase 10: Database Persistence | 0.5 day | Phase 5 |
| 3 | Phase 11: PullMeasurementsButton | 0.5 day | Phase 5, 10 |
| 4 | Phase 6: Satellite Overlay | 1 day | Phase 5 |
| 5 | Phase 8: SchematicDiagram | 1 day | Phase 10 |
| 6 | Phase 12: ReportPreview | 0.5 day | Phase 6, 8 |
| 7 | Phase 7: PDF Report | 1 day | Phase 6, 8 |
| 8 | Phase 9: Manual Editor | 2 days | Phase 10 |
| 9 | Phase 13: Automations | 0.5 day | Phase 11 |
| 10 | Phase 14: Testing | 1 day | All phases |

**Total Estimated Effort: 9 days**

---

## Success Metrics

| Metric | Target | Validation |
|--------|--------|------------|
| End-to-end time | <15 seconds | Stopwatch from click |
| Facet detection | ≥95% accuracy | Compare to vendor reports |
| Area accuracy | ±2% | Compare to EagleView |
| Linear accuracy | ±6 inches | Compare to manual trace |
| QA pass rate | >90% first attempt | Monitor qa_passed column |
| PDF generation | <5 seconds | Performance logging |
| Manual override rate | <10% | Track edit frequency |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| AI timeout | Increase wall_clock_limit to 120s |
| Large images fail | Chunked base64 encoding |
| Complex roofs fail | Fallback to Solar Fast Path |
| SVG overlay rendering | Frontend canvas fallback |
| PDF generation slow | Cache templates, lazy load |
