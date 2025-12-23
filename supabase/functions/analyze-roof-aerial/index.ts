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
    // IMPROVED: Pass solarData for validation and address for Florida-specific thresholds
    const actualAreaSqft = calculateAreaFromPerimeterVertices(
      perimeterResult.vertices,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM,
      solarData,  // Pass Solar API data for validation
      address     // Pass address for Florida-specific variance threshold
    )
    console.log(`📐 Validated area from perimeter: ${actualAreaSqft.toFixed(0)} sqft`)
    
    // Derive facet count from roof geometry AND detected lines
    // First, calculate linear features to count hip lines
    const preLinearFeaturesForFacets = convertDerivedLinesToWKT(
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    const hipLineCount = preLinearFeaturesForFacets.filter((f: any) => f.type === 'hip').length
    const ridgeLineCount = preLinearFeaturesForFacets.filter((f: any) => f.type === 'ridge').length
    
    const derivedFacetCount = deriveFacetCountFromGeometry(
      perimeterResult.vertices,
      interiorVertices.junctions,
      perimeterResult.roofType,
      hipLineCount,
      ridgeLineCount
    )
    console.log(`📐 Derived facet count: ${derivedFacetCount} (from ${hipLineCount} hips, ${ridgeLineCount} ridges)`)
    
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
    
    // Extract vertex stats from perimeter detection
    const vertexStats = perimeterResult.vertexStats || {
      hipCornerCount: perimeterResult.vertices.filter((v: any) => v.cornerType === 'hip-corner').length,
      valleyEntryCount: perimeterResult.vertices.filter((v: any) => v.cornerType === 'valley-entry').length,
      gablePeakCount: perimeterResult.vertices.filter((v: any) => v.cornerType === 'gable-peak').length,
      totalCount: perimeterResult.vertices.length
    }
    
    const measurementRecord = await saveMeasurementToDatabase(supabase, {
      address, coordinates, customerId, userId, googleImage, mapboxImage,
      selectedImage, solarData, aiAnalysis, scale, measurements, confidence,
      linearFeatures, imageSource, imageYear, perimeterWkt,
      visionEdges: { ridges: [], hips: [], valleys: [] },
      imageSize: logicalImageSize,
      vertexStats  // Pass vertex stats to save
    })
    
    // NEW: Save vertices and edges to dedicated tables for Roofr-quality tracking
    await saveVerticesToDatabase(
      supabase,
      measurementRecord.id,
      perimeterResult.vertices,
      interiorVertices.junctions,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    
    await saveEdgesToDatabase(
      supabase,
      measurementRecord.id,
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    
    // Generate and save facet polygons to roof_measurement_facets
    const facetPolygons = generateFacetPolygons(
      perimeterResult.vertices,
      interiorVertices.junctions,
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM,
      derivedFacetCount,
      measurements.predominantPitch
    )
    
    if (facetPolygons.length > 0) {
      await saveFacetsToDatabase(supabase, measurementRecord.id, facetPolygons, measurements)
    }
    
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
// IMPROVED: Tighter bounds validation to reduce over-measurement
async function isolateTargetBuilding(imageUrl: string, address: string, coordinates: { lat: number; lng: number }) {
  if (!imageUrl) {
    // Default: small centered box for residential
    return { bounds: { topLeftX: 38, topLeftY: 38, bottomRightX: 62, bottomRightY: 62 }, confidence: 'low' }
  }

  const prompt = `You are a roof measurement expert. Analyze this satellite image.

TASK: Find the MAIN RESIDENTIAL BUILDING at the EXACT CENTER of the image.
The GPS coordinates point to the center of this image, so the target house is in the middle.

Return a TIGHT bounding box that wraps ONLY the SHINGLED/TILED ROOF - do NOT include:
- Detached garages or carports
- Sheds or outbuildings
- Swimming pools
- Driveways or patios
- Adjacent properties
- SCREEN ENCLOSURES (lanais/pool cages) - these have a metal frame grid structure, NOT shingles
- Covered patios with flat or metal roofs
- Screened-in porches with transparent or mesh roofing
- Carports or awnings

SCREEN ENCLOSURE IDENTIFICATION:
- Screen enclosures appear as RECTANGULAR metal frame structures with a visible GRID PATTERN
- They are typically adjacent to or extending from the main house
- They have a DIFFERENT texture than shingles - look for mesh/grid vs shingle lines
- Common in Florida - often covers pool areas

{
  "targetBuildingBounds": {
    "topLeftX": 40.5,
    "topLeftY": 38.0,
    "bottomRightX": 59.5,
    "bottomRightY": 62.0
  },
  "estimatedRoofWidthFt": 38,
  "estimatedRoofLengthFt": 48,
  "otherBuildingsDetected": 1,
  "screenEnclosureDetected": false,
  "targetBuildingType": "residential",
  "confidenceTargetIsCorrect": "high"
}

CRITICAL RULES:
1. The main house is CENTERED in the image (around 40-60% x and y range typically)
2. Typical residential roofs are 30-55ft wide, which is about 12-25% of image width
3. Do NOT include sheds, garages, driveways, pools, or adjacent properties
4. A bounding box larger than 35% of image width is likely WRONG for single-family residential
5. For a standard 2000sqft house, expect bounds of ~20-25% width
6. EXCLUDE screen enclosures/lanais - measure ONLY the shingled/tiled roof area
7. Use DECIMAL precision (e.g., 38.72, not 39)
8. Return ONLY valid JSON, no explanation`

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
      return { bounds: { topLeftX: 38, topLeftY: 38, bottomRightX: 62, bottomRightY: 62 }, confidence: 'low' }
    }
    
    let content = data.choices[0].message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    const result = JSON.parse(content)
    let bounds = result.targetBuildingBounds || { topLeftX: 38, topLeftY: 38, bottomRightX: 62, bottomRightY: 62 }
    
    // VALIDATION: Ensure bounds are reasonable for residential
    const width = bounds.bottomRightX - bounds.topLeftX
    const height = bounds.bottomRightY - bounds.topLeftY
    
    // TIGHTENED: If detected bounds are too large (>35% of image), likely wrong - use tighter default
    // 35% at zoom 20 is about 70ft which is already large for residential
    if (width > 35 || height > 35) {
      console.warn(`⚠️ Detected bounds too large (${width.toFixed(1)}% x ${height.toFixed(1)}%), reducing to centered default`)
      // Calculate a proportionally smaller box centered at the detected location
      const detectedCenterX = (bounds.topLeftX + bounds.bottomRightX) / 2
      const detectedCenterY = (bounds.topLeftY + bounds.bottomRightY) / 2
      const maxSize = 30 // Max 30% of image
      bounds = {
        topLeftX: detectedCenterX - maxSize / 2,
        topLeftY: detectedCenterY - maxSize / 2,
        bottomRightX: detectedCenterX + maxSize / 2,
        bottomRightY: detectedCenterY + maxSize / 2
      }
    }
    
    // Ensure building is centered (within 30-70% range)
    const centerX = (bounds.topLeftX + bounds.bottomRightX) / 2
    const centerY = (bounds.topLeftY + bounds.bottomRightY) / 2
    if (centerX < 35 || centerX > 65 || centerY < 35 || centerY > 65) {
      console.warn(`⚠️ Building not centered (center at ${centerX.toFixed(1)}%, ${centerY.toFixed(1)}%), adjusting to center`)
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
    
    const finalWidth = bounds.bottomRightX - bounds.topLeftX
    const finalHeight = bounds.bottomRightY - bounds.topLeftY
    console.log(`✅ Pass 1 complete: target bounds (${bounds.topLeftX.toFixed(1)}%, ${bounds.topLeftY.toFixed(1)}%) to (${bounds.bottomRightX.toFixed(1)}%, ${bounds.bottomRightY.toFixed(1)}%), size: ${finalWidth.toFixed(1)}% x ${finalHeight.toFixed(1)}%, ${result.otherBuildingsDetected || 0} other buildings excluded`)
    
    return { 
      bounds, 
      otherBuildings: result.otherBuildingsDetected || 0,
      confidence: result.confidenceTargetIsCorrect || 'medium',
      estimatedDimensions: {
        widthFt: result.estimatedRoofWidthFt || 45,
        lengthFt: result.estimatedRoofLengthFt || 45
      }
    }
  } catch (err) {
    console.error('Building isolation error:', err)
    return { bounds: { topLeftX: 38, topLeftY: 38, bottomRightX: 62, bottomRightY: 62 }, confidence: 'low' }
  }
}

// PASS 2: Detect perimeter vertices (roof polygon corners)
// ENHANCED: Roofr-quality vertex detection - detect EVERY vertex where roofline direction changes
async function detectPerimeterVertices(imageUrl: string, bounds: any) {
  if (!imageUrl) {
    return { vertices: [], roofType: 'unknown', complexity: 'moderate', vertexStats: {} }
  }

  // ENHANCED PROMPT: Request EVERY vertex, not simplified 6-12
  const prompt = `You are a professional roof measurement expert trained to match EagleView/Roofr accuracy (98%+).

TASK: Trace the COMPLETE roof boundary as a CLOSED POLYGON with EVERY VERTEX where the roofline changes direction.

The target building is within bounds: top-left (${bounds.topLeftX}%, ${bounds.topLeftY}%) to bottom-right (${bounds.bottomRightX}%, ${bounds.bottomRightY}%)

CRITICAL VERTEX DETECTION RULES:
1. Count EVERY vertex where the roof edge changes direction - typical residential roofs have 12-30+ vertices
2. Include micro-corners from dormers, bump-outs, L-shapes, and garage extensions
3. For complex roofs (hip with dormers, cross-gables), expect 15-25+ vertices
4. For simple rectangular hip roofs, expect 8-12 vertices minimum
5. Each hip corner, valley entry, gable peak, and eave corner is a SEPARATE vertex

VERTEX TYPE CLASSIFICATION:
- "hip-corner": Where a hip line meets the eave (diagonal corners on hip roofs) - CRITICAL for facet count
- "valley-entry": Where a valley line enters from the perimeter (internal corner going inward)
- "gable-peak": Top of gable end where ridge terminates at perimeter (triangular peak)
- "eave-corner": Where two eave lines meet at 90° (rectangular corners, no hip/valley)
- "rake-corner": Where rake edge meets eave (bottom of gable end)
- "dormer-junction": Where dormer connects to main roof perimeter

EXCLUDE FROM PERIMETER (do NOT trace these):
- Screen enclosures (lanais/pool cages) - metal frame grid structures
- Covered patios with flat/metal roofs
- Carports, awnings, pergolas
- Adjacent outbuildings

RESPONSE FORMAT:
{
  "roofType": "hip|gable|cross-gable|hip-with-dormers|complex",
  "complexity": "simple|moderate|complex|very-complex",
  "estimatedFacetCount": 6,
  "roofMaterial": "shingle|tile|metal",
  "screenEnclosureExcluded": false,
  "vertexCountExpected": 14,
  "vertices": [
    {"x": 30.52, "y": 25.18, "cornerType": "hip-corner", "notes": "NW hip corner"},
    {"x": 45.00, "y": 24.50, "cornerType": "gable-peak", "notes": "front gable peak"},
    {"x": 50.25, "y": 26.00, "cornerType": "valley-entry", "notes": "valley between main and garage"},
    {"x": 70.18, "y": 25.45, "cornerType": "hip-corner", "notes": "NE hip corner"},
    {"x": 72.00, "y": 40.00, "cornerType": "eave-corner", "notes": "east side bump-out corner"},
    ...more vertices in CLOCKWISE order...
  ],
  "qualityCheck": {
    "hipCornerCount": 4,
    "valleyEntryCount": 2,
    "gablePeakCount": 0,
    "eaveCornerCount": 4,
    "totalVertexCount": 14,
    "perimeterApproxFeet": 180
  }
}

QUALITY VALIDATION:
- For hip roofs: hipCornerCount should be 4+ (one per direction)
- For gable roofs: gablePeakCount should be 2+ (front and back peaks)
- Facet count ≈ hipCornerCount for pure hip roofs
- Facet count = 2 + (gablePeakCount) for pure gable roofs

Use DECIMAL PRECISION (e.g., 34.72 not 35). Return ONLY valid JSON.`

  console.log('📐 Pass 2: Enhanced vertex detection (Roofr-quality)...')
  
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 2500  // Increased for more vertices
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Perimeter detection failed:', data)
      return { vertices: createFallbackPerimeter(bounds), roofType: 'unknown', complexity: 'moderate', vertexStats: {} }
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
    
    // Validate vertices are within bounds (with tolerance)
    const validVertices = vertices.filter((v: any) => 
      v.x >= bounds.topLeftX - 5 && v.x <= bounds.bottomRightX + 5 &&
      v.y >= bounds.topLeftY - 5 && v.y <= bounds.bottomRightY + 5
    )
    
    // Extract vertex statistics for database
    const vertexStats = {
      hipCornerCount: validVertices.filter((v: any) => v.cornerType === 'hip-corner').length,
      valleyEntryCount: validVertices.filter((v: any) => v.cornerType === 'valley-entry').length,
      gablePeakCount: validVertices.filter((v: any) => v.cornerType === 'gable-peak').length,
      eaveCornerCount: validVertices.filter((v: any) => v.cornerType === 'eave-corner').length,
      rakeCornerCount: validVertices.filter((v: any) => v.cornerType === 'rake-corner').length,
      dormerJunctionCount: validVertices.filter((v: any) => v.cornerType === 'dormer-junction').length,
      totalCount: validVertices.length,
      estimatedFacetCount: result.estimatedFacetCount || 4
    }
    
    console.log(`✅ Pass 2 complete: ${validVertices.length} perimeter vertices detected`)
    console.log(`   Vertex breakdown: ${vertexStats.hipCornerCount} hip-corners, ${vertexStats.valleyEntryCount} valley-entries, ${vertexStats.gablePeakCount} gable-peaks, ${vertexStats.eaveCornerCount} eave-corners`)
    console.log(`   Estimated facets: ${vertexStats.estimatedFacetCount}, roofType: ${result.roofType}`)
    
    // Validate vertex count matches expected
    if (result.qualityCheck?.totalVertexCount && Math.abs(validVertices.length - result.qualityCheck.totalVertexCount) > 2) {
      console.warn(`⚠️ Vertex count mismatch: got ${validVertices.length}, expected ${result.qualityCheck.totalVertexCount}`)
    }
    
    return { 
      vertices: validVertices.length >= 4 ? validVertices : createFallbackPerimeter(bounds),
      roofType: result.roofType || 'complex',
      complexity: result.complexity || 'moderate',
      vertexStats,
      estimatedFacetCount: result.estimatedFacetCount,
      qualityCheck: result.qualityCheck
    }
  } catch (err) {
    console.error('Perimeter detection error:', err)
    return { vertices: createFallbackPerimeter(bounds), roofType: 'unknown', complexity: 'moderate', vertexStats: {} }
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
// ENHANCED: More detailed junction detection to match Roofr facet accuracy
async function detectInteriorJunctions(imageUrl: string, perimeterVertices: any[], bounds: any) {
  if (!imageUrl || perimeterVertices.length < 4) {
    return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
  }

  // Count vertex types from perimeter for context
  const hipCorners = perimeterVertices.filter((v: any) => v.cornerType === 'hip-corner').length
  const valleyEntries = perimeterVertices.filter((v: any) => v.cornerType === 'valley-entry').length
  const gablePeaks = perimeterVertices.filter((v: any) => v.cornerType === 'gable-peak').length
  
  const prompt = `You are a professional roof measurement expert. Detect ALL INTERIOR JUNCTION POINTS where roof features meet.

The roof perimeter has ${perimeterVertices.length} vertices including ${hipCorners} hip-corners, ${valleyEntries} valley-entries, and ${gablePeaks} gable-peaks.

TASK: Identify every INTERIOR vertex where roof lines intersect:

INTERIOR JUNCTION TYPES:
- "ridge-hip-junction": Where the main ridge line terminates and hips branch out (most common)
- "ridge-valley-junction": Where ridge meets a valley (T-intersection)  
- "hip-hip-junction": Where two hip lines meet at the apex
- "valley-hip-junction": Where a valley line meets a hip line
- "ridge-termination": Where a ridge ends (not at a junction)
- "hip-peak": Central peak where multiple hips converge

GEOMETRIC RULES FOR VALIDATION:
- For a 4-facet hip roof: expect 2 ridge-hip-junctions (one at each end of ridge)
- For a 6-facet hip roof: expect 2 ridge-hip-junctions + possibly 1-2 additional junctions
- Number of hip lines from perimeter should roughly equal number connecting to interior junctions
- Each valley-entry on perimeter should connect to an interior valley junction

RESPONSE FORMAT:
{
  "junctions": [
    {"x": 35.50, "y": 48.00, "type": "ridge-hip-junction", "connectedHipCount": 2},
    {"x": 65.20, "y": 47.50, "type": "ridge-hip-junction", "connectedHipCount": 2}
  ],
  "ridgeEndpoints": [
    {"x": 35.50, "y": 48.00},
    {"x": 65.20, "y": 47.50}
  ],
  "valleyJunctions": [
    {"x": 50.00, "y": 55.00, "type": "valley-hip-junction", "connectedValleyCount": 1}
  ],
  "roofPeakType": "single-ridge|multiple-ridge|hip-peak|flat",
  "ridgeCount": 1,
  "estimatedHipLineCount": 4,
  "qualityCheck": {
    "junctionCount": 2,
    "ridgeSegmentCount": 1,
    "allHipsAccountedFor": true
  }
}

CRITICAL RULES:
- Junction points are INSIDE the roof, not on the perimeter
- Use DECIMAL PRECISION (e.g., 45.72)
- Stay WITHIN bounds: (${bounds.topLeftX}%, ${bounds.topLeftY}%) to (${bounds.bottomRightX}%, ${bounds.bottomRightY}%)
- For hip roofs: hipCornerCount on perimeter should ≈ number of hip lines connecting to junctions
- Return ONLY valid JSON`

  console.log('🔺 Pass 3: Enhanced interior junction detection...')
  
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
      console.error('Junction detection failed:', data)
      return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
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
    const junctions = result.junctions || []
    const ridgeEndpoints = result.ridgeEndpoints || []
    const valleyJunctions = result.valleyJunctions || []
    
    // Validate junctions are within bounds
    const validJunctions = junctions.filter((j: any) =>
      j.x >= bounds.topLeftX - 3 && j.x <= bounds.bottomRightX + 3 &&
      j.y >= bounds.topLeftY - 3 && j.y <= bounds.bottomRightY + 3
    )
    
    console.log(`✅ Pass 3 complete: ${validJunctions.length} interior junctions, ${ridgeEndpoints.length} ridge endpoints`)
    console.log(`   Ridge count: ${result.ridgeCount || 1}, estimated hip lines: ${result.estimatedHipLineCount || hipCorners}`)
    
    // Validate: hip corners on perimeter should roughly match hip lines to interior
    if (hipCorners > 0 && result.estimatedHipLineCount) {
      const hipLineVariance = Math.abs(hipCorners - result.estimatedHipLineCount)
      if (hipLineVariance > 2) {
        console.warn(`⚠️ Hip line count mismatch: ${hipCorners} perimeter hip-corners vs ${result.estimatedHipLineCount} estimated hip lines`)
      }
    }
    
    return { 
      junctions: validJunctions,
      ridgeEndpoints,
      valleyJunctions,
      peakType: result.roofPeakType,
      ridgeCount: result.ridgeCount || 1,
      estimatedHipLineCount: result.estimatedHipLineCount || hipCorners,
      qualityCheck: result.qualityCheck
    }
  } catch (err) {
    console.error('Junction detection error:', err)
    return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
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

// HARD CAPS for residential roof area validation
const ROOF_AREA_CAPS = {
  MIN_RESIDENTIAL: 500,      // Minimum realistic residential roof
  MAX_RESIDENTIAL: 5000,     // Maximum single-family residential (typical 1200-3500)
  MAX_LARGE_HOME: 8000,      // Maximum for large/luxury homes
  SOLAR_VARIANCE_THRESHOLD: 0.5,  // 50% variance triggers Solar API override (default)
  FLORIDA_VARIANCE_THRESHOLD: 0.25  // 25% for Florida (screen enclosures common)
}

// Check if address is in Florida (screen enclosures/lanais very common)
function isFloridaAddress(address: string): boolean {
  const fl = address.toLowerCase()
  return fl.includes(', fl ') || fl.includes(', fl,') || fl.includes(' florida') || fl.endsWith(', fl')
}

// Calculate actual roof area from perimeter vertices using Shoelace formula
// IMPROVED: Now accepts solarData for validation and uses it as ground truth when AI fails
// Added address parameter to apply tighter variance for Florida (screen enclosure detection)
function calculateAreaFromPerimeterVertices(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number,
  solarData?: any,  // Optional Solar API data for validation
  address?: string  // Optional address for Florida-specific validation
): number {
  // FALLBACK: If no vertices or Solar API available, use Solar API footprint
  if (!vertices || vertices.length < 3) {
    console.warn('⚠️ Not enough vertices for area calculation')
    if (solarData?.available && solarData?.buildingFootprintSqft) {
      console.log(`📐 Using Solar API footprint as fallback: ${solarData.buildingFootprintSqft.toFixed(0)} sqft`)
      return solarData.buildingFootprintSqft
    }
    console.warn('⚠️ No Solar API data, using conservative residential fallback: 1500 sqft')
    return 1500 // Conservative fallback
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
  
  let calculatedArea = Math.abs(area / 2)
  console.log(`📐 Raw calculated area: ${calculatedArea.toFixed(0)} sqft`)
  
  // VALIDATION 1: Check against Solar API if available
  // CRITICAL FIX FOR SCREEN ENCLOSURES:
  // - In Florida, screen enclosures (lanais/pool cages) cause AI to detect LARGER area than actual roof
  // - Solar API also includes the full building footprint (including screen enclosure)
  // - The ACTUAL shingled roof is SMALLER than both AI and Solar detect
  // - Solution: For Florida addresses, use the SMALLER of AI Vision vs Solar API
  //   This works because:
  //   - If AI correctly excludes screen enclosure → AI area is smaller → use it
  //   - If Solar correctly represents roof without enclosure → Solar is smaller → use it
  //   - Using the minimum helps exclude screen enclosures from either source
  
  if (solarData?.available && solarData?.buildingFootprintSqft) {
    const solarFootprint = solarData.buildingFootprintSqft
    const variance = Math.abs(calculatedArea - solarFootprint) / solarFootprint
    
    // Check if Florida address (screen enclosures very common)
    const isFlorida = address ? isFloridaAddress(address) : false
    
    console.log(`📐 Solar API validation: AI_calculated=${calculatedArea.toFixed(0)}, solar=${solarFootprint.toFixed(0)}, variance=${(variance * 100).toFixed(1)}%${isFlorida ? ' (Florida: using minimum area strategy)' : ''}`)
    
    if (isFlorida) {
      // FLORIDA STRATEGY: Use the SMALLER area to exclude screen enclosures
      // Screen enclosures make BOTH AI and Solar report larger areas
      // The smaller value is more likely to be the actual shingled roof
      if (calculatedArea > solarFootprint) {
        console.log(`📐 FLORIDA FIX: AI area (${calculatedArea.toFixed(0)} sqft) > Solar (${solarFootprint.toFixed(0)} sqft) - using Solar as it likely excludes screen enclosure`)
        calculatedArea = solarFootprint
      } else {
        console.log(`📐 FLORIDA FIX: AI area (${calculatedArea.toFixed(0)} sqft) < Solar (${solarFootprint.toFixed(0)} sqft) - keeping AI as it likely excludes screen enclosure`)
        // Keep calculatedArea as-is since it's smaller
      }
    } else {
      // NON-FLORIDA: Standard variance check
      const varianceThreshold = ROOF_AREA_CAPS.SOLAR_VARIANCE_THRESHOLD
      
      if (variance > varianceThreshold) {
        console.warn(`⚠️ AI area ${calculatedArea.toFixed(0)} sqft is ${(variance * 100).toFixed(1)}% off from Solar API ${solarFootprint.toFixed(0)} sqft (threshold: ${(varianceThreshold * 100).toFixed(0)}%)`)
        console.log(`📐 OVERRIDE: Using Solar API footprint as ground truth`)
        calculatedArea = solarFootprint
      }
    }
  }
  
  // VALIDATION 2: Hard caps for unrealistic measurements
  if (calculatedArea < ROOF_AREA_CAPS.MIN_RESIDENTIAL) {
    console.warn(`⚠️ Area ${calculatedArea.toFixed(0)} sqft below minimum, capping at ${ROOF_AREA_CAPS.MIN_RESIDENTIAL}`)
    calculatedArea = ROOF_AREA_CAPS.MIN_RESIDENTIAL
  }
  
  if (calculatedArea > ROOF_AREA_CAPS.MAX_RESIDENTIAL) {
    // Check if Solar API confirms it's a large property
    const solarConfirmsLarge = solarData?.buildingFootprintSqft && solarData.buildingFootprintSqft > ROOF_AREA_CAPS.MAX_RESIDENTIAL
    
    if (!solarConfirmsLarge) {
      console.warn(`⚠️ Area ${calculatedArea.toFixed(0)} sqft exceeds residential cap of ${ROOF_AREA_CAPS.MAX_RESIDENTIAL}`)
      
      // If Solar API available, use it; otherwise cap
      if (solarData?.available && solarData?.buildingFootprintSqft) {
        console.log(`📐 OVERRIDE: Using Solar API footprint ${solarData.buildingFootprintSqft.toFixed(0)} sqft`)
        calculatedArea = solarData.buildingFootprintSqft
      } else {
        console.log(`📐 HARD CAP: Limiting to ${ROOF_AREA_CAPS.MAX_RESIDENTIAL} sqft (typical max residential)`)
        calculatedArea = ROOF_AREA_CAPS.MAX_RESIDENTIAL
      }
    } else {
      console.log(`📐 Solar API confirms large property: ${solarData.buildingFootprintSqft.toFixed(0)} sqft`)
    }
  }
  
  console.log(`📐 Final validated area: ${calculatedArea.toFixed(0)} sqft`)
  return calculatedArea
}

// Derive facet count from roof geometry AND detected linear features
function deriveFacetCountFromGeometry(
  perimeterVertices: any[],
  interiorJunctions: any[],
  roofType: string,
  hipLineCount: number = 0,
  ridgeLineCount: number = 0
): number {
  // IMPROVED: Use detected hip/ridge lines as primary source
  // Hip roof: typically 4 facets = 4 hip lines
  // Cross-hip: 6-8 facets = 6-8 hip lines
  // Gable roof: typically 2 facets = 0 hip lines, 1 ridge
  
  console.log(`📐 Facet derivation: hipLines=${hipLineCount}, ridgeLines=${ridgeLineCount}, roofType=${roofType}`)
  
  // PRIMARY: Use detected hip line count
  if (hipLineCount >= 4) {
    // Hip roofs: facet count equals hip line count
    // 4 hips = 4 facets (simple hip)
    // 6+ hips = cross-hip or complex (more facets)
    return hipLineCount
  }
  
  // SECONDARY: Check perimeter vertices for hip corners
  const hipCorners = perimeterVertices?.filter((v: any) => 
    v.cornerType === 'hip-corner' || v.type === 'hip-junction'
  ).length || 0
  
  const ridgeEnds = perimeterVertices?.filter((v: any) => 
    v.cornerType === 'ridge-end'
  ).length || 0
  
  const interiorCount = interiorJunctions?.length || 0
  
  // Use hip corners if we have them
  if (hipCorners >= 4) {
    return hipCorners + Math.floor(interiorCount / 2)
  }
  
  // Check for gable roof
  if (roofType === 'gable' || (ridgeLineCount >= 1 && hipLineCount === 0)) {
    return 2 + Math.floor(interiorCount / 2)
  }
  
  // Partial hip (2-3 hip lines)
  if (hipLineCount >= 2) {
    return Math.max(4, hipLineCount + 1)
  }
  
  // FALLBACK: Estimate from perimeter complexity
  const vertexCount = perimeterVertices?.length || 0
  if (vertexCount >= 12) return 6
  if (vertexCount >= 8) return 4
  if (vertexCount >= 6) return 4 // Changed from 3 to 4 - more typical
  
  // Default to 4 for residential (most common)
  return 4
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
    linearFeatures, imageSource, imageYear, perimeterWkt, visionEdges, imageSize,
    vertexStats  // NEW: vertex statistics
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
    validation_status: 'pending',
    // NEW: Vertex statistics for Roofr-quality tracking
    vertex_count: vertexStats?.totalCount || 0,
    perimeter_vertex_count: vertexStats?.totalCount || 0,
    interior_vertex_count: 0, // Will be updated after interior detection
    hip_corner_count: vertexStats?.hipCornerCount || 0,
    valley_entry_count: vertexStats?.valleyEntryCount || 0,
    gable_peak_count: vertexStats?.gablePeakCount || 0
  }).select().single()

  if (error) {
    console.error('Failed to save measurement:', error)
    throw new Error(`Database save failed: ${error.message}`)
  }

  console.log('💾 Saved measurement:', data.id)
  return data
}

// Save vertices to dedicated table for Roofr-quality tracking
async function saveVerticesToDatabase(
  supabase: any,
  measurementId: string,
  perimeterVertices: any[],
  interiorJunctions: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): Promise<void> {
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  // Convert percentage to lat/lng
  const toLatLng = (x: number, y: number) => {
    const pixelX = ((x / 100) - 0.5) * imageSize
    const pixelY = ((y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    return {
      lat: imageCenter.lat - (metersY / metersPerDegLat),
      lng: imageCenter.lng + (metersX / metersPerDegLng)
    }
  }
  
  // Map cornerType to valid vertex_type enum
  const mapCornerType = (cornerType: string): string => {
    const mapping: Record<string, string> = {
      'hip-corner': 'hip-corner',
      'valley-entry': 'valley-entry',
      'gable-peak': 'gable-peak',
      'eave-corner': 'eave-corner',
      'rake-corner': 'rake-corner',
      'dormer-junction': 'dormer-junction',
      'ridge-end': 'gable-peak',
      'corner': 'eave-corner'
    }
    return mapping[cornerType] || 'unclassified'
  }
  
  // Map junction type to valid vertex_type enum
  const mapJunctionType = (type: string): string => {
    const mapping: Record<string, string> = {
      'ridge-hip-junction': 'ridge-hip-junction',
      'ridge-valley-junction': 'ridge-valley-junction',
      'hip-hip-junction': 'hip-hip-junction',
      'valley-hip-junction': 'valley-hip-junction',
      'ridge-termination': 'ridge-termination',
      'hip-peak': 'hip-peak'
    }
    return mapping[type] || 'ridge-hip-junction'
  }
  
  const vertexRecords: any[] = []
  
  // Process perimeter vertices
  perimeterVertices.forEach((v, index) => {
    const coords = toLatLng(v.x, v.y)
    vertexRecords.push({
      measurement_id: measurementId,
      x_percent: v.x,
      y_percent: v.y,
      lat: coords.lat,
      lng: coords.lng,
      location_type: 'perimeter',
      vertex_type: mapCornerType(v.cornerType || v.type || 'corner'),
      sequence_order: index,
      detection_confidence: 75,
      detection_source: 'ai_vision'
    })
  })
  
  // Process interior junctions
  interiorJunctions.forEach((j, index) => {
    const coords = toLatLng(j.x, j.y)
    vertexRecords.push({
      measurement_id: measurementId,
      x_percent: j.x,
      y_percent: j.y,
      lat: coords.lat,
      lng: coords.lng,
      location_type: 'interior',
      vertex_type: mapJunctionType(j.type || 'ridge-hip-junction'),
      sequence_order: index,
      detection_confidence: 70,
      detection_source: 'ai_vision'
    })
  })
  
  if (vertexRecords.length > 0) {
    const { error } = await supabase
      .from('roof_measurement_vertices')
      .insert(vertexRecords)
    
    if (error) {
      console.error('⚠️ Failed to save vertices:', error.message)
    } else {
      console.log(`💾 Saved ${vertexRecords.length} vertices (${perimeterVertices.length} perimeter, ${interiorJunctions.length} interior)`)
    }
  }
  
  // Update measurement record with interior vertex count
  if (interiorJunctions.length > 0) {
    await supabase
      .from('roof_measurements')
      .update({ 
        interior_vertex_count: interiorJunctions.length,
        vertex_count: perimeterVertices.length + interiorJunctions.length,
        edge_count: 0 // Will be updated by saveEdgesToDatabase
      })
      .eq('id', measurementId)
  }
}

// Save edges to dedicated table for Roofr-quality tracking
async function saveEdgesToDatabase(
  supabase: any,
  measurementId: string,
  derivedLines: DerivedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): Promise<void> {
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  // Convert percentage to lat/lng
  const toLatLng = (x: number, y: number) => {
    const pixelX = ((x / 100) - 0.5) * imageSize
    const pixelY = ((y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    return {
      lat: imageCenter.lat - (metersY / metersPerDegLat),
      lng: imageCenter.lng + (metersX / metersPerDegLng)
    }
  }
  
  // Calculate length in feet from percentage coordinates
  const calculateLengthFt = (startX: number, startY: number, endX: number, endY: number): number => {
    const startPixelX = ((startX / 100) - 0.5) * imageSize
    const startPixelY = ((startY / 100) - 0.5) * imageSize
    const endPixelX = ((endX / 100) - 0.5) * imageSize
    const endPixelY = ((endY / 100) - 0.5) * imageSize
    
    const dx = (endPixelX - startPixelX) * metersPerPixel
    const dy = (endPixelY - startPixelY) * metersPerPixel
    return Math.sqrt(dx * dx + dy * dy) * 3.28084
  }
  
  const edgeRecords: any[] = []
  
  derivedLines.forEach((line) => {
    const startCoords = toLatLng(line.startX, line.startY)
    const endCoords = toLatLng(line.endX, line.endY)
    const lengthFt = calculateLengthFt(line.startX, line.startY, line.endX, line.endY)
    
    // Determine if perimeter or interior based on edge type
    const isInterior = ['ridge', 'hip', 'valley'].includes(line.type)
    
    edgeRecords.push({
      measurement_id: measurementId,
      edge_type: line.type,
      edge_position: isInterior ? 'interior' : 'perimeter',
      length_ft: Math.round(lengthFt * 10) / 10,
      wkt_geometry: `LINESTRING(${startCoords.lng.toFixed(8)} ${startCoords.lat.toFixed(8)}, ${endCoords.lng.toFixed(8)} ${endCoords.lat.toFixed(8)})`,
      detection_confidence: 70,
      detection_source: 'vertex_derived'
    })
  })
  
  if (edgeRecords.length > 0) {
    const { error } = await supabase
      .from('roof_measurement_edges')
      .insert(edgeRecords)
    
    if (error) {
      console.error('⚠️ Failed to save edges:', error.message)
    } else {
      console.log(`💾 Saved ${edgeRecords.length} edges`)
      
      // Update measurement record with edge count
      await supabase
        .from('roof_measurements')
        .update({ edge_count: edgeRecords.length })
        .eq('id', measurementId)
    }
  }
}

// Generate facet polygons from perimeter vertices and interior junctions
// This creates approximate facet regions based on the detected roof geometry
function generateFacetPolygons(
  perimeterVertices: any[],
  interiorJunctions: any[],
  derivedLines: DerivedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number,
  facetCount: number,
  predominantPitch: string
): any[] {
  if (!perimeterVertices || perimeterVertices.length < 4) {
    console.log('⚠️ Not enough vertices to generate facet polygons')
    return []
  }
  
  console.log(`📐 Generating ${facetCount} facet polygons from ${perimeterVertices.length} vertices`)
  
  const facetPolygons: any[] = []
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  // Helper: Convert percentage coordinates to lat/lng
  const toLatLng = (pt: { x: number; y: number }) => {
    const pixelX = ((pt.x / 100) - 0.5) * imageSize
    const pixelY = ((pt.y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    return {
      lng: imageCenter.lng + (metersX / metersPerDegLng),
      lat: imageCenter.lat - (metersY / metersPerDegLat)
    }
  }
  
  // Get ridge lines for splitting
  const ridgeLines = derivedLines.filter(l => l.type === 'ridge')
  const hipLines = derivedLines.filter(l => l.type === 'hip')
  
  // Calculate perimeter centroid
  const centroidX = perimeterVertices.reduce((sum, v) => sum + v.x, 0) / perimeterVertices.length
  const centroidY = perimeterVertices.reduce((sum, v) => sum + v.y, 0) / perimeterVertices.length
  const centroid = toLatLng({ x: centroidX, y: centroidY })
  
  // Calculate total perimeter area for distribution
  const totalArea = calculatePolygonAreaFromPercentVertices(perimeterVertices, imageCenter, imageSize, zoom)
  const areaPerFacet = totalArea / facetCount
  
  // Determine facet directions based on hip line count
  const directions = ['north', 'south', 'east', 'west', 'northeast', 'southeast', 'southwest', 'northwest']
  
  // For hip roofs (4+ facets), create radial slices from centroid to perimeter
  if (facetCount >= 4 && (hipLines.length >= 2 || ridgeLines.length >= 1)) {
    // Group perimeter vertices by quadrant
    const verticesWithAngles = perimeterVertices.map(v => {
      const angle = Math.atan2(v.y - centroidY, v.x - centroidX) * 180 / Math.PI
      return { ...v, angle: (angle + 360) % 360 }
    }).sort((a, b) => a.angle - b.angle)
    
    // Divide perimeter into facetCount segments
    const segmentSize = Math.ceil(verticesWithAngles.length / facetCount)
    
    for (let i = 0; i < facetCount; i++) {
      const startIdx = i * segmentSize
      const endIdx = Math.min((i + 1) * segmentSize, verticesWithAngles.length)
      const segmentVertices = verticesWithAngles.slice(startIdx, endIdx)
      
      if (segmentVertices.length >= 2) {
        // Create facet polygon: centroid + perimeter segment
        const facetPoints: { lng: number; lat: number }[] = [centroid]
        segmentVertices.forEach(v => {
          facetPoints.push(toLatLng(v))
        })
        facetPoints.push(centroid) // Close polygon
        
        // Calculate facet centroid
        const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
        const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
        
        // Determine primary direction based on facet position relative to building center
        const avgAngle = segmentVertices.reduce((sum, v) => sum + v.angle, 0) / segmentVertices.length
        const primaryDirection = getDirectionFromAngle(avgAngle)
        
        facetPolygons.push({
          facetNumber: i + 1,
          points: facetPoints,
          centroid: { lng: facetCentroidLng, lat: facetCentroidLat },
          primaryDirection,
          azimuthDegrees: avgAngle,
          shapeType: 'triangular',
          areaEstimate: areaPerFacet
        })
      }
    }
  } else if (facetCount === 2 && ridgeLines.length >= 1) {
    // Gable roof: split by ridge line
    const ridge = ridgeLines[0]
    const ridgeMidY = (ridge.startY + ridge.endY) / 2
    
    // North side (above ridge)
    const northVertices = perimeterVertices.filter(v => v.y < ridgeMidY)
    // South side (below ridge)
    const southVertices = perimeterVertices.filter(v => v.y >= ridgeMidY)
    
    if (northVertices.length >= 2) {
      const facetPoints = northVertices.map(toLatLng)
      facetPoints.push(facetPoints[0]) // Close
      const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
      const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
      
      facetPolygons.push({
        facetNumber: 1,
        points: facetPoints,
        centroid: { lng: facetCentroidLng, lat: facetCentroidLat },
        primaryDirection: 'north',
        azimuthDegrees: 0,
        shapeType: 'rectangular',
        areaEstimate: areaPerFacet
      })
    }
    
    if (southVertices.length >= 2) {
      const facetPoints = southVertices.map(toLatLng)
      facetPoints.push(facetPoints[0]) // Close
      const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
      const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
      
      facetPolygons.push({
        facetNumber: 2,
        points: facetPoints,
        centroid: { lng: facetCentroidLng, lat: facetCentroidLat },
        primaryDirection: 'south',
        azimuthDegrees: 180,
        shapeType: 'rectangular',
        areaEstimate: areaPerFacet
      })
    }
  }
  
  // If we couldn't generate enough facets, create equal area divisions
  if (facetPolygons.length < facetCount) {
    console.log(`📐 Fallback: Creating ${facetCount} equal-area facet regions`)
    const perimeterLatLngs = perimeterVertices.map(toLatLng)
    
    // Create simple equal divisions along the perimeter
    const verticesPerFacet = Math.ceil(perimeterVertices.length / facetCount)
    
    for (let i = facetPolygons.length; i < facetCount; i++) {
      const startIdx = i * verticesPerFacet
      const endIdx = Math.min((i + 1) * verticesPerFacet, perimeterVertices.length)
      const segmentVertices = perimeterVertices.slice(startIdx, endIdx)
      
      if (segmentVertices.length >= 2) {
        const facetPoints = segmentVertices.map(toLatLng)
        facetPoints.push(centroid)
        facetPoints.push(facetPoints[0])
        
        const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
        const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
        
        facetPolygons.push({
          facetNumber: i + 1,
          points: facetPoints,
          centroid: { lng: facetCentroidLng, lat: facetCentroidLat },
          primaryDirection: directions[i % directions.length],
          azimuthDegrees: (i * 360 / facetCount),
          shapeType: 'complex',
          areaEstimate: areaPerFacet
        })
      }
    }
  }
  
  console.log(`📐 Generated ${facetPolygons.length} facet polygons`)
  return facetPolygons
}

// Calculate polygon area from percentage-based vertices
function calculatePolygonAreaFromPercentVertices(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): number {
  if (!vertices || vertices.length < 3) return 0
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  
  const feetVertices = vertices.map(v => ({
    x: ((v.x / 100) - 0.5) * imageSize * metersPerPixel * 3.28084,
    y: ((v.y / 100) - 0.5) * imageSize * metersPerPixel * 3.28084
  }))
  
  let area = 0
  for (let i = 0; i < feetVertices.length; i++) {
    const j = (i + 1) % feetVertices.length
    area += feetVertices[i].x * feetVertices[j].y
    area -= feetVertices[j].x * feetVertices[i].y
  }
  
  return Math.abs(area / 2)
}

// Get compass direction from angle
function getDirectionFromAngle(angleDegrees: number): string {
  const normalized = (angleDegrees + 360) % 360
  if (normalized >= 337.5 || normalized < 22.5) return 'east'
  if (normalized >= 22.5 && normalized < 67.5) return 'southeast'
  if (normalized >= 67.5 && normalized < 112.5) return 'south'
  if (normalized >= 112.5 && normalized < 157.5) return 'southwest'
  if (normalized >= 157.5 && normalized < 202.5) return 'west'
  if (normalized >= 202.5 && normalized < 247.5) return 'northwest'
  if (normalized >= 247.5 && normalized < 292.5) return 'north'
  return 'northeast'
}

// Save facet polygons to database
async function saveFacetsToDatabase(
  supabase: any,
  measurementId: string,
  facetPolygons: any[],
  measurements: any
): Promise<void> {
  const pitchMultiplier = getSlopeFactorFromPitch(measurements.predominantPitch) || 1.083
  
  const facetRecords = facetPolygons.map(facet => ({
    measurement_id: measurementId,
    facet_number: facet.facetNumber,
    polygon_points: facet.points,
    centroid: facet.centroid,
    shape_type: facet.shapeType,
    area_flat_sqft: facet.areaEstimate,
    pitch: measurements.predominantPitch,
    pitch_multiplier: pitchMultiplier,
    area_adjusted_sqft: facet.areaEstimate * pitchMultiplier,
    primary_direction: facet.primaryDirection,
    azimuth_degrees: facet.azimuthDegrees,
    detection_confidence: 70 // Default moderate confidence for AI-generated facets
  }))
  
  const { error } = await supabase
    .from('roof_measurement_facets')
    .insert(facetRecords)
  
  if (error) {
    console.error('⚠️ Failed to save facets:', error.message)
  } else {
    console.log(`💾 Saved ${facetRecords.length} facet records`)
  }
}
