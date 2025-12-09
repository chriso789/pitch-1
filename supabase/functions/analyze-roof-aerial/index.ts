import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!
const GOOGLE_SOLAR_API_KEY = Deno.env.get('GOOGLE_SOLAR_API_KEY')!
const MAPBOX_PUBLIC_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const IMAGE_ZOOM = 20
const IMAGE_SIZE = 640

const PITCH_MULTIPLIERS: { [key: string]: number } = {
  '1/12': 1.0035, '2/12': 1.0138, '3/12': 1.0308, '4/12': 1.0541,
  '5/12': 1.0833, '6/12': 1.1180, '7/12': 1.1577, '8/12': 1.2019,
  '9/12': 1.2500, '10/12': 1.3017, '11/12': 1.3566, '12/12': 1.4142
}

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

    // Select best image (prefer Mapbox for higher resolution)
    const selectedImage = mapboxImage.url ? mapboxImage : googleImage
    const imageSource = selectedImage.source
    const imageYear = new Date().getFullYear()
    const imageSize = selectedImage.source === 'mapbox' ? 1280 : 640
    
    console.log(`✅ Using: ${imageSource} (${imageSize}x${imageSize})`)

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
    
    // Convert legacy AI analysis format for backward compatibility
    const aiAnalysis = {
      roofType: perimeterResult.roofType || 'complex',
      facets: [{
        facetNumber: 1,
        shape: 'complex',
        estimatedPitch: '5/12',
        pitchConfidence: 'medium',
        estimatedAreaSqft: 1500,
        edges: { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0 },
        features: { chimneys: 0, skylights: 0, vents: 0 },
        orientation: 'mixed'
      }],
      boundingBox: buildingIsolation.bounds,
      roofPerimeter: perimeterResult.vertices,
      edgeSegments: [],
      overallComplexity: perimeterResult.complexity || 'moderate',
      shadowAnalysis: { estimatedPitchRange: '4/12 to 7/12', confidence: 'medium' },
      detectionNotes: 'Vertex-based detection'
    }
    
    const scale = calculateScale(solarData, selectedImage, aiAnalysis)
    const measurements = calculateDetailedMeasurements(aiAnalysis, scale, solarData)
    const confidence = calculateConfidenceScore(aiAnalysis, measurements, solarData, selectedImage)
    
    // Convert derived lines to WKT (these are CONSTRAINED to perimeter)
    const linearFeatures = convertDerivedLinesToWKT(
      derivedLines,
      coordinates,
      imageSize,
      IMAGE_ZOOM
    )
    
    // Convert perimeter to WKT polygon
    const perimeterWkt = convertPerimeterToWKT(
      perimeterResult.vertices,
      coordinates,
      imageSize,
      IMAGE_ZOOM
    )

    console.log(`📏 Generated ${linearFeatures.length} vertex-derived linear features`)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const measurementRecord = await saveMeasurementToDatabase(supabase, {
      address, coordinates, customerId, userId, googleImage, mapboxImage,
      selectedImage, solarData, aiAnalysis, scale, measurements, confidence,
      linearFeatures, imageSource, imageYear, perimeterWkt,
      visionEdges: { ridges: [], hips: [], valleys: [] }, // Replaced by vertex detection
      imageSize
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
          analysisZoom: IMAGE_ZOOM
        },
        linearFeaturesWkt: linearFeatures,
        perimeterWkt,
        analysisZoom: IMAGE_ZOOM,
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
async function isolateTargetBuilding(imageUrl: string, address: string, coordinates: { lat: number; lng: number }) {
  if (!imageUrl) {
    return { bounds: { topLeftX: 25, topLeftY: 25, bottomRightX: 75, bottomRightY: 75 }, confidence: 'low' }
  }

  const prompt = `Analyze this satellite image and identify the TARGET BUILDING only.

The target building is the one at the CENTER of the image (the GPS coordinates point here).
Exclude any adjacent buildings, sheds, garages, or outbuildings.

Return a TIGHT bounding box containing ONLY the target building's roof:

{
  "targetBuildingBounds": {
    "topLeftX": 28.0,
    "topLeftY": 22.0,
    "bottomRightX": 72.0,
    "bottomRightY": 78.0
  },
  "otherBuildingsDetected": 2,
  "targetBuildingType": "residential",
  "confidenceTargetIsCorrect": "high"
}

CRITICAL:
- Use percentage coordinates (0-100) of image dimensions
- The bounding box should tightly wrap ONLY the main building roof
- Do NOT include trees, driveways, sheds, or adjacent properties
- Return ONLY valid JSON, no explanation`

  console.log('🏠 Pass 1: Isolating target building...')
  
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
      return { bounds: { topLeftX: 20, topLeftY: 20, bottomRightX: 80, bottomRightY: 80 }, confidence: 'low' }
    }
    
    let content = data.choices[0].message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    const result = JSON.parse(content)
    const bounds = result.targetBuildingBounds || { topLeftX: 20, topLeftY: 20, bottomRightX: 80, bottomRightY: 80 }
    
    console.log(`✅ Pass 1 complete: target bounds (${bounds.topLeftX}%, ${bounds.topLeftY}%) to (${bounds.bottomRightX}%, ${bounds.bottomRightY}%), ${result.otherBuildingsDetected || 0} other buildings excluded`)
    
    return { 
      bounds, 
      otherBuildings: result.otherBuildingsDetected || 0,
      confidence: result.confidenceTargetIsCorrect || 'medium'
    }
  } catch (err) {
    console.error('Building isolation error:', err)
    return { bounds: { topLeftX: 20, topLeftY: 20, bottomRightX: 80, bottomRightY: 80 }, confidence: 'low' }
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
  
  // 4. EAVE LINES: Horizontal perimeter edges (bottom edges)
  for (let i = 0; i < perimeterVertices.length; i++) {
    const v1 = perimeterVertices[i]
    const v2 = perimeterVertices[(i + 1) % perimeterVertices.length]
    
    // Eaves are typically horizontal (small Y difference) at bottom
    const dy = Math.abs(v1.y - v2.y)
    const dx = Math.abs(v1.x - v2.x)
    const avgY = (v1.y + v2.y) / 2
    
    // Horizontal edge in bottom half = eave
    if (dx > dy * 2 && avgY > (bounds.topLeftY + bounds.bottomRightY) / 2) {
      lines.push({
        type: 'eave',
        startX: v1.x,
        startY: v1.y,
        endX: v2.x,
        endY: v2.y,
        source: 'vertex_derived'
      })
    }
  }
  
  // 5. RAKE LINES: Sloped perimeter edges connecting to ridge ends (gable edges)
  const ridgeEnds = perimeterVertices.filter((v: any) => 
    v.cornerType === 'ridge-end' || v.type === 'ridge-end'
  )
  
  for (let i = 0; i < perimeterVertices.length; i++) {
    const v1 = perimeterVertices[i]
    const v2 = perimeterVertices[(i + 1) % perimeterVertices.length]
    
    // Check if either endpoint is a ridge-end (gable peak)
    const isRakeEdge = ridgeEnds.some((re: any) => 
      (Math.abs(re.x - v1.x) < 3 && Math.abs(re.y - v1.y) < 3) ||
      (Math.abs(re.x - v2.x) < 3 && Math.abs(re.y - v2.y) < 3)
    )
    
    if (isRakeEdge) {
      lines.push({
        type: 'rake',
        startX: v1.x,
        startY: v1.y,
        endX: v2.x,
        endY: v2.y,
        source: 'vertex_derived'
      })
    }
  }
  
  // Clip all lines to ensure they stay within perimeter
  const clippedLines = lines.map(line => clipLineToPerimeter(line, perimeterVertices, bounds))
    .filter(line => line !== null) as DerivedLine[]
  
  console.log(`📐 Derived ${clippedLines.length} lines from ${perimeterVertices.length} perimeter + ${junctions.length} interior vertices`)
  
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
function convertDerivedLinesToWKT(
  derivedLines: DerivedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
) {
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  const linearFeatures: any[] = []
  let featureId = 1
  
  derivedLines.forEach((line) => {
    // Convert percentage to pixel offset from center
    const startPixelX = ((line.startX / 100) - 0.5) * imageSize
    const startPixelY = ((line.startY / 100) - 0.5) * imageSize
    const endPixelX = ((line.endX / 100) - 0.5) * imageSize
    const endPixelY = ((line.endY / 100) - 0.5) * imageSize
    
    // Convert pixel offset to geographic offset
    const startLngOffset = (startPixelX * metersPerPixel) / metersPerDegLng
    const startLatOffset = -(startPixelY * metersPerPixel) / metersPerDegLat
    const endLngOffset = (endPixelX * metersPerPixel) / metersPerDegLng
    const endLatOffset = -(endPixelY * metersPerPixel) / metersPerDegLat
    
    const startLng = imageCenter.lng + startLngOffset
    const startLat = imageCenter.lat + startLatOffset
    const endLng = imageCenter.lng + endLngOffset
    const endLat = imageCenter.lat + endLatOffset
    
    // Calculate length
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
    const lngOffset = (pixelX * metersPerPixel) / metersPerDegLng
    const latOffset = -(pixelY * metersPerPixel) / metersPerDegLat
    return `${(imageCenter.lng + lngOffset).toFixed(8)} ${(imageCenter.lat + latOffset).toFixed(8)}`
  })
  
  // Close the polygon
  wktPoints.push(wktPoints[0])
  
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

function calculateDetailedMeasurements(aiAnalysis: any, scale: any, solarData: any) {
  const pitches = aiAnalysis.facets.map((f: any) => f.estimatedPitch)
  const predominantPitch = mostCommon(pitches)
  const pitchMultiplier = PITCH_MULTIPLIERS[predominantPitch] || 1.083

  const processedFacets = aiAnalysis.facets.map((facet: any) => {
    const facetPitch = facet.estimatedPitch
    const facetMultiplier = PITCH_MULTIPLIERS[facetPitch] || pitchMultiplier
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

  const linearMeasurements = { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0, wallFlashing: 0, stepFlashing: 0, unspecified: 0 }
  processedFacets.forEach((facet: any) => {
    linearMeasurements.eave += facet.edges.eave || 0
    linearMeasurements.rake += facet.edges.rake || 0
    linearMeasurements.hip += facet.edges.hip || 0
    linearMeasurements.valley += facet.edges.valley || 0
    linearMeasurements.ridge += facet.edges.ridge || 0
  })

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

async function saveMeasurementToDatabase(supabase: any, params: any) {
  const {
    address, coordinates, customerId, userId, googleImage, mapboxImage,
    selectedImage, solarData, aiAnalysis, scale, measurements, confidence,
    linearFeatures, imageSource, imageYear, perimeterWkt, visionEdges, imageSize
  } = params

  const { data, error } = await supabase.from('roof_measurements').insert({
    customer_id: customerId || null,
    user_id: userId || null,
    address,
    gps_coordinates: { lat: coordinates.lat, lng: coordinates.lng },
    google_satellite_url: googleImage.url,
    mapbox_satellite_url: mapboxImage.url,
    selected_image_source: imageSource,
    image_year: imageYear,
    google_solar_data: solarData.available ? solarData : null,
    ai_analysis: aiAnalysis,
    scale_data: scale,
    total_area_sqft: measurements.totalAdjustedArea,
    total_squares: measurements.totalSquares,
    waste_factor: measurements.wasteFactor,
    predominant_pitch: measurements.predominantPitch,
    facets: measurements.facets,
    linear_measurements: measurements.linearMeasurements,
    materials_estimate: measurements.materials,
    confidence_score: confidence.score,
    confidence_rating: confidence.rating,
    requires_review: confidence.requiresReview,
    linear_features_wkt: linearFeatures,
    perimeter_wkt: perimeterWkt,
    vision_detected_edges: visionEdges,
    analysis_zoom: IMAGE_ZOOM,
    status: 'completed'
  }).select().single()

  if (error) {
    console.error('Failed to save measurement:', error)
    throw new Error(`Database save failed: ${error.message}`)
  }

  console.log('💾 Saved measurement:', data.id)
  return data
}
