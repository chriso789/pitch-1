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

// PLANIMETER ACCURACY THRESHOLDS
const PLANIMETER_THRESHOLDS = {
  MIN_SPAN_PCT: 15,           // Minimum span (x or y) as % of image - was causing under-detection
  MAX_SEGMENT_LENGTH_FT: 55,  // Flag segments longer than this
  MIN_VERTICES_PER_100FT: 4,  // Expect ~4 vertices per 100ft perimeter
  RE_DETECT_THRESHOLD: 0.70,  // Re-detect if perimeter < 70% expected
  AREA_TOLERANCE: 0.05,       // Target 5% accuracy vs Planimeter
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

    // Initialize Supabase client early for historical lookup
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // STREAMLINED: Fetch imagery and Solar API data in parallel
    const [googleImage, solarDataRaw, mapboxImage] = await Promise.all([
      fetchGoogleStaticMap(coordinates),
      fetchGoogleSolarData(coordinates),
      fetchMapboxSatellite(coordinates)
    ])
    
    console.log(`⏱️ Image fetch complete: ${Date.now() - startTime}ms`)
    
    // PHASE 1: Historical Solar API Fallback when current Solar API fails
    let solarData = solarDataRaw
    if (!solarData.available && customerId) {
      console.log(`⚠️ Solar API unavailable, checking for historical data...`)
      
      try {
        const { data: historicalMeasurement, error: histError } = await supabaseClient
          .from('roof_measurements')
          .select('solar_building_footprint_sqft, solar_api_response, created_at')
          .eq('customer_id', customerId)
          .not('solar_building_footprint_sqft', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
        
        if (histError) {
          console.log(`📐 No historical Solar data found for customer: ${histError.message}`)
        } else if (historicalMeasurement?.solar_building_footprint_sqft) {
          const historicalDate = new Date(historicalMeasurement.created_at).toLocaleDateString()
          console.log(`📐 ✅ Using HISTORICAL Solar data from ${historicalDate}: ${historicalMeasurement.solar_building_footprint_sqft.toFixed(0)} sqft`)
          
          solarData = {
            available: true,
            buildingFootprintSqft: historicalMeasurement.solar_building_footprint_sqft,
            estimatedPerimeterFt: 4 * Math.sqrt(historicalMeasurement.solar_building_footprint_sqft),
            roofSegmentCount: 0,
            roofSegments: [],
            boundingBox: null,
            isHistorical: true,
            historicalDate
          }
        }
      } catch (histErr) {
        console.error('Historical lookup error:', histErr)
      }
    }

    // Select best image (prefer Google Maps for better measurement accuracy)
    const selectedImage = googleImage.url ? googleImage : mapboxImage
    const imageSource = selectedImage.source
    const imageYear = new Date().getFullYear()
    
    // CRITICAL FIX: For coordinate conversion, we use LOGICAL size (what the zoom level represents)
    const logicalImageSize = 640
    const actualImageSize = selectedImage.source === 'mapbox' ? 1280 : 640
    
    console.log(`✅ Using: ${imageSource} (${actualImageSize}x${actualImageSize} pixels, ${logicalImageSize}x${logicalImageSize} logical)`)

    // NEW VERTEX-BASED DETECTION APPROACH (Roofr-quality)
    // Pass 1: Isolate target building with EXPANDED bounds for larger roofs
    const buildingIsolation = await isolateTargetBuilding(selectedImage.url, address, coordinates, solarData)
    console.log(`⏱️ Pass 1 (building isolation) complete: ${Date.now() - startTime}ms`)
    
    // Pass 2: Detect perimeter vertices with FULL IMAGE TRACING
    let perimeterResult = await detectPerimeterVertices(selectedImage.url, buildingIsolation.bounds, solarData, coordinates, logicalImageSize)
    console.log(`⏱️ Pass 2 (perimeter vertices) complete: ${Date.now() - startTime}ms`)
    
    // NEW: FOOTPRINT SANITY CHECK - verify vertices span the full roof
    const footprintCheck = validateFootprintCoverage(perimeterResult.vertices, buildingIsolation.bounds, solarData, coordinates, logicalImageSize)
    console.log(`📐 Footprint check: span=${footprintCheck.spanXPct.toFixed(1)}% x ${footprintCheck.spanYPct.toFixed(1)}%, perimeter=${footprintCheck.estimatedPerimeterFt.toFixed(0)}ft, ${footprintCheck.longSegments.length} long segments`)
    
    // If footprint check fails, run CORNER COMPLETION PASS
    if (!footprintCheck.isValid) {
      console.warn(`⚠️ FOOTPRINT CHECK FAILED: ${footprintCheck.failureReason}`)
      console.log(`🔄 Running corner completion pass...`)
      
      // Expand bounds and re-detect
      const expandedBounds = {
        topLeftX: Math.max(5, buildingIsolation.bounds.topLeftX - 10),
        topLeftY: Math.max(5, buildingIsolation.bounds.topLeftY - 10),
        bottomRightX: Math.min(95, buildingIsolation.bounds.bottomRightX + 10),
        bottomRightY: Math.min(95, buildingIsolation.bounds.bottomRightY + 10)
      }
      
      // Re-detect with expanded bounds and explicit instructions to find missing corners
      const redetectedResult = await detectPerimeterVerticesWithCornerFocus(
        selectedImage.url, 
        expandedBounds, 
        perimeterResult.vertices,
        footprintCheck.longSegments,
        solarData,
        coordinates,
        logicalImageSize
      )
      
      // Use re-detected result if it has more vertices and better coverage
      if (redetectedResult.vertices.length > perimeterResult.vertices.length) {
        console.log(`✅ Corner completion found ${redetectedResult.vertices.length - perimeterResult.vertices.length} additional vertices`)
        perimeterResult = redetectedResult
      }
    }
    
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
      IMAGE_ZOOM,
      solarData,
      address
    )
    console.log(`📐 Validated area from perimeter: ${actualAreaSqft.toFixed(0)} sqft`)
    
    // Derive facet count from roof geometry AND detected lines
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
        estimatedAreaSqft: actualAreaSqft,
        edges: { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0 },
        features: { chimneys: 0, skylights: 0, vents: 0 },
        orientation: 'mixed'
      }],
      boundingBox: buildingIsolation.bounds,
      roofPerimeter: perimeterResult.vertices,
      edgeSegments: [],
      overallComplexity: perimeterResult.complexity || 'moderate',
      shadowAnalysis: { estimatedPitchRange: '4/12 to 7/12', confidence: 'medium' },
      detectionNotes: 'Vertex-based detection with corner completion',
      derivedFacetCount,
      footprintValidation: footprintCheck
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
    
    // Convert derived lines to WKT
    const linearFeatures = convertDerivedLinesToWKT(
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    
    // Convert perimeter to WKT polygon
    const perimeterWkt = convertPerimeterToWKT(
      perimeterResult.vertices,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )

    console.log(`📏 Generated ${linearFeatures.length} vertex-derived linear features`)

    // Re-use supabase client created earlier
    const supabase = supabaseClient
    
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
      vertexStats,
      footprintValidation: footprintCheck
    })
    
    // Save vertices and edges to dedicated tables
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
    
    // Generate and save facet polygons - ALWAYS save at least 1 facet
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
    
    // Track facet generation status
    const facetGenerationStatus = {
      requested: derivedFacetCount,
      generated: facetPolygons.length,
      status: facetPolygons.length >= 1 ? 'ok' : 'failed',
      hasFallback: facetPolygons.some((f: any) => f.isFallback)
    }
    console.log(`📐 Facet generation:`, facetGenerationStatus)
    
    // ALWAYS save facets if we have at least 1
    if (facetPolygons.length > 0) {
      await saveFacetsToDatabase(supabase, measurementRecord.id, facetPolygons, measurements)
    } else {
      console.error('⚠️ No facets generated')
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
          },
          footprintValidation: footprintCheck
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
    
    // ENHANCED: Better error logging for 403/quota issues
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error body')
      console.error(`❌ Google Solar API error: ${response.status} - ${errorText}`)
      
      // Log specific error types for debugging
      if (response.status === 403) {
        console.error('🔑 403 Forbidden - Check: API key validity, billing status, or quota exceeded')
      } else if (response.status === 429) {
        console.error('⏱️ 429 Rate Limited - Too many requests')
      }
      
      return { available: false, buildingFootprintSqft: null, roofSegmentCount: 0, linearFeatures: [], error: `${response.status}` }
    }
    
    const data = await response.json()
    const buildingFootprintSqm = data.solarPotential?.buildingStats?.areaMeters2 || 0
    const buildingFootprintSqft = buildingFootprintSqm * 10.764
    const roofSegments = data.solarPotential?.roofSegmentStats || []
    const boundingBox = data.boundingBox || null
    
    // Calculate expected perimeter from Solar API footprint (for validation)
    // Rough estimate: perimeter ≈ 4 * sqrt(area) for rectangular shapes
    const estimatedPerimeterFt = 4 * Math.sqrt(buildingFootprintSqft)
    
    console.log(`✅ Solar API: ${buildingFootprintSqft.toFixed(0)} sqft footprint, ${roofSegments.length} segments`)
    
    return {
      available: true,
      buildingFootprintSqft,
      estimatedPerimeterFt,
      roofSegmentCount: roofSegments.length,
      roofSegments: roofSegments.map((s: any) => ({ 
        pitchDegrees: s.pitchDegrees, 
        azimuthDegrees: s.azimuthDegrees, 
        areaMeters2: s.stats?.areaMeters2,
        planeHeightAtCenter: s.planeHeightAtCenterMeters,
        boundingBox: s.boundingBox
      })),
      boundingBox,
      rawData: data,
      isHistorical: false
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

// NEW: Validate that detected footprint covers the full roof
function validateFootprintCoverage(
  vertices: any[],
  bounds: any,
  solarData: any,
  coordinates: { lat: number; lng: number },
  imageSize: number
): {
  isValid: boolean;
  failureReason: string | null;
  spanXPct: number;
  spanYPct: number;
  estimatedPerimeterFt: number;
  expectedPerimeterFt: number;
  longSegments: { index: number; lengthFt: number }[];
  vertexCount: number;
  expectedMinVertices: number;
} {
  if (!vertices || vertices.length < 4) {
    return {
      isValid: false,
      failureReason: 'Too few vertices detected',
      spanXPct: 0,
      spanYPct: 0,
      estimatedPerimeterFt: 0,
      expectedPerimeterFt: 0,
      longSegments: [],
      vertexCount: vertices?.length || 0,
      expectedMinVertices: 8
    }
  }
  
  // Calculate span in percentage
  const xValues = vertices.map(v => v.x)
  const yValues = vertices.map(v => v.y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const spanXPct = maxX - minX
  const spanYPct = maxY - minY
  
  // Calculate perimeter in feet
  const metersPerPixel = (156543.03392 * Math.cos(coordinates.lat * Math.PI / 180)) / Math.pow(2, IMAGE_ZOOM)
  let perimeterFt = 0
  const segmentLengths: { index: number; lengthFt: number }[] = []
  
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i]
    const v2 = vertices[(i + 1) % vertices.length]
    const dx = ((v2.x - v1.x) / 100) * imageSize * metersPerPixel
    const dy = ((v2.y - v1.y) / 100) * imageSize * metersPerPixel
    const segmentFt = Math.sqrt(dx * dx + dy * dy) * 3.28084
    perimeterFt += segmentFt
    segmentLengths.push({ index: i, lengthFt: segmentFt })
  }
  
  // Flag long segments (potential missed corners)
  const longSegments = segmentLengths.filter(s => s.lengthFt > PLANIMETER_THRESHOLDS.MAX_SEGMENT_LENGTH_FT)
  
  // Expected perimeter from Solar API or estimate from bounds
  const expectedPerimeterFt = solarData?.estimatedPerimeterFt || 
    (2 * (spanXPct / 100 * imageSize * metersPerPixel * 3.28084) + 
     2 * (spanYPct / 100 * imageSize * metersPerPixel * 3.28084))
  
  // Expected vertex count based on perimeter
  const expectedMinVertices = Math.max(8, Math.ceil(perimeterFt * PLANIMETER_THRESHOLDS.MIN_VERTICES_PER_100FT / 100))
  
  // Validation checks
  let isValid = true
  let failureReason: string | null = null
  
  // Check 1: Span must cover reasonable portion of bounds
  if (spanXPct < PLANIMETER_THRESHOLDS.MIN_SPAN_PCT || spanYPct < PLANIMETER_THRESHOLDS.MIN_SPAN_PCT) {
    isValid = false
    failureReason = `Span too small: ${spanXPct.toFixed(1)}% x ${spanYPct.toFixed(1)}% (min ${PLANIMETER_THRESHOLDS.MIN_SPAN_PCT}%)`
  }
  
  // Check 2: Perimeter should match expected (Solar API comparison)
  if (solarData?.available && solarData?.estimatedPerimeterFt) {
    const perimeterRatio = perimeterFt / solarData.estimatedPerimeterFt
    if (perimeterRatio < PLANIMETER_THRESHOLDS.RE_DETECT_THRESHOLD) {
      isValid = false
      failureReason = `Perimeter ${perimeterFt.toFixed(0)}ft is only ${(perimeterRatio * 100).toFixed(0)}% of expected ${solarData.estimatedPerimeterFt.toFixed(0)}ft`
    }
  }
  
  // Check 3: Too many long segments indicates missed corners
  if (longSegments.length >= 3) {
    isValid = false
    failureReason = `${longSegments.length} segments > ${PLANIMETER_THRESHOLDS.MAX_SEGMENT_LENGTH_FT}ft - likely missing corners`
  }
  
  // Check 4: Vertex count should match expected
  if (vertices.length < expectedMinVertices * 0.6) {
    isValid = false
    failureReason = `Only ${vertices.length} vertices, expected at least ${expectedMinVertices} for ${perimeterFt.toFixed(0)}ft perimeter`
  }
  
  return {
    isValid,
    failureReason,
    spanXPct,
    spanYPct,
    estimatedPerimeterFt: perimeterFt,
    expectedPerimeterFt,
    longSegments,
    vertexCount: vertices.length,
    expectedMinVertices
  }
}

// PASS 1: Isolate target building - EXPANDED for larger/complex roofs
// Now accepts Solar API data to estimate expected building size
async function isolateTargetBuilding(
  imageUrl: string, 
  address: string, 
  coordinates: { lat: number; lng: number },
  solarData?: any
) {
  if (!imageUrl) {
    return { bounds: { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 }, confidence: 'low' }
  }

  // Estimate expected bounds from Solar API
  let solarSizeHint = ''
  if (solarData?.available && solarData?.buildingFootprintSqft) {
    const estWidthFt = Math.sqrt(solarData.buildingFootprintSqft * 1.3) // Account for elongated shapes
    // At zoom 20, 1% of 640px image ≈ 1 meter ≈ 3.28 ft
    // So a 60ft wide building is about 60/3.28 = 18.3 meters = ~18% of image
    const estWidthPct = (estWidthFt / 3.28) / 6.4 * 100
    solarSizeHint = `
Solar API indicates building is approximately ${solarData.buildingFootprintSqft.toFixed(0)} sqft.
Expected roof width: ~${estWidthFt.toFixed(0)}ft which is approximately ${estWidthPct.toFixed(0)}% of image width.
For this size building, expect bounds of roughly ${Math.max(20, 50 - estWidthPct/2).toFixed(0)}% to ${Math.min(80, 50 + estWidthPct/2).toFixed(0)}%.`
  }

  // Detect Florida addresses (high screen enclosure rate)
  const isFlorida = isFloridaAddress(address)
  const floridaWarning = isFlorida ? `
⚠️ FLORIDA PROPERTY - CRITICAL WARNINGS:
1. Many Florida homes have LARGE SCREEN ENCLOSURES over pools/patios - these appear as metal grid structures
2. DO NOT include screen enclosures in the roof bounds - they are NOT part of the roof
3. Adjacent lanai structures with FLAT or METAL roofs are NOT the main roof
4. Only trace the MAIN SHINGLED/TILED residential roof structure
5. If you see a large rectangular metal grid structure, that is a POOL ENCLOSURE - exclude it!` : ''

  const prompt = `You are a roof measurement expert. Analyze this satellite image.

TASK: Find the MAIN RESIDENTIAL BUILDING at the EXACT CENTER of the image.
The GPS coordinates point to the center of this image, so the target house is in the middle.
${solarSizeHint}
${floridaWarning}

CRITICAL - SINGLE BUILDING RULE:
You must trace ONLY ONE building - the PRIMARY residential structure with a shingled/tiled roof.
If you detect multiple separate roof structures, trace ONLY the CENTER one (the main house).
NEVER combine two separate buildings into one trace - this causes 100% measurement error!

Return a bounding box that FULLY ENCOMPASSES the SHINGLED/TILED ROOF - trace to the OUTERMOST EAVE EDGES.

CRITICAL: Do NOT make the box too tight! Include:
- All roof overhangs and eaves
- Attached garages (with shingled roof)
- All bump-outs, dormers, and extensions
- The COMPLETE L-shape or T-shape if applicable

ABSOLUTELY DO NOT INCLUDE:
- Detached garages or carports (SEPARATE buildings)
- Sheds or outbuildings
- Swimming pools or patios
- Screen enclosures (metal grid structures) - VERY common in Florida
- Covered patios with flat/metal roofs
- Adjacent guest houses or casitas
- Any structure that is PHYSICALLY SEPARATED from the main house

{
  "targetBuildingBounds": {
    "topLeftX": 32.0,
    "topLeftY": 28.0,
    "bottomRightX": 68.0,
    "bottomRightY": 72.0
  },
  "estimatedRoofWidthFt": 55,
  "estimatedRoofLengthFt": 70,
  "roofShape": "L-shaped|rectangular|T-shaped|complex",
  "otherBuildingsDetected": 1,
  "screenEnclosureDetected": false,
  "targetBuildingType": "residential",
  "confidenceTargetIsCorrect": "high",
  "multipleStructuresWarning": false
}

SIZING RULES:
1. The main house is CENTERED in the image (around 35-65% x and y range typically)
2. LARGER roofs (3000+ sqft) can span 35-45% of image width
3. Complex L-shaped or T-shaped roofs need WIDER bounds
4. Better to be slightly too large than miss roof edges
5. Minimum bounds width: 20% (for small homes)
6. Maximum bounds width: 50% (for large/complex homes)
7. If you detect 2+ buildings, set multipleStructuresWarning: true
8. Use DECIMAL precision (e.g., 32.5, not 33)
9. Return ONLY valid JSON, no explanation`

  console.log('🏠 Pass 1: Isolating target building with expanded bounds...')
  
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
      return { bounds: { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 }, confidence: 'low' }
    }
    
    let content = data.choices[0].message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    const result = JSON.parse(content)
    let bounds = result.targetBuildingBounds || { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 }
    
    // VALIDATION: More permissive for larger roofs
    const width = bounds.bottomRightX - bounds.topLeftX
    const height = bounds.bottomRightY - bounds.topLeftY
    
    // If Solar API indicates large building, allow larger bounds
    const maxAllowedSize = solarData?.buildingFootprintSqft > 3000 ? 50 : 45
    
    // Only reduce if clearly too large
    if (width > maxAllowedSize || height > maxAllowedSize) {
      console.warn(`⚠️ Detected bounds large (${width.toFixed(1)}% x ${height.toFixed(1)}%), capping at ${maxAllowedSize}%`)
      const detectedCenterX = (bounds.topLeftX + bounds.bottomRightX) / 2
      const detectedCenterY = (bounds.topLeftY + bounds.bottomRightY) / 2
      bounds = {
        topLeftX: detectedCenterX - maxAllowedSize / 2,
        topLeftY: detectedCenterY - maxAllowedSize / 2,
        bottomRightX: detectedCenterX + maxAllowedSize / 2,
        bottomRightY: detectedCenterY + maxAllowedSize / 2
      }
    }
    
    // Ensure minimum size
    const minSize = 18
    if (width < minSize) {
      const centerX = (bounds.topLeftX + bounds.bottomRightX) / 2
      bounds.topLeftX = centerX - minSize / 2
      bounds.bottomRightX = centerX + minSize / 2
    }
    if (height < minSize) {
      const centerY = (bounds.topLeftY + bounds.bottomRightY) / 2
      bounds.topLeftY = centerY - minSize / 2
      bounds.bottomRightY = centerY + minSize / 2
    }
    
    // Ensure building is roughly centered (within 25-75% range)
    const centerX = (bounds.topLeftX + bounds.bottomRightX) / 2
    const centerY = (bounds.topLeftY + bounds.bottomRightY) / 2
    if (centerX < 30 || centerX > 70 || centerY < 30 || centerY > 70) {
      console.warn(`⚠️ Building not centered (center at ${centerX.toFixed(1)}%, ${centerY.toFixed(1)}%), adjusting`)
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
    console.log(`✅ Pass 1 complete: bounds (${bounds.topLeftX.toFixed(1)}%, ${bounds.topLeftY.toFixed(1)}%) to (${bounds.bottomRightX.toFixed(1)}%, ${bounds.bottomRightY.toFixed(1)}%), size: ${finalWidth.toFixed(1)}% x ${finalHeight.toFixed(1)}%`)
    
    return { 
      bounds, 
      otherBuildings: result.otherBuildingsDetected || 0,
      confidence: result.confidenceTargetIsCorrect || 'medium',
      roofShape: result.roofShape || 'rectangular',
      estimatedDimensions: {
        widthFt: result.estimatedRoofWidthFt || 50,
        lengthFt: result.estimatedRoofLengthFt || 60
      }
    }
  } catch (err) {
    console.error('Building isolation error:', err)
    return { bounds: { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 }, confidence: 'low' }
  }
}

// PASS 2: Detect perimeter vertices - FULL IMAGE TRACING for Planimeter accuracy
async function detectPerimeterVertices(
  imageUrl: string, 
  bounds: any,
  solarData?: any,
  coordinates?: { lat: number; lng: number },
  imageSize: number = 640
) {
  if (!imageUrl) {
    return { vertices: [], roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
  }

  // Calculate expected metrics from Solar API
  let expectedMetrics = ''
  if (solarData?.available && solarData?.buildingFootprintSqft) {
    const expectedAreaSqft = solarData.buildingFootprintSqft
    const expectedPerimeterFt = solarData.estimatedPerimeterFt || 4 * Math.sqrt(expectedAreaSqft)
    const expectedVertices = Math.ceil(expectedPerimeterFt / 20)
    expectedMetrics = `
VALIDATION TARGETS (from satellite data):
- Expected flat area: ~${expectedAreaSqft.toFixed(0)} sqft
- Expected perimeter: ~${expectedPerimeterFt.toFixed(0)} ft
- Expected vertices: ${expectedVertices} or more
- If your perimeter is < ${(expectedPerimeterFt * 0.85).toFixed(0)} ft, you're MISSING CORNERS`
  }

  const boundsWidth = bounds.bottomRightX - bounds.topLeftX
  const boundsHeight = bounds.bottomRightY - bounds.topLeftY
  
  const prompt = `You are a PROFESSIONAL ROOF MEASUREMENT EXPERT matching PLANIMETER/EAGLEVIEW accuracy (98%+).

CRITICAL MISSION: Trace the COMPLETE roof boundary as a CLOSED POLYGON with EVERY SINGLE VERTEX.
This measurement will be used for a real roofing estimate - missing even ONE corner causes 5-15% area error!

The target building is within bounds: top-left (${bounds.topLeftX.toFixed(1)}%, ${bounds.topLeftY.toFixed(1)}%) to bottom-right (${bounds.bottomRightX.toFixed(1)}%, ${bounds.bottomRightY.toFixed(1)}%)
Approximate building size: ${boundsWidth.toFixed(1)}% x ${boundsHeight.toFixed(1)}% of image
${expectedMetrics}

════════════════════════════════════════════════════════════════════════════════
⚠️ CRITICAL ACCURACY RULES - STAY ON THE ROOF!
════════════════════════════════════════════════════════════════════════════════

1. Trace ONLY where shingles/tiles meet the sky (the EAVE EDGE/drip line)
2. Stay INSIDE the roof - do NOT trace shadows, ground, or landscaping
3. For hip corners, trace the EXACT corner vertex where edges meet
4. If unsure about a corner location, place it CLOSER to center, NOT further out
5. Over-estimating is WORSE than under-estimating!

EXPECTED PERIMETER REFERENCE (use this to validate your trace):
- 1500 sqft home: ~160 ft perimeter (4-6 vertices)
- 2000 sqft home: ~180-220 ft perimeter (6-10 vertices)
- 2500 sqft home: ~200-250 ft perimeter (8-12 vertices)
- 3000 sqft home: ~220-280 ft perimeter (10-14 vertices)
- 3500 sqft home: ~240-300 ft perimeter (12-16 vertices)
- 4000 sqft home: ~260-340 ft perimeter (14-18 vertices)
- 4500 sqft home: ~280-380 ft perimeter (16-20 vertices)

If your traced PERIMETER significantly EXCEEDS these values, you are likely:
- Tracing OUTSIDE the actual roof edges
- Including shadows or ground
- Including separate structures (screen enclosures, carports)
- Making corners too "pointy" or extending beyond actual roof edge

════════════════════════════════════════════════════════════════════════════════
PLANIMETER-STYLE SEGMENT-BY-SEGMENT TRACING
════════════════════════════════════════════════════════════════════════════════

STEP 1: Find the OUTERMOST roof edges (the drip edge/eave line)
STEP 2: Start at the TOPMOST (northernmost) point
STEP 3: Trace CLOCKWISE around the ENTIRE roof perimeter
STEP 4: Place a vertex at EVERY direction change - even small 3-4 foot jogs
STEP 5: Return to starting point

VERTEX REQUIREMENTS (NON-NEGOTIABLE):
- Minimum 12 vertices for any residential roof
- L-shaped homes: 8+ vertices minimum (2 corners per jog)
- T-shaped homes: 12+ vertices minimum  
- Complex/cross-gable: 16-30+ vertices
- Each straight wall segment should be 15-40 feet (if longer, you're missing a corner!)

COMMON MISTAKES TO AVOID:
❌ Cutting corners by simplifying to a rectangle (4-6 vertices)
❌ Missing small bump-outs for bay windows, chimneys, or dormers
❌ Tracing BEYOND the visible shingle line (including ground/shadows)
❌ Missing garage extensions or step-downs
❌ Segments > 50 feet without a vertex = MISSING A CORNER
❌ Tracing OUTSIDE the roof edge - this causes OVER-ESTIMATION

CORNER TYPES (classify each):
- "hip-corner": Diagonal 45° corner where hip meets eave
- "valley-entry": Interior corner where roof goes inward (concave)
- "gable-peak": Top point of triangular gable end
- "eave-corner": 90° convex corner where two eaves meet
- "rake-corner": Bottom corner where rake meets eave
- "bump-out-corner": Small extension corner (garage, bay window)

EXCLUDE FROM TRACING:
- Screen enclosures (metal grid structures)
- Covered patios with flat/metal roofs
- Carports, awnings, pergolas
- Adjacent outbuildings

════════════════════════════════════════════════════════════════════════════════
RESPONSE FORMAT (JSON only)
════════════════════════════════════════════════════════════════════════════════

{
  "roofType": "hip|gable|cross-gable|hip-with-dormers|L-shaped|T-shaped|complex",
  "complexity": "simple|moderate|complex|very-complex",
  "estimatedFacetCount": 6,
  "roofMaterial": "shingle|tile|metal",
  "vertices": [
    {"x": 32.50, "y": 28.00, "cornerType": "hip-corner", "edgeLengthToNextFt": 35},
    {"x": 48.20, "y": 27.50, "cornerType": "eave-corner", "edgeLengthToNextFt": 18},
    {"x": 52.00, "y": 30.00, "cornerType": "bump-out-corner", "edgeLengthToNextFt": 8},
    ...continue clockwise tracing ALL corners...
  ],
  "segmentValidation": {
    "totalVertexCount": 16,
    "estimatedPerimeterFt": 310,
    "avgSegmentLengthFt": 19.4,
    "longestSegmentFt": 38,
    "shortestSegmentFt": 6,
    "segmentLengths": [35, 18, 8, 22, 15, 28, 12, 35, 20, 22, 10, 8, 25, 18, 12, 22]
  },
  "qualityCheck": {
    "allCornersIdentified": true,
    "noSegmentsOver50ft": true,
    "perimeterMatchesExpected": true,
    "areaWillBeAccurate": true
  }
}

ACCURACY REQUIREMENTS:
- DECIMAL PRECISION required (34.72 not 35)
- Each vertex accurate to within 1-2 feet
- Total area from these vertices must be within 5% of actual
- Perimeter should match expected ±15%

Return ONLY valid JSON, no explanation.`

  console.log('📐 Pass 2: Full-image Planimeter-quality vertex detection...')
  
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 4000
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Perimeter detection failed:', data)
      return { vertices: createFallbackPerimeter(bounds), roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
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
    
    // Validate vertices are within reasonable bounds (expanded tolerance)
    const validVertices = vertices.filter((v: any) => 
      v.x >= 5 && v.x <= 95 && v.y >= 5 && v.y <= 95
    )
    
    // Extract vertex statistics
    const vertexStats = {
      hipCornerCount: validVertices.filter((v: any) => v.cornerType === 'hip-corner').length,
      valleyEntryCount: validVertices.filter((v: any) => v.cornerType === 'valley-entry').length,
      gablePeakCount: validVertices.filter((v: any) => v.cornerType === 'gable-peak').length,
      eaveCornerCount: validVertices.filter((v: any) => v.cornerType === 'eave-corner').length,
      rakeCornerCount: validVertices.filter((v: any) => v.cornerType === 'rake-corner').length,
      bumpOutCornerCount: validVertices.filter((v: any) => v.cornerType === 'bump-out-corner').length,
      totalCount: validVertices.length,
      estimatedFacetCount: result.estimatedFacetCount || 4
    }
    
    const segmentValidation = result.segmentValidation || {
      totalVertexCount: validVertices.length,
      estimatedPerimeterFt: 0,
      segmentLengths: []
    }
    
    console.log(`✅ Pass 2 complete: ${validVertices.length} perimeter vertices detected`)
    console.log(`   Breakdown: ${vertexStats.hipCornerCount} hip, ${vertexStats.valleyEntryCount} valley, ${vertexStats.gablePeakCount} gable, ${vertexStats.eaveCornerCount} eave, ${vertexStats.bumpOutCornerCount} bump-out`)
    console.log(`   Perimeter estimate: ~${segmentValidation.estimatedPerimeterFt || 'unknown'} ft`)
    
    if (segmentValidation.segmentLengths?.length > 0) {
      console.log(`   Segments (ft): ${segmentValidation.segmentLengths.join(', ')}`)
      const longSegments = segmentValidation.segmentLengths.filter((len: number) => len > 50)
      if (longSegments.length > 0) {
        console.warn(`   ⚠️ ${longSegments.length} segments > 50ft: ${longSegments.join(', ')} ft`)
      }
    }
    
    return { 
      vertices: validVertices.length >= 4 ? validVertices : createFallbackPerimeter(bounds),
      roofType: result.roofType || 'complex',
      complexity: result.complexity || 'moderate',
      vertexStats,
      estimatedFacetCount: result.estimatedFacetCount,
      qualityCheck: result.qualityCheck,
      segmentValidation,
      perimeterValidation: {
        estimatedPerimeterFt: segmentValidation.estimatedPerimeterFt,
        vertexCount: validVertices.length,
        avgSegmentLength: segmentValidation.avgSegmentLengthFt,
        longestSegment: segmentValidation.longestSegmentFt,
        segmentLengths: segmentValidation.segmentLengths
      }
    }
  } catch (err) {
    console.error('Perimeter detection error:', err)
    return { vertices: createFallbackPerimeter(bounds), roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
  }
}

// NEW: Corner completion pass - focuses on finding missing corners along long segments
async function detectPerimeterVerticesWithCornerFocus(
  imageUrl: string,
  expandedBounds: any,
  previousVertices: any[],
  longSegments: { index: number; lengthFt: number }[],
  solarData?: any,
  coordinates?: { lat: number; lng: number },
  imageSize: number = 640
) {
  // Build context about what's missing
  const longSegmentInfo = longSegments.map(s => {
    const v1 = previousVertices[s.index]
    const v2 = previousVertices[(s.index + 1) % previousVertices.length]
    return `Segment ${s.index}: (${v1.x.toFixed(1)}%, ${v1.y.toFixed(1)}%) to (${v2.x.toFixed(1)}%, ${v2.y.toFixed(1)}%) = ${s.lengthFt.toFixed(0)}ft`
  }).join('\n')

  const prompt = `You are a ROOF MEASUREMENT EXPERT performing a CORNER COMPLETION CHECK.

A previous measurement detected ${previousVertices.length} vertices, but analysis shows MISSING CORNERS.

PROBLEM AREAS - These segments are TOO LONG and likely have undetected corners:
${longSegmentInfo}

TASK: Re-trace the roof perimeter and ADD any missing vertices, especially:
1. Small bump-outs (garage extensions, bay windows)
2. Step-downs where roof levels change
3. L-shape or T-shape corners that were simplified
4. Interior angles (valley entries)

Current vertices (for reference):
${previousVertices.slice(0, 5).map((v, i) => `${i}: (${v.x.toFixed(1)}%, ${v.y.toFixed(1)}%) ${v.cornerType || ''}`).join('\n')}
...and ${previousVertices.length - 5} more

Search area: (${expandedBounds.topLeftX.toFixed(1)}%, ${expandedBounds.topLeftY.toFixed(1)}%) to (${expandedBounds.bottomRightX.toFixed(1)}%, ${expandedBounds.bottomRightY.toFixed(1)}%)

Return the COMPLETE vertex list with ALL corners, including the ones previously detected plus any new ones found.

{
  "vertices": [
    {"x": 32.00, "y": 28.50, "cornerType": "hip-corner", "edgeLengthToNextFt": 28},
    {"x": 42.50, "y": 28.00, "cornerType": "bump-out-corner", "edgeLengthToNextFt": 12, "isNewlyDetected": true},
    ...complete list clockwise...
  ],
  "roofType": "L-shaped",
  "complexity": "complex",
  "newVerticesFound": 3,
  "segmentValidation": {
    "totalVertexCount": 19,
    "estimatedPerimeterFt": 305,
    "longestSegmentFt": 35
  }
}

Return ONLY valid JSON.`

  console.log('🔄 Corner completion pass: Looking for ${longSegments.length} missing corners...')
  
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 4000
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Corner completion failed:', data)
      return { vertices: previousVertices, roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
    }
    
    let content = data.choices[0].message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    if (!content.endsWith('}')) {
      const openBraces = (content.match(/{/g) || []).length
      const closeBraces = (content.match(/}/g) || []).length
      for (let i = 0; i < openBraces - closeBraces; i++) content += '}'
    }
    
    const result = JSON.parse(content)
    const vertices = result.vertices || []
    
    const validVertices = vertices.filter((v: any) => 
      v.x >= 5 && v.x <= 95 && v.y >= 5 && v.y <= 95
    )
    
    const newlyDetected = validVertices.filter((v: any) => v.isNewlyDetected).length
    console.log(`✅ Corner completion: ${validVertices.length} total vertices (${newlyDetected} newly detected)`)
    
    const vertexStats = {
      hipCornerCount: validVertices.filter((v: any) => v.cornerType === 'hip-corner').length,
      valleyEntryCount: validVertices.filter((v: any) => v.cornerType === 'valley-entry').length,
      gablePeakCount: validVertices.filter((v: any) => v.cornerType === 'gable-peak').length,
      eaveCornerCount: validVertices.filter((v: any) => v.cornerType === 'eave-corner').length,
      bumpOutCornerCount: validVertices.filter((v: any) => v.cornerType === 'bump-out-corner').length,
      totalCount: validVertices.length
    }
    
    return { 
      vertices: validVertices,
      roofType: result.roofType || 'complex',
      complexity: result.complexity || 'complex',
      vertexStats,
      segmentValidation: result.segmentValidation,
      newVerticesFound: result.newVerticesFound || newlyDetected
    }
  } catch (err) {
    console.error('Corner completion error:', err)
    return { vertices: previousVertices, roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
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

// PASS 3: Detect interior junction points
async function detectInteriorJunctions(imageUrl: string, perimeterVertices: any[], bounds: any) {
  if (!imageUrl || perimeterVertices.length < 4) {
    return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
  }

  const hipCorners = perimeterVertices.filter((v: any) => v.cornerType === 'hip-corner').length
  const valleyEntries = perimeterVertices.filter((v: any) => v.cornerType === 'valley-entry').length
  const gablePeaks = perimeterVertices.filter((v: any) => v.cornerType === 'gable-peak').length
  
  const prompt = `You are a professional roof measurement expert. Detect ALL INTERIOR JUNCTION POINTS where roof features meet.

The roof perimeter has ${perimeterVertices.length} vertices including ${hipCorners} hip-corners, ${valleyEntries} valley-entries, and ${gablePeaks} gable-peaks.

TASK: Identify every INTERIOR vertex where roof lines intersect:

INTERIOR JUNCTION TYPES:
- "ridge-hip-junction": Where the main ridge line terminates and hips branch out
- "ridge-valley-junction": Where ridge meets a valley (T-intersection)  
- "hip-hip-junction": Where two hip lines meet at the apex
- "valley-hip-junction": Where a valley line meets a hip line
- "ridge-termination": Where a ridge ends
- "hip-peak": Central peak where multiple hips converge

RESPONSE FORMAT:
{
  "junctions": [
    {"x": 38.50, "y": 48.00, "type": "ridge-hip-junction", "connectedHipCount": 2},
    {"x": 62.20, "y": 47.50, "type": "ridge-hip-junction", "connectedHipCount": 2}
  ],
  "ridgeEndpoints": [
    {"x": 38.50, "y": 48.00},
    {"x": 62.20, "y": 47.50}
  ],
  "valleyJunctions": [],
  "roofPeakType": "single-ridge",
  "ridgeCount": 1,
  "estimatedHipLineCount": 4
}

Return ONLY valid JSON.`

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 2000
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Interior junction detection failed:', data)
      return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
    }
    
    let content = data.choices[0].message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    if (!content.endsWith('}')) {
      const openBraces = (content.match(/{/g) || []).length
      const closeBraces = (content.match(/}/g) || []).length
      for (let i = 0; i < openBraces - closeBraces; i++) content += '}'
    }
    
    const result = JSON.parse(content)
    
    // Validate junctions are within bounds
    const validJunctions = (result.junctions || []).filter((j: any) =>
      j.x >= bounds.topLeftX - 5 && j.x <= bounds.bottomRightX + 5 &&
      j.y >= bounds.topLeftY - 5 && j.y <= bounds.bottomRightY + 5
    )
    
    console.log(`✅ Pass 3 complete: ${validJunctions.length} interior junctions detected`)
    
    return { 
      junctions: validJunctions,
      ridgeEndpoints: result.ridgeEndpoints || [],
      valleyJunctions: result.valleyJunctions || [],
      roofPeakType: result.roofPeakType,
      ridgeCount: result.ridgeCount,
      estimatedHipLineCount: result.estimatedHipLineCount
    }
  } catch (err) {
    console.error('Interior junction detection error:', err)
    return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
  }
}

// Derive lines from vertices
function deriveLinesToPerimeter(
  perimeterVertices: any[],
  junctions: any[],
  ridgeEndpoints: any[],
  bounds: any
): DerivedLine[] {
  const lines: DerivedLine[] = []
  
  if (!perimeterVertices || perimeterVertices.length < 3) {
    return lines
  }
  
  // 1. RIDGE LINES: Connect ridge endpoints/junctions
  const sortedJunctions = [...(junctions || []), ...(ridgeEndpoints || [])]
    .filter((j: any) => j.type?.includes('ridge') || !j.type)
    .sort((a: any, b: any) => a.x - b.x)
  
  for (let i = 0; i < sortedJunctions.length - 1; i++) {
    const dist = distance(sortedJunctions[i], sortedJunctions[i + 1])
    if (dist > 3 && dist < 50) {
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
  
  // 4 & 5. EAVE and RAKE LINES: Classify perimeter edges
  const ridgeLines = lines.filter(l => l.type === 'ridge')
  const hipLines = lines.filter(l => l.type === 'hip')
  const valleyLines = lines.filter(l => l.type === 'valley')
  
  const pointNearPoint = (p1: {x: number, y: number}, p2: {x: number, y: number}, threshold = 5): boolean => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)) < threshold
  }
  
  const lineIntersectsEdge = (line: DerivedLine, v1: any, v2: any): boolean => {
    return pointNearPoint({x: line.startX, y: line.startY}, v1) ||
           pointNearPoint({x: line.startX, y: line.startY}, v2) ||
           pointNearPoint({x: line.endX, y: line.endY}, v1) ||
           pointNearPoint({x: line.endX, y: line.endY}, v2)
  }
  
  for (let i = 0; i < perimeterVertices.length; i++) {
    const v1 = perimeterVertices[i]
    const v2 = perimeterVertices[(i + 1) % perimeterVertices.length]
    
    const ridgeIntersects = ridgeLines.some(ridge => lineIntersectsEdge(ridge, v1, v2))
    const hipIntersects = hipLines.some(hip => lineIntersectsEdge(hip, v1, v2))
    
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
    } else {
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
  
  // Clip all lines to ensure they stay within perimeter
  const clippedLines = lines.map(line => clipLineToPerimeter(line, perimeterVertices, bounds))
    .filter(line => line !== null) as DerivedLine[]
  
  const eaveFt = clippedLines.filter(l => l.type === 'eave').length
  const rakeFt = clippedLines.filter(l => l.type === 'rake').length
  console.log(`📐 Derived ${clippedLines.length} lines: ${eaveFt} eave, ${rakeFt} rake segments`)
  
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

function clipLineToPerimeter(line: DerivedLine, perimeterVertices: any[], bounds: any): DerivedLine | null {
  const tolerance = 5
  const minX = bounds.topLeftX - tolerance
  const maxX = bounds.bottomRightX + tolerance
  const minY = bounds.topLeftY - tolerance
  const maxY = bounds.bottomRightY + tolerance
  
  const clampedLine = {
    ...line,
    startX: Math.max(minX, Math.min(maxX, line.startX)),
    startY: Math.max(minY, Math.min(maxY, line.startY)),
    endX: Math.max(minX, Math.min(maxX, line.endX)),
    endY: Math.max(minY, Math.min(maxY, line.endY))
  }
  
  const length = distance(
    { x: clampedLine.startX, y: clampedLine.startY },
    { x: clampedLine.endX, y: clampedLine.endY }
  )
  
  if (length < 2) return null
  
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
    const startPixelX = ((line.startX / 100) - 0.5) * imageSize
    const startPixelY = ((line.startY / 100) - 0.5) * imageSize
    const endPixelX = ((line.endX / 100) - 0.5) * imageSize
    const endPixelY = ((line.endY / 100) - 0.5) * imageSize
    
    const startMetersX = startPixelX * metersPerPixel
    const startMetersY = startPixelY * metersPerPixel
    const endMetersX = endPixelX * metersPerPixel
    const endMetersY = endPixelY * metersPerPixel
    
    const startLngOffset = startMetersX / metersPerDegLng
    const startLatOffset = -startMetersY / metersPerDegLat
    const endLngOffset = endMetersX / metersPerDegLng
    const endLatOffset = -endMetersY / metersPerDegLat
    
    const startLng = imageCenter.lng + startLngOffset
    const startLat = imageCenter.lat + startLatOffset
    const endLng = imageCenter.lng + endLngOffset
    const endLat = imageCenter.lat + endLatOffset
    
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
  
  wktPoints.push(wktPoints[0])
  
  let totalPerimeterFt = 0
  const segmentLengths: number[] = []
  
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i]
    const v2 = vertices[(i + 1) % vertices.length]
    const dx = ((v2.x - v1.x) / 100) * imageSize * metersPerPixel
    const dy = ((v2.y - v1.y) / 100) * imageSize * metersPerPixel
    const segmentFt = Math.sqrt(dx * dx + dy * dy) * 3.28084
    segmentLengths.push(Math.round(segmentFt * 10) / 10)
    totalPerimeterFt += segmentFt
  }
  
  console.log(`📐 Perimeter WKT: ${vertices.length} vertices, ${totalPerimeterFt.toFixed(1)} ft total`)
  console.log(`📐 Segments (ft): ${segmentLengths.join(', ')}`)
  
  const longSegments = segmentLengths.filter(len => len > 55)
  if (longSegments.length > 0) {
    console.warn(`⚠️ ${longSegments.length} segments > 55ft - check for missed corners`)
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
    verification = { solarFootprint: solarData.buildingFootprintSqft, aiCalculated: totalFlatArea, variancePercent: variance }
  }

  return {
    facets: processedFacets,
    totalFlatArea,
    totalAdjustedArea,
    totalSquares,
    totalSquaresWithWaste,
    predominantPitch,
    wasteFactor,
    complexity,
    linearMeasurements,
    materials,
    solarVerification: verification
  }
}

function determineComplexity(facetCount: number, linear: any): string {
  const hipValleyLength = (linear.hip || 0) + (linear.valley || 0)
  if (facetCount >= 8 || hipValleyLength > 200) return 'very_complex'
  if (facetCount >= 5 || hipValleyLength > 100) return 'complex'
  if (facetCount >= 3 || hipValleyLength > 50) return 'moderate'
  return 'simple'
}

function mostCommon(arr: string[]): string {
  const counts: Record<string, number> = {}
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '5/12'
}

function calculateConfidenceScore(aiAnalysis: any, measurements: any, solarData: any, image: any) {
  let score = 70
  const factors: string[] = []

  if (solarData.available) {
    score += 10
    factors.push('Solar API validation available')
    
    if (measurements.solarVerification) {
      if (measurements.solarVerification.variancePercent < 10) {
        score += 10
        factors.push('AI area within 10% of Solar API')
      } else if (measurements.solarVerification.variancePercent < 20) {
        score += 5
        factors.push('AI area within 20% of Solar API')
      } else {
        score -= 10
        factors.push('AI area differs significantly from Solar API')
      }
    }
  }

  if (image.quality >= 8) {
    score += 5
    factors.push('High-quality satellite imagery')
  }

  // Penalize if footprint validation failed
  if (aiAnalysis.footprintValidation && !aiAnalysis.footprintValidation.isValid) {
    score -= 15
    factors.push('Footprint validation failed: ' + aiAnalysis.footprintValidation.failureReason)
  }

  score = Math.max(0, Math.min(100, score))
  
  return {
    score,
    rating: score >= 85 ? 'high' : score >= 70 ? 'medium' : 'low',
    factors,
    requiresReview: score < 70
  }
}

// ROOF_AREA_CAPS for validation
// MAX_RESIDENTIAL lowered from 6000 to 5000 to catch double-counting errors
const ROOF_AREA_CAPS = {
  MIN_RESIDENTIAL: 800,
  MAX_RESIDENTIAL: 5000,  // Lowered from 6000 - catches double-tracing errors for 4500sqft roofs
  SOLAR_VARIANCE_THRESHOLD: 0.12,  // 12% variance before override
  FLORIDA_VARIANCE_THRESHOLD: 0.10, // Tighter for Florida (screen enclosures)
  PLANIMETER_TARGET_ACCURACY: 0.05,  // Target 5% accuracy
  AREA_PERIMETER_MAX_RATIO: 20,  // If area/perimeter > 20, likely multi-building trace (lowered from 22)
  DOUBLE_COUNT_WARNING_THRESHOLD: 1.25,  // Warn if AI area > 125% of Solar (lowered from 1.4)
  AI_SOLAR_MAX_VARIANCE: 0.20  // If AI > 20% over Solar, use Solar
}

// Check if Florida address
function isFloridaAddress(address: string): boolean {
  const floridaIndicators = [
    ', FL', ', Florida', 'FL ', 'Florida ',
    '32', '33', '34' // Florida ZIP code prefixes
  ]
  return floridaIndicators.some(ind => address.includes(ind))
}

// Calculate area from perimeter vertices with validation
function calculateAreaFromPerimeterVertices(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number,
  solarData?: any,
  address?: string
): number {
  if (!vertices || vertices.length < 3) {
    console.warn('⚠️ Invalid vertices for area calculation')
    return solarData?.buildingFootprintSqft || 1500
  }
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  
  const feetVertices = vertices.map(v => {
    if (typeof v.x === 'number' && typeof v.y === 'number' && v.x <= 100 && v.y <= 100) {
      return {
        x: ((v.x / 100) - 0.5) * imageSize * metersPerPixel * 3.28084,
        y: ((v.y / 100) - 0.5) * imageSize * metersPerPixel * 3.28084
      }
    }
    const metersPerDegLat = 111320
    const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
    return {
      x: ((v.lng || 0) - imageCenter.lng) * metersPerDegLng * 3.28084,
      y: ((v.lat || 0) - imageCenter.lat) * metersPerDegLat * 3.28084
    }
  })
  
  // Shoelace formula
  let area = 0
  for (let i = 0; i < feetVertices.length; i++) {
    const j = (i + 1) % feetVertices.length
    area += feetVertices[i].x * feetVertices[j].y
    area -= feetVertices[j].x * feetVertices[i].y
  }
  
  let calculatedArea = Math.abs(area / 2)
  console.log(`📐 Raw calculated area: ${calculatedArea.toFixed(0)} sqft`)
  
  // Calculate perimeter for validation
  let perimeterFt = 0
  for (let i = 0; i < feetVertices.length; i++) {
    const v1 = feetVertices[i]
    const v2 = feetVertices[(i + 1) % feetVertices.length]
    perimeterFt += Math.sqrt(Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2))
  }
  
  console.log(`📐 Calculated perimeter: ${perimeterFt.toFixed(1)} ft from ${feetVertices.length} vertices`)
  
  // Area/Perimeter ratio validation - catches multi-building traces
  const areaPerimeterRatio = calculatedArea / perimeterFt
  console.log(`📐 Area/Perimeter ratio: ${areaPerimeterRatio.toFixed(1)} (expect 10-20)`)
  
  // NEW: Check for multi-building trace using Area/Perimeter ratio
  // A single rectangular building has ratio ~10-18, multiple buildings traced as one will have ratio > 22
  if (areaPerimeterRatio > ROOF_AREA_CAPS.AREA_PERIMETER_MAX_RATIO) {
    console.warn(`⚠️ MULTI-BUILDING WARNING: Area/Perimeter ratio ${areaPerimeterRatio.toFixed(1)} > ${ROOF_AREA_CAPS.AREA_PERIMETER_MAX_RATIO} - likely tracing multiple buildings!`)
    
    // If Solar API is available, strongly prefer it
    if (solarData?.available && solarData?.buildingFootprintSqft) {
      console.log(`📐 Using Solar API footprint due to multi-building detection`)
      calculatedArea = solarData.buildingFootprintSqft
    } else {
      // Without Solar API, reduce area by estimated overlap
      const reductionFactor = ROOF_AREA_CAPS.AREA_PERIMETER_MAX_RATIO / areaPerimeterRatio
      calculatedArea = calculatedArea * reductionFactor
      console.log(`📐 Reduced area by ${((1 - reductionFactor) * 100).toFixed(0)}% due to multi-building detection`)
    }
  }
  
  // Solar API validation
  if (solarData?.available && solarData?.buildingFootprintSqft) {
    const solarFootprint = solarData.buildingFootprintSqft
    const variance = Math.abs(calculatedArea - solarFootprint) / solarFootprint
    const overShoot = calculatedArea / solarFootprint
    
    const isFlorida = address ? isFloridaAddress(address) : false
    const varianceThreshold = isFlorida ? ROOF_AREA_CAPS.FLORIDA_VARIANCE_THRESHOLD : ROOF_AREA_CAPS.SOLAR_VARIANCE_THRESHOLD
    
    console.log(`📐 Solar validation: AI=${calculatedArea.toFixed(0)}, Solar=${solarFootprint.toFixed(0)}, variance=${(variance * 100).toFixed(1)}%, ratio=${overShoot.toFixed(2)}x`)
    
    // NEW: Double-count detection - if AI is 140%+ of Solar, very likely tracing two buildings
    if (overShoot > ROOF_AREA_CAPS.DOUBLE_COUNT_WARNING_THRESHOLD) {
      console.warn(`⚠️ DOUBLE-COUNT WARNING: AI area is ${(overShoot * 100).toFixed(0)}% of Solar - using Solar as ground truth`)
      calculatedArea = solarFootprint
    } else if (variance > varianceThreshold) {
      if (calculatedArea < solarFootprint * 0.85) {
        // AI under-detected - use weighted blend
        const blendedArea = (calculatedArea * 0.4) + (solarFootprint * 0.6)
        console.log(`📐 BLEND: ${blendedArea.toFixed(0)} sqft (40% AI + 60% Solar)`)
        calculatedArea = blendedArea
      } else if (isFlorida && calculatedArea > solarFootprint * 1.1) {
        console.log(`📐 FLORIDA: Using Solar to exclude screen enclosure`)
        calculatedArea = solarFootprint
      } else if (calculatedArea > solarFootprint * 1.2) {
        console.log(`📐 OVERRIDE: Using Solar as ground truth`)
        calculatedArea = solarFootprint
      }
    } else {
      console.log(`📐 ✅ AI within ${(variance * 100).toFixed(1)}% of Solar API`)
    }
  }
  
  // Hard caps - lowered to catch errors
  if (calculatedArea < ROOF_AREA_CAPS.MIN_RESIDENTIAL) {
    console.log(`📐 Area below minimum ${ROOF_AREA_CAPS.MIN_RESIDENTIAL}, capping`)
    calculatedArea = ROOF_AREA_CAPS.MIN_RESIDENTIAL
  }
  if (calculatedArea > ROOF_AREA_CAPS.MAX_RESIDENTIAL) {
    console.warn(`⚠️ Area ${calculatedArea.toFixed(0)} exceeds max ${ROOF_AREA_CAPS.MAX_RESIDENTIAL}`)
    if (solarData?.available && solarData?.buildingFootprintSqft) {
      console.log(`📐 Using Solar footprint as fallback`)
      calculatedArea = solarData.buildingFootprintSqft
    } else {
      console.log(`📐 Capping at MAX_RESIDENTIAL`)
      calculatedArea = ROOF_AREA_CAPS.MAX_RESIDENTIAL
    }
  }
  
  console.log(`📐 Final area: ${calculatedArea.toFixed(0)} sqft`)
  return calculatedArea
}

// Derive facet count from geometry
function deriveFacetCountFromGeometry(
  perimeterVertices: any[],
  interiorJunctions: any[],
  roofType: string,
  hipLineCount: number = 0,
  ridgeLineCount: number = 0
): number {
  console.log(`📐 Facet derivation: hipLines=${hipLineCount}, ridgeLines=${ridgeLineCount}, roofType=${roofType}`)
  
  if (hipLineCount >= 4) return hipLineCount
  
  const hipCorners = perimeterVertices?.filter((v: any) => 
    v.cornerType === 'hip-corner' || v.type === 'hip-junction'
  ).length || 0
  
  const interiorCount = interiorJunctions?.length || 0
  
  if (hipCorners >= 4) return hipCorners + Math.floor(interiorCount / 2)
  
  if (roofType === 'gable' || (ridgeLineCount >= 1 && hipLineCount === 0)) {
    return 2 + Math.floor(interiorCount / 2)
  }
  
  if (hipLineCount >= 2) return Math.max(4, hipLineCount + 1)
  
  const vertexCount = perimeterVertices?.length || 0
  if (vertexCount >= 12) return 6
  if (vertexCount >= 8) return 4
  
  return 4
}

// Calculate linear totals from WKT features
function calculateLinearTotalsFromWKT(linearFeatures: any[]): Record<string, number> {
  const totals: Record<string, number> = { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0 }
  
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
    vertexStats, footprintValidation
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
    ai_detection_data: { ...aiAnalysis, footprintValidation },
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
    vertex_count: vertexStats?.totalCount || 0,
    perimeter_vertex_count: vertexStats?.totalCount || 0,
    interior_vertex_count: 0,
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

// Save vertices to database
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
  
  const mapCornerType = (cornerType: string): string => {
    const mapping: Record<string, string> = {
      'hip-corner': 'hip-corner',
      'valley-entry': 'valley-entry',
      'gable-peak': 'gable-peak',
      'eave-corner': 'eave-corner',
      'rake-corner': 'rake-corner',
      'dormer-junction': 'dormer-junction',
      'ridge-end': 'gable-peak',
      'corner': 'eave-corner',
      'bump-out-corner': 'eave-corner'
    }
    return mapping[cornerType] || 'unclassified'
  }
  
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
    const { error } = await supabase.from('roof_measurement_vertices').insert(vertexRecords)
    if (error) {
      console.error('⚠️ Failed to save vertices:', error.message)
    } else {
      console.log(`💾 Saved ${vertexRecords.length} vertices`)
    }
  }
  
  if (interiorJunctions.length > 0) {
    await supabase.from('roof_measurements').update({ 
      interior_vertex_count: interiorJunctions.length,
      vertex_count: perimeterVertices.length + interiorJunctions.length,
      edge_count: 0
    }).eq('id', measurementId)
  }
}

// Save edges to database
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
  
  derivedLines.forEach((line, index) => {
    const startCoords = toLatLng(line.startX, line.startY)
    const endCoords = toLatLng(line.endX, line.endY)
    const lengthFt = calculateLengthFt(line.startX, line.startY, line.endX, line.endY)
    
    if (lengthFt >= 3) {
      edgeRecords.push({
        measurement_id: measurementId,
        edge_type: line.type,
        start_x_percent: line.startX,
        start_y_percent: line.startY,
        end_x_percent: line.endX,
        end_y_percent: line.endY,
        start_lat: startCoords.lat,
        start_lng: startCoords.lng,
        end_lat: endCoords.lat,
        end_lng: endCoords.lng,
        length_ft: Math.round(lengthFt * 10) / 10,
        sequence_order: index,
        detection_source: line.source,
        detection_confidence: 70
      })
    }
  })
  
  if (edgeRecords.length > 0) {
    const { error } = await supabase.from('roof_measurement_edges').insert(edgeRecords)
    if (error) {
      console.error('⚠️ Failed to save edges:', error.message)
    } else {
      console.log(`💾 Saved ${edgeRecords.length} edges`)
      await supabase.from('roof_measurements').update({ edge_count: edgeRecords.length }).eq('id', measurementId)
    }
  }
}

// Generate facet polygons - ALWAYS returns at least 1 fallback facet
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
  // CRITICAL: Always return at least one facet (the full perimeter) if we have vertices
  if (!perimeterVertices || perimeterVertices.length < 3) {
    console.warn('⚠️ Cannot generate facets: insufficient perimeter vertices')
    return []
  }
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  const toLatLng = (v: any) => {
    const pixelX = ((v.x / 100) - 0.5) * imageSize
    const pixelY = ((v.y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    return {
      lat: imageCenter.lat - (metersY / metersPerDegLat),
      lng: imageCenter.lng + (metersX / metersPerDegLng)
    }
  }
  
  const facetPolygons: any[] = []
  
  // Calculate centroid
  const centroidX = perimeterVertices.reduce((sum, v) => sum + v.x, 0) / perimeterVertices.length
  const centroidY = perimeterVertices.reduce((sum, v) => sum + v.y, 0) / perimeterVertices.length
  const centroid = toLatLng({ x: centroidX, y: centroidY })
  
  const totalArea = calculatePolygonAreaFromPercentVertices(perimeterVertices, imageCenter, imageSize, zoom)
  const areaPerFacet = totalArea / Math.max(facetCount, 1)
  
  const ridgeLines = derivedLines.filter(l => l.type === 'ridge')
  const hipLines = derivedLines.filter(l => l.type === 'hip')
  
  const directions = ['north', 'south', 'east', 'west', 'northeast', 'southeast', 'southwest', 'northwest']
  
  // Try to generate multiple facets based on geometry
  if (facetCount >= 4 && (hipLines.length >= 2 || ridgeLines.length >= 1)) {
    const verticesWithAngles = perimeterVertices.map(v => {
      const angle = Math.atan2(v.y - centroidY, v.x - centroidX) * 180 / Math.PI
      return { ...v, angle: (angle + 360) % 360 }
    }).sort((a, b) => a.angle - b.angle)
    
    const segmentSize = Math.ceil(verticesWithAngles.length / facetCount)
    
    for (let i = 0; i < facetCount; i++) {
      const startIdx = i * segmentSize
      const endIdx = Math.min((i + 1) * segmentSize, verticesWithAngles.length)
      const segmentVertices = verticesWithAngles.slice(startIdx, endIdx)
      
      if (segmentVertices.length >= 2) {
        const facetPoints: { lng: number; lat: number }[] = [centroid]
        segmentVertices.forEach(v => facetPoints.push(toLatLng(v)))
        facetPoints.push(centroid)
        
        const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
        const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
        
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
    const ridge = ridgeLines[0]
    const ridgeMidY = (ridge.startY + ridge.endY) / 2
    
    const northVertices = perimeterVertices.filter(v => v.y < ridgeMidY)
    const southVertices = perimeterVertices.filter(v => v.y >= ridgeMidY)
    
    if (northVertices.length >= 2) {
      const facetPoints = northVertices.map(toLatLng)
      facetPoints.push(facetPoints[0])
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
      facetPoints.push(facetPoints[0])
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
  
  // CRITICAL FALLBACK: If no facets were generated, create ONE facet = entire perimeter
  if (facetPolygons.length === 0) {
    console.log(`📐 FALLBACK: Creating single facet from entire perimeter (${perimeterVertices.length} vertices)`)
    
    const perimeterPoints = perimeterVertices.map(toLatLng)
    // Close the polygon
    if (perimeterPoints.length > 0) {
      perimeterPoints.push(perimeterPoints[0])
    }
    
    facetPolygons.push({
      facetNumber: 1,
      points: perimeterPoints,
      centroid: centroid,
      primaryDirection: 'mixed',
      azimuthDegrees: 0,
      shapeType: 'complex',
      areaEstimate: totalArea,
      isFallback: true
    })
    
    console.log(`📐 Fallback facet created with area: ${totalArea.toFixed(0)} sqft`)
  }
  // Fill remaining facets if needed (but only if we got some already)
  else if (facetPolygons.length < facetCount && facetPolygons.length > 0) {
    console.log(`📐 Filling: Creating ${facetCount - facetPolygons.length} additional facet regions`)
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
  
  console.log(`📐 Generated ${facetPolygons.length} facet polygons (requested: ${facetCount})`)
  return facetPolygons
}

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
    detection_confidence: 70
  }))
  
  const { error } = await supabase.from('roof_measurement_facets').insert(facetRecords)
  
  if (error) {
    console.error('⚠️ Failed to save facets:', error.message)
  } else {
    console.log(`💾 Saved ${facetRecords.length} facet records`)
  }
}
