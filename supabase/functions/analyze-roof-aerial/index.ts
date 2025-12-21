import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

// Import worksheet engine - single source of truth for calculations
import {
  parsePitch,
  getSlopeFactorFromPitch,
  calculateSurfaceArea,
  sumLinearSegments,
  recommendWaste,
  calculateOrder,
  runQCChecks,
  buildWorksheetFromAI,
  convertPerimeterToPlane,
  convertAILinesToSegments,
  deriveComplexityFromSegments,
  type PitchInfo,
  type LinearSegment,
  type WorksheetJSON,
} from '../_shared/roofWorksheetEngine.ts'

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!
const GOOGLE_SOLAR_API_KEY = Deno.env.get('GOOGLE_SOLAR_API_KEY')!
const MAPBOX_PUBLIC_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const IMAGE_ZOOM = 20
const IMAGE_SIZE = 640

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Vertex {
  x: number;
  y: number;
  type: 'perimeter' | 'ridge-end' | 'hip-junction' | 'valley-junction' | 'corner';
}

interface DerivedLine {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  source: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()
  
  try {
    const { address, coordinates, customerId, userId } = await req.json()
    console.log('🏠 Analyzing roof:', address)
    console.log('📍 Coordinates:', coordinates.lat, coordinates.lng)

    // STREAMLINED: Fetch imagery and Solar API data in parallel
    const [googleImage, solarData, mapboxImage] = await Promise.all([
      fetchGoogleStaticMap(coordinates),
      fetchGoogleSolarData(coordinates),
      fetchMapboxSatellite(coordinates)
    ])
    
    console.log(`⏱️ Image fetch complete: ${Date.now() - startTime}ms`)

    // Select best image (prefer Google Maps for better measurement accuracy)
    const selectedImage = googleImage.url ? googleImage : mapboxImage
    const imageSource = selectedImage.source
    const imageYear = new Date().getFullYear()
    
    // CRITICAL FIX: For coordinate conversion, we use LOGICAL size (what the zoom level represents)
    // Mapbox @2x returns 1280px but represents the same geographic area as 640px at zoom 20
    // The AI sees percentage coordinates (0-100), so image pixel dimensions don't matter for detection
    // But for WKT conversion, we need the LOGICAL size that matches the zoom level
    const logicalImageSize = 640  // This is the size at zoom 20 that determines meters-per-pixel
    const actualImageSize = selectedImage.source === 'mapbox' ? 1280 : 640  // For logging only
    
    console.log(`✅ Using: ${imageSource} (${actualImageSize}x${actualImageSize} pixels, ${logicalImageSize}x${logicalImageSize} logical)`)

    // NEW VERTEX-BASED DETECTION APPROACH (Roofr-quality)
    // Pass 1: Isolate target building and get perimeter vertices
    const buildingIsolation = await isolateTargetBuilding(selectedImage.url, address, coordinates)
    console.log(`⏱️ Pass 1 (building isolation) complete: ${Date.now() - startTime}ms`)
    
    // Pass 2: Detect perimeter vertices (roof polygon corners)
    const perimeterResult = await detectPerimeterVertices(selectedImage.url, buildingIsolation.bounds)
    console.log(`⏱️ Pass 2 (perimeter vertices) complete: ${Date.now() - startTime}ms`)
    
    // Pass 3: Detect interior junction vertices (where ridges/hips/valleys meet)
    const interiorVertices = await detectInteriorJunctions(selectedImage.url, perimeterResult.vertices, buildingIsolation.bounds)
    console.log(`⏱️ Pass 3 (interior junctions) complete: ${Date.now() - startTime}ms`)
    
    // Derive lines from vertices (instead of arbitrary AI-detected lines)
    const derivedLines = deriveLinesToPerimeter(
      perimeterResult.vertices, 
      interiorVertices.junctions,
      interiorVertices.ridgeEndpoints,
      buildingIsolation.bounds
    )
    console.log(`⏱️ Line derivation complete: ${derivedLines.length} lines from vertices`)
    
    // Calculate actual roof area from perimeter vertices using Shoelace formula
    const actualAreaSqft = calculateAreaFromPerimeterVertices(
      perimeterResult.vertices,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    console.log(`📐 Calculated area from perimeter: ${actualAreaSqft.toFixed(0)} sqft`)
    
    // Derive facet count from roof geometry (perimeter vertices and interior junctions)
    const derivedFacetCount = deriveFacetCountFromGeometry(
      perimeterResult.vertices,
      interiorVertices.junctions,
      perimeterResult.roofType
    )
    console.log(`📐 Derived facet count: ${derivedFacetCount}`)
    
    // Convert legacy AI analysis format for backward compatibility
    const aiAnalysis = {
      roofType: perimeterResult.roofType || 'complex',
      facets: [{
        facetNumber: 1,
        shape: 'complex',
        estimatedPitch: '5/12',
        pitchConfidence: 'medium',
        estimatedAreaSqft: actualAreaSqft, // Use calculated area instead of hardcoded 1500
        edges: { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0 },
        features: { chimneys: 0, skylights: 0, vents: 0 },
        orientation: 'mixed'
      }],
      boundingBox: buildingIsolation.bounds,
      roofPerimeter: perimeterResult.vertices,
      edgeSegments: [],
      overallComplexity: perimeterResult.complexity || 'moderate',
      shadowAnalysis: { estimatedPitchRange: '4/12 to 7/12', confidence: 'medium' },
      detectionNotes: 'Vertex-based detection',
      derivedFacetCount // Store for later use
    }
    
    const scale = calculateScale(solarData, selectedImage, aiAnalysis)
    
    // Pre-calculate linear features to use in measurements
    const preLinearFeatures = convertDerivedLinesToWKT(
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    
    // Calculate linear totals from WKT features
    const linearTotalsFromWKT = calculateLinearTotalsFromWKT(preLinearFeatures)
    console.log(`📐 Linear totals from WKT:`, linearTotalsFromWKT)
    
    const measurements = calculateDetailedMeasurements(aiAnalysis, scale, solarData, linearTotalsFromWKT)
    const confidence = calculateConfidenceScore(aiAnalysis, measurements, solarData, selectedImage)
    
    // Convert derived lines to WKT (these are CONSTRAINED to perimeter)
    // Use LOGICAL image size for proper geographic coordinate conversion
    const linearFeatures = convertDerivedLinesToWKT(
      derivedLines,
      coordinates,
      logicalImageSize,  // FIXED: Use logical size, not actual pixel size
      IMAGE_ZOOM
    )
    
    // Convert perimeter to WKT polygon
    const perimeterWkt = convertPerimeterToWKT(
      perimeterResult.vertices,
      coordinates,
      logicalImageSize,  // FIXED: Use logical size
      IMAGE_ZOOM
    )

    console.log(`📏 Generated ${linearFeatures.length} vertex-derived linear features`)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const measurementRecord = await saveMeasurementToDatabase(supabase, {
      address, coordinates, customerId, userId, googleImage, mapboxImage,
      selectedImage, solarData, aiAnalysis, scale, measurements, confidence,
      linearFeatures, imageSource, imageYear, perimeterWkt,
      visionEdges: { ridges: [], hips: [], valleys: [] }, // Replaced by vertex detection
      imageSize: logicalImageSize  // Store logical size for overlay rendering
    })
    
    const totalTime = Date.now() - startTime
    console.log(`✅ Complete in ${totalTime}ms! Confidence: ${confidence.score}%`)

    return new Response(JSON.stringify({
      success: true,
      measurementId: measurementRecord.id,
      timing: { totalMs: totalTime },
      data: {
        address, coordinates,
        images: { google: googleImage.url ? 'available' : 'unavailable', mapbox: mapboxImage.url ? 'available' : 'unavailable', selected: selectedImage.source },
        solarApiData: {
          available: solarData.available,
          buildingFootprint: solarData.buildingFootprintSqft,
          roofSegments: solarData.roofSegmentCount,
          linearFeatures: linearFeatures.length
        },
        aiAnalysis: {
          roofType: aiAnalysis.roofType,
          facetCount: aiAnalysis.facets.length,
          complexity: aiAnalysis.overallComplexity,
          pitch: measurements.predominantPitch,
          boundingBox: aiAnalysis.boundingBox,
          vertexDetection: {
            perimeterVertices: perimeterResult.vertices.length,
            interiorJunctions: interiorVertices.junctions.length,
            derivedLines: derivedLines.length
          }
        },
        measurements: {
          totalAreaSqft: measurements.totalAdjustedArea,
          totalSquares: measurements.totalSquares,
          wasteFactor: measurements.wasteFactor,
          facets: measurements.facets,
          linear: measurements.linearMeasurements,
          materials: measurements.materials,
          predominantPitch: measurements.predominantPitch,
          linearFeaturesWkt: linearFeatures,
          analysisZoom: IMAGE_ZOOM,
          analysisImageSize: { width: IMAGE_SIZE, height: IMAGE_SIZE }
        },
        linearFeaturesWkt: linearFeatures,
        perimeterWkt,
        analysisZoom: IMAGE_ZOOM,
        analysisImageSize: { width: IMAGE_SIZE, height: IMAGE_SIZE },
        confidence: {
          score: confidence.score,
          rating: confidence.rating,
          factors: confidence.factors,
          requiresReview: confidence.requiresReview
        },
        scale: {
          pixelsPerFoot: scale.pixelsPerFoot,
          method: scale.method,
          confidence: scale.confidence
        }
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('❌ Error:', error)
    return new Response(JSON.stringify({ success: false, error: error.message, stack: error.stack }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

async function fetchGoogleStaticMap(coords: any) {
  try {
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${coords.lat},${coords.lng}&zoom=20&size=640x640&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`
    const response = await fetch(url)
    if (!response.ok) {
      console.error('Google Maps fetch failed:', response.status)
      return { url: null, source: 'google_maps', resolution: '640x640', quality: 0 }
    }
    const buffer = await response.arrayBuffer()
    const base64 = base64Encode(new Uint8Array(buffer))
    return { url: `data:image/png;base64,${base64}`, source: 'google_maps', resolution: '640x640', quality: 8 }
  } catch (err) {
    console.error('Google Maps error:', err)
    return { url: null, source: 'google_maps', resolution: '640x640', quality: 0 }
  }
}

async function fetchGoogleSolarData(coords: any) {
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${coords.lat}&location.longitude=${coords.lng}&key=${GOOGLE_SOLAR_API_KEY}`
    const response = await fetch(url)
    if (!response.ok) return { available: false, buildingFootprintSqft: null, roofSegmentCount: 0, linearFeatures: [] }
    const data = await response.json()
    const buildingFootprintSqm = data.solarPotential?.buildingStats?.areaMeters2 || 0
    const buildingFootprintSqft = buildingFootprintSqm * 10.764
    const roofSegments = data.solarPotential?.roofSegmentStats || []
    const boundingBox = data.boundingBox || null
    
    return {
      available: true,
      buildingFootprintSqft,
      roofSegmentCount: roofSegments.length,
      roofSegments: roofSegments.map((s: any) => ({ 
        pitchDegrees: s.pitchDegrees, 
        azimuthDegrees: s.azimuthDegrees, 
        areaMeters2: s.stats?.areaMeters2,
        planeHeightAtCenter: s.planeHeightAtCenterMeters,
        boundingBox: s.boundingBox
      })),
      boundingBox,
      rawData: data
    }
  } catch (err) {
    console.error('Google Solar API error:', err)
    return { available: false, buildingFootprintSqft: null, roofSegmentCount: 0, linearFeatures: [] }
  }
}

async function fetchMapboxSatellite(coords: any) {
  try {
    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${coords.lng},${coords.lat},20,0/640x640@2x?access_token=${MAPBOX_PUBLIC_TOKEN}`
    const response = await fetch(url)
    if (!response.ok) {
      console.error('Mapbox fetch failed:', response.status)
      return { url: null, source: 'mapbox', resolution: '1280x1280', quality: 0 }
    }
    const buffer = await response.arrayBuffer()
    const base64 = base64Encode(new Uint8Array(buffer))
    return { url: `data:image/png;base64,${base64}`, source: 'mapbox', resolution: '1280x1280', quality: 9 }
  } catch (err) {
    console.error('Mapbox error:', err)
    return { url: null, source: 'mapbox', resolution: '1280x1280', quality: 0 }
  }
}

// PASS 1: Isolate target building - exclude adjacent structures
// CRITICAL FIX: The target building is at the EXACT CENTER of the image
// A typical residential roof is ~40-60 feet, which at zoom 20 is about 15-25% of a 640px image
async function isolateTargetBuilding(imageUrl: string, address: string, coordinates: { lat: number; lng: number }) {
  if (!imageUrl) {
    // Default: small centered box for residential
    return { bounds: { topLeftX: 35, topLeftY: 35, bottomRightX: 65, bottomRightY: 65 }, confidence: 'low' }
  }

  const prompt = `You are a roof measurement expert. Analyze this satellite image.

TASK: Find the MAIN RESIDENTIAL BUILDING at the EXACT CENTER of the image.
The GPS coordinates point to the center of this image, so the target house is in the middle.

Return a TIGHT bounding box that wraps ONLY the main roof:

{
  "targetBuildingBounds": {
    "topLeftX": 38.5,
    "topLeftY": 32.0,
    "bottomRightX": 61.5,
    "bottomRightY": 68.0
  },
  "estimatedRoofWidthFt": 45,
  "estimatedRoofLengthFt": 55,
  "otherBuildingsDetected": 1,
  "targetBuildingType": "residential",
  "confidenceTargetIsCorrect": "high"
}

CRITICAL RULES:
1. The main house is CENTERED in the image (around 40-60% x and y range typically)
2. Typical residential roofs are 35-65ft wide, which is about 15-30% of image width
3. Do NOT include sheds, garages, driveways, pools, or adjacent properties
4. A bounding box larger than 40% of image width is likely WRONG
5. Use DECIMAL precision (e.g., 38.72, not 39)
6. Return ONLY valid JSON, no explanation`

  console.log('🏠 Pass 1: Isolating target building at image center...')
  
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 800
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Building isolation failed:', data)
      return { bounds: { topLeftX: 35, topLeftY: 35, bottomRightX: 65, bottomRightY: 65 }, confidence: 'low' }
    }
    
    let content = data.choices[0].message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    const result = JSON.parse(content)
    let bounds = result.targetBuildingBounds || { topLeftX: 35, topLeftY: 35, bottomRightX: 65, bottomRightY: 65 }
    
    // VALIDATION: Ensure bounds are reasonable for residential
    const width = bounds.bottomRightX - bounds.topLeftX
    const height = bounds.bottomRightY - bounds.topLeftY
    
    // If detected bounds are too large (>45% of image), likely wrong - use tighter default
    if (width > 45 || height > 45) {
      console.warn(`⚠️ Detected bounds too large (${width.toFixed(1)}% x ${height.toFixed(1)}%), using centered default`)
      bounds = { topLeftX: 35, topLeftY: 35, bottomRightX: 65, bottomRightY: 65 }
    }
    
    // Ensure building is centered (within 30-70% range)
    const centerX = (bounds.topLeftX + bounds.bottomRightX) / 2
    const centerY = (bounds.topLeftY + bounds.bottomRightY) / 2
    if (centerX < 30 || centerX > 70 || centerY < 30 || centerY > 70) {
      console.warn(`⚠️ Building not centered (center at ${centerX.toFixed(1)}%, ${centerY.toFixed(1)}%), adjusting`)
      // Shift bounds to center
      const shiftX = 50 - centerX
      const shiftY = 50 - centerY
      bounds = {
        topLeftX: bounds.topLeftX + shiftX,
        topLeftY: bounds.topLeftY + shiftY,
        bottomRightX: bounds.bottomRightX + shiftX,
        bottomRightY: bounds.bottomRightY + shiftY
      }
    }
    
    console.log(`✅ Pass 1 complete: target bounds (${bounds.topLeftX.toFixed(1)}%, ${bounds.topLeftY.toFixed(1)}%) to (${bounds.bottomRightX.toFixed(1)}%, ${bounds.bottomRightY.toFixed(1)}%), ${result.otherBuildingsDetected || 0} other buildings excluded`)
    
    return { 
      bounds, 
      otherBuildings: result.otherBuildingsDetected || 0,
      confidence: result.confidenceTargetIsCorrect || 'medium',
      estimatedDimensions: {
        widthFt: result.estimatedRoofWidthFt || 50,
        lengthFt: result.estimatedRoofLengthFt || 50
      }
    }
  } catch (err) {
    console.error('Building isolation error:', err)
    return { bounds: { topLeftX: 35, topLeftY: 35, bottomRightX: 65, bottomRightY: 65 }, confidence: 'low' }
  }
}

// PASS 2: Detect perimeter vertices (roof polygon corners)
async function detectPerimeterVertices(imageUrl: string, bounds: any) {
  if (!imageUrl) {
    return { vertices: [], roofType: 'unknown', complexity: 'moderate' }
  }

  const prompt = `You are a roof measurement expert. Trace the EXACT roof boundary as a CLOSED POLYGON.

TASK: Return the roof perimeter as a list of CORNER VERTICES in CLOCKWISE order.
Start from the topmost corner and trace around the entire visible roof edge.

The target building is within bounds: top-left (${bounds.topLeftX}%, ${bounds.topLeftY}%) to bottom-right (${bounds.bottomRightX}%, ${bounds.bottomRightY}%)

{
  "roofType": "hip|gable|complex",
  "complexity": "simple|moderate|complex",
  "vertices": [
    {"x": 30.5, "y": 25.2, "cornerType": "hip-corner"},
    {"x": 50.0, "y": 24.8, "cornerType": "ridge-end"},
    {"x": 70.2, "y": 25.5, "cornerType": "hip-corner"},
    {"x": 72.0, "y": 50.0, "cornerType": "eave-corner"},
    {"x": 70.5, "y": 75.0, "cornerType": "hip-corner"},
    {"x": 50.0, "y": 76.2, "cornerType": "ridge-end"},
    {"x": 30.0, "y": 75.5, "cornerType": "hip-corner"},
    {"x": 28.0, "y": 50.0, "cornerType": "eave-corner"}
  ]
}

CRITICAL RULES:
- Use DECIMAL PRECISION (e.g., 34.72 not 35)
- Trace the EXACT visible roof edge (follow shadow lines and shingle patterns)
- Include EVERY corner where the roof perimeter changes direction
- cornerType: "hip-corner" (where hip meets eave), "ridge-end" (gable peak), "eave-corner" (horizontal edge corner), "valley-entry" (where valley meets perimeter)
- Stay WITHIN the target building bounds
- Return ONLY valid JSON, no explanation`

  console.log('📐 Pass 2: Detecting perimeter vertices...')
  
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 1500
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Perimeter detection failed:', data)
      return { vertices: createFallbackPerimeter(bounds), roofType: 'unknown', complexity: 'moderate' }
    }
    
    let content = data.choices[0].message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    // Fix truncated JSON
    if (!content.endsWith('}')) {
      const openBraces = (content.match(/{/g) || []).length
      const closeBraces = (content.match(/}/g) || []).length
      for (let i = 0; i < openBraces - closeBraces; i++) content += '}'
    }
    
    const result = JSON.parse(content)
    const vertices = result.vertices || []
    
    // Validate vertices are within bounds
    const validVertices = vertices.filter((v: any) => 
      v.x >= bounds.topLeftX - 5 && v.x <= bounds.bottomRightX + 5 &&
      v.y >= bounds.topLeftY - 5 && v.y <= bounds.bottomRightY + 5
    )
    
    console.log(`✅ Pass 2 complete: ${validVertices.length} perimeter vertices detected, roofType: ${result.roofType}`)
    
    return { 
      vertices: validVertices.length >= 4 ? validVertices : createFallbackPerimeter(bounds),
      roofType: result.roofType || 'complex',
      complexity: result.complexity || 'moderate'
    }
  } catch (err) {
    console.error('Perimeter detection error:', err)
    return { vertices: createFallbackPerimeter(bounds), roofType: 'unknown', complexity: 'moderate' }
  }
}

function createFallbackPerimeter(bounds: any): Vertex[] {
  return [
    { x: bounds.topLeftX, y: bounds.topLeftY, type: 'corner' },
    { x: bounds.bottomRightX, y: bounds.topLeftY, type: 'corner' },
    { x: bounds.bottomRightX, y: bounds.bottomRightY, type: 'corner' },
    { x: bounds.topLeftX, y: bounds.bottomRightY, type: 'corner' }
  ]
}

// PASS 3: Detect interior junction points (where ridges/hips/valleys meet)
async function detectInteriorJunctions(imageUrl: string, perimeterVertices: any[], bounds: any) {
  if (!imageUrl || perimeterVertices.length < 4) {
    return { junctions: [], ridgeEndpoints: [] }
  }

  const prompt = `You are a roof measurement expert. Detect the INTERIOR JUNCTION POINTS where roof features meet.

The roof perimeter has been traced. Now identify the INTERIOR vertices:
- Where ridge lines meet hip lines (ridge-hip junction)
- Where multiple hips converge (hip-junction)
- Where valleys meet other features (valley-junction)

{
  "junctions": [
    {"x": 35.5, "y": 48.0, "type": "ridge-hip-junction"},
    {"x": 65.2, "y": 47.5, "type": "ridge-hip-junction"}
  ],
  "ridgeEndpoints": [
    {"x": 35.5, "y": 48.0},
    {"x": 65.2, "y": 47.5}
  ],
  "valleyJunctions": [],
  "roofPeakType": "single-ridge|multiple-ridge|hip-peak"
}

CRITICAL RULES:
- Junction points are INSIDE the roof, not on the perimeter
- These are the peak points where roof planes meet
- Ridge endpoints are where the main ridge line terminates
- Use DECIMAL PRECISION (e.g., 45.72)
- Stay WITHIN bounds: (${bounds.topLeftX}%, ${bounds.topLeftY}%) to (${bounds.bottomRightX}%, ${bounds.bottomRightY}%)
- Return ONLY valid JSON`

  console.log('🔺 Pass 3: Detecting interior junction vertices...')
  
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 1000
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Junction detection failed:', data)
      return { junctions: [], ridgeEndpoints: [] }
    }
    
    let content = data.choices[0].message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    const result = JSON.parse(content)
    const junctions = result.junctions || []
    const ridgeEndpoints = result.ridgeEndpoints || []
    
    console.log(`✅ Pass 3 complete: ${junctions.length} junction points, ${ridgeEndpoints.length} ridge endpoints`)
    
    return { 
      junctions,
      ridgeEndpoints,
      valleyJunctions: result.valleyJunctions || [],
      peakType: result.roofPeakType
    }
  } catch (err) {
    console.error('Junction detection error:', err)
    return { junctions: [], ridgeEndpoints: [] }
  }
}

// DERIVE LINES FROM VERTICES (the key improvement over arbitrary line detection)
function deriveLinesToPerimeter(
  perimeterVertices: any[], 
  junctions: any[],
  ridgeEndpoints: any[],
  bounds: any
): DerivedLine[] {
  const lines: DerivedLine[] = []
  
  // 1. RIDGE LINES: Connect ridge endpoints
  if (ridgeEndpoints.length >= 2) {
    // Sort by X to connect left-to-right
    const sortedRidges = [...ridgeEndpoints].sort((a, b) => a.x - b.x)
    for (let i = 0; i < sortedRidges.length - 1; i++) {
      lines.push({
        type: 'ridge',
        startX: sortedRidges[i].x,
        startY: sortedRidges[i].y,
        endX: sortedRidges[i + 1].x,
        endY: sortedRidges[i + 1].y,
        source: 'vertex_derived'
      })
    }
  } else if (junctions.length >= 2) {
    // Fallback: use junctions as ridge endpoints
    const ridgeJunctions = junctions.filter((j: any) => 
      j.type?.includes('ridge') || j.type?.includes('hip')
    )
    const sortedJunctions = [...ridgeJunctions].sort((a, b) => a.x - b.x)
    for (let i = 0; i < sortedJunctions.length - 1; i++) {
      lines.push({
        type: 'ridge',
        startX: sortedJunctions[i].x,
        startY: sortedJunctions[i].y,
        endX: sortedJunctions[i + 1].x,
        endY: sortedJunctions[i + 1].y,
        source: 'vertex_derived'
      })
    }
  }
  
  // 2. HIP LINES: Connect ridge endpoints/junctions to hip-corners on perimeter
  const hipCorners = perimeterVertices.filter((v: any) => 
    v.cornerType === 'hip-corner' || v.type === 'hip-corner'
  )
  
  const allRidgePoints = ridgeEndpoints.length > 0 ? ridgeEndpoints : 
    junctions.filter((j: any) => j.type?.includes('ridge') || j.type?.includes('hip'))
  
  hipCorners.forEach((corner: any) => {
    // Find nearest ridge point to connect to
    const nearestRidge = findNearestPoint(corner, allRidgePoints)
    if (nearestRidge) {
      lines.push({
        type: 'hip',
        startX: nearestRidge.x,
        startY: nearestRidge.y,
        endX: corner.x,
        endY: corner.y,
        source: 'vertex_derived'
      })
    }
  })
  
  // 3. VALLEY LINES: Connect valley entries to interior valley junctions
  const valleyEntries = perimeterVertices.filter((v: any) => 
    v.cornerType === 'valley-entry' || v.type === 'valley-entry'
  )
  const valleyJunctions = junctions.filter((j: any) => 
    j.type?.includes('valley')
  )
  
  valleyEntries.forEach((entry: any) => {
    const nearestValleyJunction = findNearestPoint(entry, valleyJunctions)
    if (nearestValleyJunction) {
      lines.push({
        type: 'valley',
        startX: nearestValleyJunction.x,
        startY: nearestValleyJunction.y,
        endX: entry.x,
        endY: entry.y,
        source: 'vertex_derived'
      })
    }
  })
  
  // 4 & 5. EAVE and RAKE LINES: Classify perimeter edges based on INTERSECTING FEATURES
  // CRITICAL FIX: Classification is based on what features intersect each edge:
  // - RAKE: Perimeter edge where a RIDGE terminates/intersects (gable ends)
  // - EAVE: Perimeter edge where only VALLEYS or HIPS intersect (no ridges)
  // - HIP ROOFS: Have ALL eaves, NO rakes (ridges don't reach perimeter)
  // - GABLE ROOFS: Have eaves + rakes at gable peaks where ridge terminates
  
  // Get all ridge lines (to check if they terminate at perimeter)
  const ridgeLines = lines.filter(l => l.type === 'ridge')
  const hipLines = lines.filter(l => l.type === 'hip')
  const valleyLines = lines.filter(l => l.type === 'valley')
  
  // Helper: Check if a point is near another point (within threshold)
  const pointNearPoint = (p1: {x: number, y: number}, p2: {x: number, y: number}, threshold = 5): boolean => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)) < threshold
  }
  
  // Helper: Check if a line terminates at or near this edge
  const lineIntersectsEdge = (line: DerivedLine, v1: any, v2: any): boolean => {
    // Check if either endpoint of the line is near either vertex of the edge
    return pointNearPoint({x: line.startX, y: line.startY}, v1) ||
           pointNearPoint({x: line.startX, y: line.startY}, v2) ||
           pointNearPoint({x: line.endX, y: line.endY}, v1) ||
           pointNearPoint({x: line.endX, y: line.endY}, v2)
  }
  
  for (let i = 0; i < perimeterVertices.length; i++) {
    const v1 = perimeterVertices[i]
    const v2 = perimeterVertices[(i + 1) % perimeterVertices.length]
    
    // Check if ANY ridge line terminates at this edge
    const ridgeIntersects = ridgeLines.some(ridge => lineIntersectsEdge(ridge, v1, v2))
    
    // Check if hips or valleys intersect this edge
    const hipIntersects = hipLines.some(hip => lineIntersectsEdge(hip, v1, v2))
    const valleyIntersects = valleyLines.some(valley => lineIntersectsEdge(valley, v1, v2))
    
    // RAKE: Ridge terminates here (this is a gable end)
    // EAVE: Only hips/valleys intersect, or nothing intersects
    const isRakeEdge = ridgeIntersects && !hipIntersects
    
    if (isRakeEdge) {
      lines.push({
        type: 'rake',
        startX: v1.x,
        startY: v1.y,
        endX: v2.x,
        endY: v2.y,
        source: 'vertex_derived'
      })
      console.log(`📐 Edge ${i}: RAKE (ridge intersects at vertex)`)
    } else {
      lines.push({
        type: 'eave',
        startX: v1.x,
        startY: v1.y,
        endX: v2.x,
        endY: v2.y,
        source: 'vertex_derived'
      })
      console.log(`📐 Edge ${i}: EAVE (ridge=${ridgeIntersects}, hip=${hipIntersects}, valley=${valleyIntersects})`)
    }
  }
  
  // Clip all lines to ensure they stay within perimeter
  const clippedLines = lines.map(line => clipLineToPerimeter(line, perimeterVertices, bounds))
    .filter(line => line !== null) as DerivedLine[]
  
  // Log summary for debugging
  const eaveFt = clippedLines.filter(l => l.type === 'eave').length
  const rakeFt = clippedLines.filter(l => l.type === 'rake').length
  console.log(`📐 Derived ${clippedLines.length} lines: ${eaveFt} eave segments, ${rakeFt} rake segments, from ${perimeterVertices.length} perimeter + ${junctions.length} interior vertices`)
  
  return clippedLines
}

function findNearestPoint(target: any, points: any[]): any | null {
  if (!points || points.length === 0) return null
  
  let nearest = points[0]
  let minDist = distance(target, nearest)
  
  for (const p of points) {
    const d = distance(target, p)
    if (d < minDist) {
      minDist = d
      nearest = p
    }
  }
  
  return nearest
}

function distance(p1: any, p2: any): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2))
}

// Clip line to perimeter boundary
function clipLineToPerimeter(line: DerivedLine, perimeterVertices: any[], bounds: any): DerivedLine | null {
  // Ensure both endpoints are within bounds (with 5% tolerance)
  const tolerance = 5
  const minX = bounds.topLeftX - tolerance
  const maxX = bounds.bottomRightX + tolerance
  const minY = bounds.topLeftY - tolerance
  const maxY = bounds.bottomRightY + tolerance
  
  // Clamp endpoints to bounds
  const clampedLine = {
    ...line,
    startX: Math.max(minX, Math.min(maxX, line.startX)),
    startY: Math.max(minY, Math.min(maxY, line.startY)),
    endX: Math.max(minX, Math.min(maxX, line.endX)),
    endY: Math.max(minY, Math.min(maxY, line.endY))
  }
  
  // Calculate length - skip if too short
  const length = distance(
    { x: clampedLine.startX, y: clampedLine.startY },
    { x: clampedLine.endX, y: clampedLine.endY }
  )
  
  if (length < 2) return null // Skip lines shorter than 2%
  
  return clampedLine
}

// Convert derived lines to WKT format
// CRITICAL FIX: Use actual analysis image size and proper coordinate conversion
// For Mapbox 640x640@2x, the actual pixel dimensions are 1280x1280
// But the coordinate conversion should use the logical size (640) for zoom calculations
function convertDerivedLinesToWKT(
  derivedLines: DerivedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,  // This is the LOGICAL size (640 for standard, 1280 for @2x)
  zoom: number
) {
  // Use logical size for meter calculations
  // At zoom 20, 1 pixel = metersPerPixel meters
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  console.log(`📐 WKT conversion: zoom=${zoom}, imageSize=${imageSize}, metersPerPixel=${metersPerPixel.toFixed(4)}`)
  
  const linearFeatures: any[] = []
  let featureId = 1
  
  derivedLines.forEach((line) => {
    // Convert percentage (0-100) to pixel offset from center
    // CRITICAL: percentage is relative to image size, center is at 50%
    const startPixelX = ((line.startX / 100) - 0.5) * imageSize
    const startPixelY = ((line.startY / 100) - 0.5) * imageSize
    const endPixelX = ((line.endX / 100) - 0.5) * imageSize
    const endPixelY = ((line.endY / 100) - 0.5) * imageSize
    
    // Convert pixel offset to meters
    const startMetersX = startPixelX * metersPerPixel
    const startMetersY = startPixelY * metersPerPixel
    const endMetersX = endPixelX * metersPerPixel
    const endMetersY = endPixelY * metersPerPixel
    
    // Convert meters to geographic offset
    const startLngOffset = startMetersX / metersPerDegLng
    const startLatOffset = -startMetersY / metersPerDegLat  // Negative because Y increases downward
    const endLngOffset = endMetersX / metersPerDegLng
    const endLatOffset = -endMetersY / metersPerDegLat
    
    const startLng = imageCenter.lng + startLngOffset
    const startLat = imageCenter.lat + startLatOffset
    const endLng = imageCenter.lng + endLngOffset
    const endLat = imageCenter.lat + endLatOffset
    
    // Calculate length in feet
    const dx = (endLng - startLng) * metersPerDegLng
    const dy = (endLat - startLat) * metersPerDegLat
    const length_ft = Math.sqrt(dx * dx + dy * dy) * 3.28084
    
    if (length_ft >= 3) {
      linearFeatures.push({
        id: `VERTEX_${line.type}_${featureId++}`,
        type: line.type,
        wkt: `LINESTRING(${startLng.toFixed(8)} ${startLat.toFixed(8)}, ${endLng.toFixed(8)} ${endLat.toFixed(8)})`,
        length_ft: Math.round(length_ft * 10) / 10,
        source: line.source
      })
    }
  })
  
  // Log total lengths by type for debugging
  const typeTotals: Record<string, number> = {}
  linearFeatures.forEach(f => {
    typeTotals[f.type] = (typeTotals[f.type] || 0) + f.length_ft
  })
  console.log('📏 Linear feature totals:', typeTotals)
  
  return linearFeatures
}

// Convert perimeter vertices to WKT polygon
function convertPerimeterToWKT(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): string | null {
  if (!vertices || vertices.length < 3) return null
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  const wktPoints = vertices.map((pt: any) => {
    const pixelX = ((pt.x / 100) - 0.5) * imageSize
    const pixelY = ((pt.y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    const lngOffset = metersX / metersPerDegLng
    const latOffset = -metersY / metersPerDegLat
    return `${(imageCenter.lng + lngOffset).toFixed(8)} ${(imageCenter.lat + latOffset).toFixed(8)}`
  })
  
  // Close the polygon
  wktPoints.push(wktPoints[0])
  
  // Calculate perimeter for validation
  let perimeterFt = 0
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i]
    const v2 = vertices[(i + 1) % vertices.length]
    const dx = ((v2.x - v1.x) / 100) * imageSize * metersPerPixel
    const dy = ((v2.y - v1.y) / 100) * imageSize * metersPerPixel
    perimeterFt += Math.sqrt(dx * dx + dy * dy) * 3.28084
  }
  
  console.log(`📐 Perimeter WKT: ${vertices.length} vertices, ~${perimeterFt.toFixed(0)} ft perimeter`)
  
  // Validate: typical residential perimeter is 150-400 ft
  if (perimeterFt > 600) {
    console.warn(`⚠️ Perimeter too large (${perimeterFt.toFixed(0)} ft), likely detection error`)
  }
  
  return `POLYGON((${wktPoints.join(', ')}))`
}

function calculateScale(solarData: any, image: any, aiAnalysis: any) {
  const methods: any[] = []
  if (solarData.available && solarData.buildingFootprintSqft) {
    const buildingWidthFeet = Math.sqrt(solarData.buildingFootprintSqft)
    const imageWidthPixels = image.resolution === '1280x1280' ? 1280 : 640
    const estimatedBuildingPixels = imageWidthPixels * 0.70
    const pixelsPerFoot = estimatedBuildingPixels / buildingWidthFeet
    methods.push({ value: pixelsPerFoot, confidence: 'high', method: 'solar_api_footprint' })
  }
  const totalEstimatedArea = aiAnalysis.facets.reduce((sum: number, f: any) => sum + f.estimatedAreaSqft, 0)
  const estimatedBuildingWidth = Math.sqrt(totalEstimatedArea / 1.3)
  const imageWidthPixels = image.resolution === '1280x1280' ? 1280 : 640
  const fallbackPixelsPerFoot = (imageWidthPixels * 0.70) / estimatedBuildingWidth
  methods.push({ value: fallbackPixelsPerFoot, confidence: 'medium', method: 'typical_residential_scale' })
  const bestMethod = methods.find(m => m.confidence === 'high') || methods[0]
  let variance = 0
  if (methods.length > 1) {
    const values = methods.map(m => m.value)
    const mean = values.reduce((a, b) => a + b) / values.length
    variance = Math.max(...values.map(v => Math.abs((v - mean) / mean * 100)))
  }
  return { pixelsPerFoot: bestMethod.value, method: bestMethod.method, confidence: variance > 15 ? 'medium' : bestMethod.confidence, variance, allMethods: methods }
}

function calculateDetailedMeasurements(aiAnalysis: any, scale: any, solarData: any, linearTotalsFromWKT?: any) {
  const pitches = aiAnalysis.facets.map((f: any) => f.estimatedPitch)
  const predominantPitch = mostCommon(pitches)
  const pitchMultiplier = getSlopeFactorFromPitch(predominantPitch) || 1.083

  const processedFacets = aiAnalysis.facets.map((facet: any) => {
    const facetPitch = facet.estimatedPitch
    const facetMultiplier = getSlopeFactorFromPitch(facetPitch) || pitchMultiplier
    const flatAreaSqft = facet.estimatedAreaSqft
    const adjustedAreaSqft = flatAreaSqft * facetMultiplier
    return {
      facetNumber: facet.facetNumber,
      shape: facet.shape,
      flatAreaSqft,
      pitch: facetPitch,
      pitchMultiplier: facetMultiplier,
      adjustedAreaSqft,
      edges: facet.edges,
      features: facet.features,
      orientation: facet.orientation,
      confidence: facet.pitchConfidence
    }
  })

  const totalFlatArea = processedFacets.reduce((sum: number, f: any) => sum + f.flatAreaSqft, 0)
  const totalAdjustedArea = processedFacets.reduce((sum: number, f: any) => sum + f.adjustedAreaSqft, 0)

  // Use WKT-derived linear measurements if available, otherwise fall back to facet edges
  // Use WKT totals directly - this is the primary source of linear measurements
  const linearMeasurements = {
    eave: linearTotalsFromWKT?.eave || 0,
    rake: linearTotalsFromWKT?.rake || 0,
    hip: linearTotalsFromWKT?.hip || 0,
    valley: linearTotalsFromWKT?.valley || 0,
    ridge: linearTotalsFromWKT?.ridge || 0,
    wallFlashing: 0,
    stepFlashing: 0,
    unspecified: 0
  }
  
  console.log('📏 Linear measurements from WKT:', linearMeasurements)

  const complexity = determineComplexity(processedFacets.length, linearMeasurements)
  const wasteFactor = complexity === 'very_complex' ? 1.20 : complexity === 'complex' ? 1.15 : complexity === 'moderate' ? 1.12 : 1.10
  const totalSquares = totalAdjustedArea / 100
  const totalSquaresWithWaste = totalSquares * wasteFactor

  const materials = {
    shingleBundles: Math.ceil(totalSquaresWithWaste * 3),
    underlaymentRolls: Math.ceil((totalSquares * 100) / 400),
    iceWaterShieldFeet: ((linearMeasurements.eave || 0) * 2) + (linearMeasurements.valley || 0),
    iceWaterShieldRolls: Math.ceil((((linearMeasurements.eave || 0) * 2) + (linearMeasurements.valley || 0)) / 65),
    dripEdgeFeet: (linearMeasurements.eave || 0) + (linearMeasurements.rake || 0),
    dripEdgeSheets: Math.ceil(((linearMeasurements.eave || 0) + (linearMeasurements.rake || 0)) / 10),
    starterStripFeet: (linearMeasurements.eave || 0) + (linearMeasurements.rake || 0),
    starterStripBundles: Math.ceil(((linearMeasurements.eave || 0) + (linearMeasurements.rake || 0)) / 105),
    hipRidgeFeet: (linearMeasurements.hip || 0) + (linearMeasurements.ridge || 0),
    hipRidgeBundles: Math.ceil(((linearMeasurements.hip || 0) + (linearMeasurements.ridge || 0)) / 20),
    valleyMetalFeet: linearMeasurements.valley || 0,
    valleyMetalSheets: Math.ceil((linearMeasurements.valley || 0) / 8)
  }

  let verification = null
  if (solarData.available && solarData.buildingFootprintSqft) {
    const variance = Math.abs(totalFlatArea - solarData.buildingFootprintSqft) / solarData.buildingFootprintSqft * 100
    verification = { solarFootprint: solarData.buildingFootprintSqft, calculatedFootprint: totalFlatArea, variance, status: variance < 15 ? 'validated' : 'flagged' }
  }

  return { predominantPitch, totalFlatArea, totalAdjustedArea, totalSquares, wasteFactor, totalSquaresWithWaste, facets: processedFacets, linearMeasurements, materials, complexity, verification }
}

function determineComplexity(facetCount: number, linear: any): string {
  const totalHipsValleys = (linear.hip || 0) + (linear.valley || 0)
  if (facetCount >= 15 || totalHipsValleys > 200) return 'very_complex'
  if (facetCount >= 10 || totalHipsValleys > 120) return 'complex'
  if (facetCount >= 6 || totalHipsValleys > 60) return 'moderate'
  return 'simple'
}

function mostCommon(arr: string[]): string {
  const counts: { [key: string]: number } = {}
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '5/12'
}

function calculateConfidenceScore(aiAnalysis: any, measurements: any, solarData: any, image: any) {
  let score = 50
  const factors: string[] = []

  if (solarData.available) { score += 25; factors.push('Solar API data available') }
  if (image.quality >= 8) { score += 10; factors.push('High quality imagery') }
  if (measurements.verification?.status === 'validated') { score += 15; factors.push('Area verified against Solar API') }
  
  const rating = score >= 85 ? 'high' : score >= 65 ? 'medium' : 'low'
  const requiresReview = score < 70

  return { score, rating, factors, requiresReview }
}

// Calculate actual roof area from perimeter vertices using Shoelace formula
function calculateAreaFromPerimeterVertices(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): number {
  if (!vertices || vertices.length < 3) {
    console.warn('⚠️ Not enough vertices for area calculation, using fallback')
    return 1500 // Fallback
  }
  
  console.log(`📐 Calculating area from ${vertices.length} vertices, first vertex:`, JSON.stringify(vertices[0]))
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  console.log(`📐 Meters per pixel: ${metersPerPixel.toFixed(4)}, image size: ${imageSize}, zoom: ${zoom}`)
  
  // Handle both percentage (x/y) and geographic (lng/lat) vertex formats
  const feetVertices = vertices.map((v: any) => {
    // Check if vertices are in percentage format (0-100 range)
    if (v.x !== undefined && v.y !== undefined) {
      return {
        x: ((v.x / 100) - 0.5) * imageSize * metersPerPixel * 3.28084,
        y: ((v.y / 100) - 0.5) * imageSize * metersPerPixel * 3.28084
      }
    }
    // Otherwise assume geographic coordinates (lng/lat)
    const metersPerDegLat = 111320
    const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
    return {
      x: ((v.lng || 0) - imageCenter.lng) * metersPerDegLng * 3.28084,
      y: ((v.lat || 0) - imageCenter.lat) * metersPerDegLat * 3.28084
    }
  })
  
  console.log(`📐 Converted vertices sample:`, JSON.stringify(feetVertices.slice(0, 2)))
  
  // Shoelace formula for polygon area
  let area = 0
  for (let i = 0; i < feetVertices.length; i++) {
    const j = (i + 1) % feetVertices.length
    area += feetVertices[i].x * feetVertices[j].y
    area -= feetVertices[j].x * feetVertices[i].y
  }
  
  const calculatedArea = Math.abs(area / 2)
  console.log(`📐 Calculated area: ${calculatedArea.toFixed(0)} sqft`)
  
  // Validate: typical residential roof is 1200-4000 sqft
  if (calculatedArea < 500 || calculatedArea > 8000) {
    console.warn(`⚠️ Calculated area ${calculatedArea.toFixed(0)} sqft seems unusual for residential`)
  }
  
  return calculatedArea
}

// Derive facet count from roof geometry
function deriveFacetCountFromGeometry(
  perimeterVertices: any[],
  interiorJunctions: any[],
  roofType: string
): number {
  // Hip roof: typically 4 facets (4 hip corners on perimeter)
  // Gable roof: typically 2 facets (2 ridge endpoints on perimeter)
  // Complex: count based on interior junctions
  
  if (!perimeterVertices || perimeterVertices.length === 0) return 1
  
  // Count vertices by type
  const hipCorners = perimeterVertices.filter((v: any) => 
    v.cornerType === 'hip-corner' || v.type === 'hip-junction'
  ).length
  
  const ridgeEnds = perimeterVertices.filter((v: any) => 
    v.cornerType === 'ridge-end'
  ).length
  
  const interiorCount = interiorJunctions?.length || 0
  
  // Derive facet count from geometry
  if (roofType === 'hip' || hipCorners >= 4) {
    // Hip roof: 4 main facets
    return 4 + Math.floor(interiorCount / 2)
  } else if (roofType === 'gable' || ridgeEnds >= 2) {
    // Gable roof: 2 main facets
    return 2 + Math.floor(interiorCount / 2)
  } else if (hipCorners >= 2) {
    // Partial hip: at least 3 facets
    return Math.max(3, hipCorners + Math.floor(interiorCount / 2))
  }
  
  // Complex or unknown: estimate from perimeter complexity
  const vertexCount = perimeterVertices.length
  if (vertexCount >= 12) return 6
  if (vertexCount >= 8) return 4
  if (vertexCount >= 6) return 3
  
  return 2 // Minimum for any roof
}

// Calculate linear totals from WKT features
function calculateLinearTotalsFromWKT(linearFeatures: any[]): Record<string, number> {
  const totals: Record<string, number> = {
    eave: 0,
    rake: 0,
    hip: 0,
    valley: 0,
    ridge: 0
  }
  
  if (!linearFeatures || linearFeatures.length === 0) return totals
  
  linearFeatures.forEach((feature: any) => {
    const type = feature.type?.toLowerCase()
    if (type && totals.hasOwnProperty(type)) {
      totals[type] += feature.length_ft || 0
    }
  })
  
  return totals
}

async function saveMeasurementToDatabase(supabase: any, params: any) {
  const {
    address, coordinates, customerId, userId, googleImage, mapboxImage,
    selectedImage, solarData, aiAnalysis, scale, measurements, confidence,
    linearFeatures, imageSource, imageYear, perimeterWkt, visionEdges, imageSize
  } = params

  const { data, error } = await supabase.from('roof_measurements').insert({
    customer_id: customerId || null,
    measured_by: userId || null,
    property_address: address,
    gps_coordinates: { lat: coordinates.lat, lng: coordinates.lng },
    google_maps_image_url: googleImage.url,
    mapbox_image_url: mapboxImage.url,
    selected_image_source: imageSource,
    image_source: imageSource,
    image_year: imageYear,
    solar_api_available: solarData.available || false,
    solar_building_footprint_sqft: solarData.buildingFootprintSqft || null,
    solar_api_response: solarData.available ? solarData : null,
    ai_detection_data: aiAnalysis,
    total_area_flat_sqft: measurements.totalFlatArea,
    total_area_adjusted_sqft: measurements.totalAdjustedArea,
    total_squares: measurements.totalSquares,
    waste_factor_percent: (measurements.wasteFactor - 1) * 100,
    total_squares_with_waste: measurements.totalSquaresWithWaste,
    predominant_pitch: measurements.predominantPitch,
    pixels_per_foot: scale.pixelsPerFoot,
    scale_method: scale.method,
    scale_confidence: scale.confidence,
    measurement_confidence: confidence.score,
    requires_manual_review: confidence.requiresReview,
    roof_type: aiAnalysis.roofType,
    complexity_rating: measurements.complexity,
    facet_count: aiAnalysis.derivedFacetCount || aiAnalysis.facets?.length || 1,
    total_eave_length: measurements.linearMeasurements?.eave || 0,
    total_rake_length: measurements.linearMeasurements?.rake || 0,
    total_hip_length: measurements.linearMeasurements?.hip || 0,
    total_valley_length: measurements.linearMeasurements?.valley || 0,
    total_ridge_length: measurements.linearMeasurements?.ridge || 0,
    material_calculations: measurements.materials,
    linear_features_wkt: linearFeatures,
    perimeter_wkt: perimeterWkt,
    vision_edges: visionEdges,
    bounding_box: aiAnalysis.boundingBox,
    roof_perimeter: aiAnalysis.roofPerimeter,
    analysis_zoom: IMAGE_ZOOM,
    analysis_image_size: { width: imageSize, height: imageSize },
    validation_status: 'pending'
  }).select().single()

  if (error) {
    console.error('Failed to save measurement:', error)
    throw new Error(`Database save failed: ${error.message}`)
  }

  console.log('💾 Saved measurement:', data.id)
  return data
}
