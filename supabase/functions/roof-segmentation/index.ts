/**
 * Roof Segmentation Edge Function
 * Phase 3: AI Roof Measurement Pipeline Overhaul
 * 
 * Deep learning-based roof segmentation using:
 * 1. Enhanced Gemini 2.5 Vision with optimized prompts
 * 2. Post-processing for polygon cleanup
 * 3. Facet subdivision detection
 * 
 * Returns precise roof footprint polygon and per-facet data.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const AI_TIMEOUT_MS = 45000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// TYPES
// ============================================

interface SegmentationRequest {
  imageBase64: string;  // Preprocessed satellite image
  lat: number;
  lng: number;
  imageSize: number;    // Pixel dimensions
  zoom: number;
  hints?: {
    expectedAreaSqft?: number;
    buildingType?: string;
    knownPerimeterVertices?: number;
  };
}

interface DetectedFacet {
  id: string;
  polygon: Array<{ x: number; y: number }>;  // Pixel coordinates
  polygonGps: Array<{ lat: number; lng: number }>;
  areaSqft: number;
  estimatedPitch: string;
  orientation: string;
  confidence: number;
  requiresReview: boolean;
}

interface LinearFeature {
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  startPixel: { x: number; y: number };
  endPixel: { x: number; y: number };
  startGps: { lat: number; lng: number };
  endGps: { lat: number; lng: number };
  lengthFt: number;
  confidence: number;
}

interface SegmentationResult {
  success: boolean;
  footprint: {
    polygon: Array<{ x: number; y: number }>;
    polygonGps: Array<{ lat: number; lng: number }>;
    areaSqft: number;
    perimeterFt: number;
    vertexCount: number;
    confidence: number;
  };
  facets: DetectedFacet[];
  linearFeatures: LinearFeature[];
  roofType: 'gable' | 'hip' | 'flat' | 'complex' | 'unknown';
  predominantPitch: string;
  qualityMetrics: {
    segmentationConfidence: number;
    facetClosureScore: number;
    edgeContinuityScore: number;
  };
  manualReviewRecommended: boolean;
  processingTimeMs: number;
  error?: string;
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const request: SegmentationRequest = await req.json();
    
    console.log(`🔍 Roof segmentation starting at (${request.lat.toFixed(6)}, ${request.lng.toFixed(6)})`);
    console.log(`📐 Image: ${request.imageSize}x${request.imageSize} @ zoom ${request.zoom}`);
    
    if (request.hints?.expectedAreaSqft) {
      console.log(`💡 Hint: Expected area ~${request.hints.expectedAreaSqft} sqft`);
    }

    // Run AI segmentation
    const segmentationResult = await runAISegmentation(request);
    
    // Post-process and validate
    const processedResult = postProcessSegmentation(segmentationResult, request);
    
    processedResult.processingTimeMs = Date.now() - startTime;
    
    console.log(`✅ Segmentation complete in ${processedResult.processingTimeMs}ms`);
    console.log(`   Footprint: ${processedResult.footprint.areaSqft.toFixed(0)} sqft, ${processedResult.footprint.vertexCount} vertices`);
    console.log(`   Facets: ${processedResult.facets.length}, Type: ${processedResult.roofType}`);

    return new Response(JSON.stringify(processedResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Segmentation error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown segmentation error',
      processingTimeMs: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ============================================
// AI SEGMENTATION
// ============================================

async function runAISegmentation(request: SegmentationRequest): Promise<any> {
  const prompt = buildSegmentationPrompt(request);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: request.imageBase64 } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API error: ${response.status} - ${errorText}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || '';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON in AI response');
    }

    return JSON.parse(jsonMatch[0]);

  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSegmentationPrompt(request: SegmentationRequest): string {
  const areaHint = request.hints?.expectedAreaSqft 
    ? `Expected roof area is approximately ${request.hints.expectedAreaSqft} square feet.`
    : '';
  
  return `You are an expert roof measurement AI analyzing a satellite image of a residential property.

TASK: Detect and segment the roof structure with high precision.

IMAGE INFORMATION:
- Size: ${request.imageSize}x${request.imageSize} pixels
- Center coordinates: (${request.lat.toFixed(6)}, ${request.lng.toFixed(6)})
- Zoom level: ${request.zoom}
${areaHint}

DETECTION REQUIREMENTS:

1. ROOF FOOTPRINT (outer boundary):
   - Trace the exact perimeter of the roof including all projections
   - Include eave overhangs (typically 1-2 feet beyond walls)
   - Provide coordinates as pixel positions (0-${request.imageSize})
   - Minimum 4 vertices for simple roofs, more for complex shapes
   - Ensure polygon is CLOSED (last vertex connects to first)

2. ROOF FACETS (individual roof planes):
   - Detect each distinct roof plane as a separate facet
   - Gable roofs: 2 facets (front/back)
   - Hip roofs: 4 facets (2 triangular ends + 2 trapezoidal sides)
   - Complex roofs: Identify all distinct planes
   - For each facet, estimate pitch (X/12 format) and compass orientation

3. LINEAR FEATURES (structural lines):
   - RIDGES: Horizontal peak lines (light green)
   - HIPS: Diagonal lines from corners going up (purple)
   - VALLEYS: Inward diagonal lines where planes meet (red)
   - EAVES: Horizontal bottom edges (cyan) - part of perimeter
   - RAKES: Sloped gable edges (orange) - part of perimeter

COORDINATE SYSTEM:
- Origin (0,0) is TOP-LEFT of image
- X increases rightward (0 to ${request.imageSize})
- Y increases downward (0 to ${request.imageSize})

RESPOND WITH VALID JSON ONLY:
{
  "footprint": {
    "vertices": [{"x": N, "y": N}, ...],
    "confidence": 0.0-1.0
  },
  "facets": [
    {
      "id": "F1",
      "vertices": [{"x": N, "y": N}, ...],
      "estimated_pitch": "6/12",
      "orientation": "N|S|E|W|NE|NW|SE|SW",
      "confidence": 0.0-1.0
    }
  ],
  "linear_features": [
    {
      "type": "ridge|hip|valley|eave|rake",
      "start": {"x": N, "y": N},
      "end": {"x": N, "y": N},
      "confidence": 0.0-1.0
    }
  ],
  "roof_type": "gable|hip|flat|complex",
  "predominant_pitch": "X/12",
  "overall_confidence": 0.0-1.0
}

CRITICAL ACCURACY REQUIREMENTS:
- Footprint must fully contain the actual roof (no under-tracing)
- Facet polygons must tile without gaps or overlaps
- All linear features must connect to vertices
- Coordinate values must be valid integers within image bounds`;
}

// ============================================
// POST-PROCESSING
// ============================================

function postProcessSegmentation(
  aiResult: any,
  request: SegmentationRequest
): SegmentationResult {
  // Calculate geo bounds for coordinate conversion
  const metersPerPixel = 156543.03392 * Math.cos(request.lat * Math.PI / 180) / Math.pow(2, request.zoom);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(request.lat * Math.PI / 180);

  // Convert pixel to GPS helper
  const pixelToGps = (pixel: { x: number; y: number }) => {
    const offsetX = pixel.x - request.imageSize / 2;
    const offsetY = request.imageSize / 2 - pixel.y;  // Flip Y
    const lng = request.lng + (offsetX * metersPerPixel / metersPerDegreeLng);
    const lat = request.lat + (offsetY * metersPerPixel / metersPerDegreeLat);
    return { lat, lng };
  };

  // Calculate distance in feet
  const calculateDistanceFt = (p1: { lat: number; lng: number }, p2: { lat: number; lng: number }) => {
    const dLat = (p2.lat - p1.lat) * metersPerDegreeLat;
    const dLng = (p2.lng - p1.lng) * metersPerDegreeLng;
    return Math.sqrt(dLat * dLat + dLng * dLng) * 3.28084;
  };

  // Process footprint
  const footprintVertices = aiResult.footprint?.vertices || [];
  const footprintGps = footprintVertices.map(pixelToGps);
  
  // Calculate footprint area using Shoelace formula
  let footprintAreaSqft = 0;
  if (footprintGps.length >= 3) {
    const localVertices = footprintGps.map((v: { lat: number; lng: number }) => ({
      x: v.lng * metersPerDegreeLng,
      y: v.lat * metersPerDegreeLat,
    }));
    
    let sum = 0;
    for (let i = 0; i < localVertices.length; i++) {
      const j = (i + 1) % localVertices.length;
      sum += localVertices[i].x * localVertices[j].y;
      sum -= localVertices[j].x * localVertices[i].y;
    }
    footprintAreaSqft = Math.abs(sum / 2) * 10.764;  // m² to ft²
  }

  // Calculate perimeter
  let perimeterFt = 0;
  for (let i = 0; i < footprintGps.length; i++) {
    const j = (i + 1) % footprintGps.length;
    perimeterFt += calculateDistanceFt(footprintGps[i], footprintGps[j]);
  }

  // Process facets
  const facets: DetectedFacet[] = (aiResult.facets || []).map((f: any, idx: number) => {
    const facetGps = (f.vertices || []).map(pixelToGps);
    
    // Calculate facet area
    let facetArea = 0;
    if (facetGps.length >= 3) {
      const local = facetGps.map((v: { lat: number; lng: number }) => ({
        x: v.lng * metersPerDegreeLng,
        y: v.lat * metersPerDegreeLat,
      }));
      let sum = 0;
      for (let i = 0; i < local.length; i++) {
        const j = (i + 1) % local.length;
        sum += local[i].x * local[j].y;
        sum -= local[j].x * local[i].y;
      }
      facetArea = Math.abs(sum / 2) * 10.764;
    }

    return {
      id: f.id || `F${idx + 1}`,
      polygon: f.vertices || [],
      polygonGps: facetGps,
      areaSqft: facetArea,
      estimatedPitch: f.estimated_pitch || '6/12',
      orientation: f.orientation || 'unknown',
      confidence: f.confidence || 0.7,
      requiresReview: (f.confidence || 0) < 0.7,
    };
  });

  // Process linear features
  const linearFeatures: LinearFeature[] = (aiResult.linear_features || []).map((lf: any, idx: number) => {
    const startGps = pixelToGps(lf.start);
    const endGps = pixelToGps(lf.end);
    const lengthFt = calculateDistanceFt(startGps, endGps);

    return {
      id: `${lf.type?.toUpperCase() || 'L'}-${idx + 1}`,
      type: lf.type || 'ridge',
      startPixel: lf.start,
      endPixel: lf.end,
      startGps,
      endGps,
      lengthFt,
      confidence: lf.confidence || 0.7,
    };
  });

  // Quality metrics
  const segmentationConfidence = aiResult.overall_confidence || 0.7;
  const facetClosureScore = calculateFacetClosureScore(facets);
  const edgeContinuityScore = calculateEdgeContinuityScore(linearFeatures);

  // Determine if manual review needed
  const manualReviewRecommended = 
    segmentationConfidence < 0.7 ||
    footprintVertices.length < 4 ||
    facets.length === 0 ||
    facetClosureScore < 0.8;

  return {
    success: true,
    footprint: {
      polygon: footprintVertices,
      polygonGps: footprintGps,
      areaSqft: footprintAreaSqft,
      perimeterFt,
      vertexCount: footprintVertices.length,
      confidence: aiResult.footprint?.confidence || 0.7,
    },
    facets,
    linearFeatures,
    roofType: aiResult.roof_type || 'unknown',
    predominantPitch: aiResult.predominant_pitch || '6/12',
    qualityMetrics: {
      segmentationConfidence,
      facetClosureScore,
      edgeContinuityScore,
    },
    manualReviewRecommended,
    processingTimeMs: 0,
  };
}

// ============================================
// QUALITY CHECKS
// ============================================

function calculateFacetClosureScore(facets: DetectedFacet[]): number {
  if (facets.length === 0) return 0;
  
  // Check that each facet polygon is properly closed
  let closedCount = 0;
  for (const facet of facets) {
    if (facet.polygon.length >= 3) {
      const first = facet.polygon[0];
      const last = facet.polygon[facet.polygon.length - 1];
      const distance = Math.sqrt(
        Math.pow(first.x - last.x, 2) + Math.pow(first.y - last.y, 2)
      );
      if (distance < 5) {  // Within 5 pixels = closed
        closedCount++;
      }
    }
  }
  
  return closedCount / facets.length;
}

function calculateEdgeContinuityScore(linearFeatures: LinearFeature[]): number {
  if (linearFeatures.length === 0) return 0.5;
  
  // Check that linear features have reasonable lengths
  const validFeatures = linearFeatures.filter(lf => 
    lf.lengthFt >= 3 && lf.lengthFt <= 100
  );
  
  return validFeatures.length / linearFeatures.length;
}
