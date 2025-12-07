import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!
const GOOGLE_SOLAR_API_KEY = Deno.env.get('GOOGLE_SOLAR_API_KEY')!
const MAPBOX_PUBLIC_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const PITCH_MULTIPLIERS: { [key: string]: number } = {
  '1/12': 1.0035, '2/12': 1.0138, '3/12': 1.0308, '4/12': 1.0541,
  '5/12': 1.0833, '6/12': 1.1180, '7/12': 1.1577, '8/12': 1.2019,
  '9/12': 1.2500, '10/12': 1.3017, '11/12': 1.3566, '12/12': 1.4142
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { address, coordinates, customerId, userId } = await req.json()
    console.log('🏠 Analyzing roof:', address)

    const [googleImage, solarData, mapboxImage] = await Promise.all([
      fetchGoogleStaticMap(coordinates),
      fetchGoogleSolarData(coordinates),
      fetchMapboxSatellite(coordinates)
    ])

    const selectedImage = mapboxImage.quality && mapboxImage.quality > (googleImage.quality || 0) ? mapboxImage : googleImage
    console.log(`✅ Using: ${selectedImage.source}`)

    const aiAnalysis = await analyzeRoofWithAI(selectedImage.url, address)
    const scale = calculateScale(solarData, selectedImage, aiAnalysis)
    const measurements = calculateDetailedMeasurements(aiAnalysis, scale, solarData)
    const confidence = calculateConfidenceScore(aiAnalysis, measurements, solarData, selectedImage)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const measurementRecord = await saveMeasurementToDatabase(supabase, {
      address, coordinates, customerId, userId, googleImage, mapboxImage,
      selectedImage, solarData, aiAnalysis, scale, measurements, confidence
    })

    console.log('✅ Complete! Confidence:', confidence.score + '%')

    return new Response(JSON.stringify({
      success: true,
      measurementId: measurementRecord.id,
      data: {
        address, coordinates,
        images: { google: googleImage, mapbox: mapboxImage, selected: selectedImage.source },
        solarApiData: {
          available: solarData.available,
          buildingFootprint: solarData.buildingFootprintSqft,
          roofSegments: solarData.roofSegmentCount
        },
        aiAnalysis: {
          roofType: aiAnalysis.roofType,
          facetCount: aiAnalysis.facets.length,
          complexity: aiAnalysis.overallComplexity,
          pitch: measurements.predominantPitch
        },
        measurements: {
          totalAreaSqft: measurements.totalAdjustedArea,
          totalSquares: measurements.totalSquares,
          wasteFactor: measurements.wasteFactor,
          facets: measurements.facets,
          linear: measurements.linearMeasurements,
          materials: measurements.materials,
          predominantPitch: measurements.predominantPitch
        },
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
    // Use Deno's base64 encoding to avoid stack overflow with large images
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
    
    // Extract roof segment boundaries and compute linear features with WKT geometry
    const linearFeatures = extractLinearFeaturesFromSegments(roofSegments, boundingBox, coords)
    
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
      linearFeatures,
      boundingBox,
      rawData: data
    }
  } catch (err) {
    console.error('Google Solar API error:', err)
    return { available: false, buildingFootprintSqft: null, roofSegmentCount: 0, linearFeatures: [] }
  }
}

// Extract linear features (ridges, hips, valleys) from roof segment intersections
function extractLinearFeaturesFromSegments(segments: any[], boundingBox: any, center: any) {
  const linearFeatures: any[] = []
  let featureId = 1
  
  if (!segments || segments.length < 2 || !boundingBox) {
    return linearFeatures
  }
  
  const centerLat = center.lat
  const centerLng = center.lng
  
  // Calculate meters per degree for accurate conversions
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180)
  
  // Process each pair of adjacent roof segments to find intersection lines (ridges/hips/valleys)
  for (let i = 0; i < segments.length; i++) {
    const seg1 = segments[i]
    if (!seg1.boundingBox) continue
    
    for (let j = i + 1; j < segments.length; j++) {
      const seg2 = segments[j]
      if (!seg2.boundingBox) continue
      
      // Check if segments share an edge (intersect)
      const intersection = findSegmentIntersection(seg1, seg2, centerLat, centerLng, metersPerDegLat, metersPerDegLng)
      
      if (intersection) {
        // Determine feature type based on height comparison
        const height1 = seg1.planeHeightAtCenterMeters || 0
        const height2 = seg2.planeHeightAtCenterMeters || 0
        const azimuth1 = seg1.azimuthDegrees || 0
        const azimuth2 = seg2.azimuthDegrees || 0
        const azimuthDiff = Math.abs(azimuth1 - azimuth2)
        
        let featureType = 'ridge'
        // If planes face opposite directions (180° apart) = ridge
        // If planes face similar directions but different heights = hip
        // If intersection is below both planes = valley
        if (azimuthDiff > 150 && azimuthDiff < 210) {
          featureType = 'ridge'
        } else if (intersection.isLowerThanBoth) {
          featureType = 'valley'
        } else {
          featureType = 'hip'
        }
        
        linearFeatures.push({
          id: `LF${featureId++}`,
          type: featureType,
          wkt: intersection.wkt,
          length_ft: intersection.length_ft,
          source: 'google_solar_segment_intersection',
          segment1Index: i,
          segment2Index: j
        })
      }
    }
  }
  
  // Extract eave lines from building boundary
  if (boundingBox) {
    const eaveLines = extractBoundaryLines(boundingBox, centerLat, centerLng, metersPerDegLat, metersPerDegLng)
    eaveLines.forEach(line => {
      linearFeatures.push({
        id: `LF${featureId++}`,
        type: 'eave',
        wkt: line.wkt,
        length_ft: line.length_ft,
        source: 'google_solar_boundary'
      })
    })
  }
  
  console.log(`✅ Extracted ${linearFeatures.length} linear features from Google Solar segments`)
  return linearFeatures
}

// Find intersection line between two roof segments
function findSegmentIntersection(seg1: any, seg2: any, centerLat: number, centerLng: number, mPerDegLat: number, mPerDegLng: number) {
  const box1 = seg1.boundingBox
  const box2 = seg2.boundingBox
  
  if (!box1 || !box2) return null
  
  // Get bounding box corners
  const b1sw = { lat: box1.sw?.latitude || 0, lng: box1.sw?.longitude || 0 }
  const b1ne = { lat: box1.ne?.latitude || 0, lng: box1.ne?.longitude || 0 }
  const b2sw = { lat: box2.sw?.latitude || 0, lng: box2.sw?.longitude || 0 }
  const b2ne = { lat: box2.ne?.latitude || 0, lng: box2.ne?.longitude || 0 }
  
  // Check for overlap
  const overlapMinLat = Math.max(b1sw.lat, b2sw.lat)
  const overlapMaxLat = Math.min(b1ne.lat, b2ne.lat)
  const overlapMinLng = Math.max(b1sw.lng, b2sw.lng)
  const overlapMaxLng = Math.min(b1ne.lng, b2ne.lng)
  
  // Segments must overlap to share an edge
  const tolerance = 0.00005 // ~5.5m tolerance
  if (overlapMaxLat - overlapMinLat < -tolerance || overlapMaxLng - overlapMinLng < -tolerance) {
    return null
  }
  
  // Determine if it's a horizontal or vertical edge
  const latOverlap = overlapMaxLat - overlapMinLat
  const lngOverlap = overlapMaxLng - overlapMinLng
  
  let startLat, startLng, endLat, endLng
  
  if (latOverlap > lngOverlap) {
    // Vertical edge (shared longitude)
    const sharedLng = (overlapMinLng + overlapMaxLng) / 2
    startLat = overlapMinLat
    startLng = sharedLng
    endLat = overlapMaxLat
    endLng = sharedLng
  } else {
    // Horizontal edge (shared latitude)
    const sharedLat = (overlapMinLat + overlapMaxLat) / 2
    startLat = sharedLat
    startLng = overlapMinLng
    endLat = sharedLat
    endLng = overlapMaxLng
  }
  
  // Calculate length in feet
  const dx = (endLng - startLng) * mPerDegLng
  const dy = (endLat - startLat) * mPerDegLat
  const length_m = Math.sqrt(dx * dx + dy * dy)
  const length_ft = length_m * 3.28084
  
  // Skip very short lines
  if (length_ft < 3) return null
  
  // Create WKT LINESTRING with actual geographic coordinates
  const wkt = `LINESTRING(${startLng} ${startLat}, ${endLng} ${endLat})`
  
  // Check if intersection is lower than both segment centers (valley indicator)
  const isLowerThanBoth = false // Would need elevation data for accurate detection
  
  return {
    wkt,
    length_ft,
    isLowerThanBoth
  }
}

// Extract eave/boundary lines from building bounding box
function extractBoundaryLines(boundingBox: any, centerLat: number, centerLng: number, mPerDegLat: number, mPerDegLng: number) {
  const lines: any[] = []
  
  if (!boundingBox || !boundingBox.sw || !boundingBox.ne) return lines
  
  const sw = { lat: boundingBox.sw.latitude, lng: boundingBox.sw.longitude }
  const ne = { lat: boundingBox.ne.latitude, lng: boundingBox.ne.longitude }
  const se = { lat: sw.lat, lng: ne.lng }
  const nw = { lat: ne.lat, lng: sw.lng }
  
  const edges = [
    { start: sw, end: se, label: 'South' },
    { start: se, end: ne, label: 'East' },
    { start: ne, end: nw, label: 'North' },
    { start: nw, end: sw, label: 'West' }
  ]
  
  edges.forEach(edge => {
    const dx = (edge.end.lng - edge.start.lng) * mPerDegLng
    const dy = (edge.end.lat - edge.start.lat) * mPerDegLat
    const length_m = Math.sqrt(dx * dx + dy * dy)
    const length_ft = length_m * 3.28084
    
    lines.push({
      wkt: `LINESTRING(${edge.start.lng} ${edge.start.lat}, ${edge.end.lng} ${edge.end.lat})`,
      length_ft,
      label: edge.label
    })
  })
  
  return lines
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
    // Use Deno's base64 encoding to avoid stack overflow with large images
    const base64 = base64Encode(new Uint8Array(buffer))
    return { url: `data:image/png;base64,${base64}`, source: 'mapbox', resolution: '1280x1280', quality: 9 }
  } catch (err) {
    console.error('Mapbox error:', err)
    return { url: null, source: 'mapbox', resolution: '1280x1280', quality: 0 }
  }
}

async function analyzeRoofWithAI(imageUrl: string, address: string) {
  if (!imageUrl) {
    throw new Error('No satellite image available for AI analysis')
  }

  const prompt = `Analyze this roof aerial image for ${address}. Return ONLY valid JSON:

{"roofType":"gable|hip|flat|complex","facets":[{"facetNumber":1,"shape":"rectangle|triangle|trapezoid","estimatedPitch":"5/12","pitchConfidence":"high|medium|low","estimatedAreaSqft":850,"edges":{"eave":40,"rake":25,"hip":0,"valley":0,"ridge":40},"features":{"chimneys":0,"skylights":0,"vents":2},"orientation":"north|south|east|west"}],"overallComplexity":"simple|moderate|complex","shadowAnalysis":{"estimatedPitchRange":"4/12 to 6/12","confidence":"medium"},"detectionNotes":"notes"}

Keep facets array SHORT - max 4 main facets. No boundingBox field. ONLY JSON, no markdown.`

  console.log('Calling Lovable AI for roof analysis...')
  
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }]
    })
  })

  const data = await response.json()
  console.log('Lovable AI response status:', response.status)
  
  if (!response.ok) {
    console.error('Lovable AI error:', JSON.stringify(data))
    throw new Error(data.error?.message || `Lovable AI error: ${response.status}`)
  }
  
  if (!data.choices || !data.choices[0]) {
    console.error('No choices in response:', JSON.stringify(data))
    throw new Error('Lovable AI returned no choices')
  }
  
  let content = data.choices[0].message?.content || ''
  console.log('Raw AI content length:', content.length)
  
  // Clean up markdown formatting
  content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  
  // Try to fix truncated JSON by closing brackets
  if (!content.endsWith('}')) {
    console.log('Attempting to fix truncated JSON...')
    // Count open brackets and close them
    const openBraces = (content.match(/{/g) || []).length
    const closeBraces = (content.match(/}/g) || []).length
    const openBrackets = (content.match(/\[/g) || []).length
    const closeBrackets = (content.match(/]/g) || []).length
    
    // Add missing closing brackets
    for (let i = 0; i < openBrackets - closeBrackets; i++) content += ']'
    for (let i = 0; i < openBraces - closeBraces; i++) content += '}'
  }
  
  try {
    const aiAnalysis = JSON.parse(content)
    if (!aiAnalysis.facets || aiAnalysis.facets.length === 0) {
      // Create default facet if none detected
      aiAnalysis.facets = [{
        facetNumber: 1, shape: 'rectangle', estimatedPitch: '5/12', pitchConfidence: 'low',
        estimatedAreaSqft: 1500, edges: { eave: 50, rake: 30, hip: 0, valley: 0, ridge: 50 },
        features: { chimneys: 0, skylights: 0, vents: 2 }, orientation: 'south'
      }]
    }
    console.log('✅ AI analysis parsed successfully:', aiAnalysis.roofType, 'with', aiAnalysis.facets.length, 'facets')
    return aiAnalysis
  } catch (parseError) {
    console.error('Failed to parse AI response:', content.substring(0, 500))
    // Return fallback analysis instead of throwing
    console.log('Using fallback roof analysis...')
    return {
      roofType: 'complex',
      facets: [{
        facetNumber: 1, shape: 'rectangle', estimatedPitch: '5/12', pitchConfidence: 'low',
        estimatedAreaSqft: 1800, edges: { eave: 60, rake: 30, hip: 20, valley: 0, ridge: 40 },
        features: { chimneys: 0, skylights: 0, vents: 2 }, orientation: 'south'
      }],
      overallComplexity: 'moderate',
      shadowAnalysis: { estimatedPitchRange: '4/12 to 6/12', confidence: 'low' },
      detectionNotes: 'Fallback analysis - manual verification recommended'
    }
  }
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

function calculateConfidenceScore(aiAnalysis: any, measurements: any, solarData: any, image: any) {
  let score = 100
  const factors: any = {}

  const aiConfidence = aiAnalysis.shadowAnalysis?.confidence || 'medium'
  if (aiConfidence === 'low') { score -= 25; factors.aiConfidence = 'Low AI detection confidence' }
  else if (aiConfidence === 'medium') { score -= 12; factors.aiConfidence = 'Medium AI detection confidence' }
  else { factors.aiConfidence = 'High AI detection confidence' }

  if (image.quality && image.quality < 7) { score -= 15; factors.imageQuality = 'Below optimal image quality' }
  else { factors.imageQuality = 'Good image quality' }

  if (measurements.verification) {
    const variance = measurements.verification.variance
    if (variance > 25) { score -= 30; factors.solarValidation = `High variance (${variance.toFixed(1)}%)` }
    else if (variance > 15) { score -= 20; factors.solarValidation = `Moderate variance (${variance.toFixed(1)}%)` }
    else if (variance > 10) { score -= 10; factors.solarValidation = `Low variance (${variance.toFixed(1)}%)` }
    else { factors.solarValidation = `Excellent validation (${variance.toFixed(1)}%)` }
  } else { score -= 15; factors.solarValidation = 'Solar API unavailable' }

  const complexity = measurements.complexity
  if (complexity === 'very_complex') { score -= 15; factors.complexity = 'Very complex roof' }
  else if (complexity === 'complex') { score -= 10; factors.complexity = 'Complex roof' }
  else if (complexity === 'moderate') { score -= 5; factors.complexity = 'Moderate complexity' }
  else { factors.complexity = 'Simple roof' }

  const totalFromFacets = measurements.facets.reduce((sum: number, f: any) => sum + f.adjustedAreaSqft, 0)
  const consistency = Math.abs(totalFromFacets - measurements.totalAdjustedArea) / measurements.totalAdjustedArea
  if (consistency > 0.05) { score -= 10; factors.consistency = 'Minor inconsistencies' }
  else { factors.consistency = 'Internally consistent' }

  const rating = score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 60 ? 'FAIR' : 'POOR'
  const requiresReview = score < 75
  const validationStatus = score >= 90 ? 'validated' : score >= 75 ? 'validated' : score >= 60 ? 'flagged' : 'rejected'

  return { score: Math.max(Math.round(score), 0), rating, factors, requiresReview, validationStatus }
}

async function saveMeasurementToDatabase(supabase: any, data: any) {
  const { address, coordinates, customerId, userId, googleImage, mapboxImage, selectedImage, solarData, aiAnalysis, scale, measurements, confidence } = data

  // Combine AI-estimated linear features with Google Solar extracted features (with WKT)
  const solarLinearFeatures = solarData.linearFeatures || []
  const combinedLinearFeatures = [
    ...solarLinearFeatures,
    // Add AI-estimated features without WKT (fallback)
    ...measurements.facets.flatMap((facet: any) => {
      const features: any[] = []
      if (facet.edges.ridge > 0) {
        features.push({ type: 'ridge', length_ft: facet.edges.ridge, source: 'ai_analysis', facetNumber: facet.facetNumber })
      }
      if (facet.edges.hip > 0) {
        features.push({ type: 'hip', length_ft: facet.edges.hip, source: 'ai_analysis', facetNumber: facet.facetNumber })
      }
      if (facet.edges.valley > 0) {
        features.push({ type: 'valley', length_ft: facet.edges.valley, source: 'ai_analysis', facetNumber: facet.facetNumber })
      }
      return features
    })
  ]

  console.log(`💾 Saving measurement with ${combinedLinearFeatures.length} linear features (${solarLinearFeatures.filter((f: any) => f.wkt).length} with WKT)`)

  const { data: measurementRecord, error: measurementError } = await supabase
    .from('roof_measurements')
    .insert({
      customer_id: customerId,
      measured_by: userId,
      property_address: address,
      gps_coordinates: coordinates,
      google_maps_image_url: googleImage.url,
      mapbox_image_url: mapboxImage.url,
      selected_image_source: selectedImage.source,
      image_quality_score: selectedImage.quality,
      solar_api_available: solarData.available,
      solar_building_footprint_sqft: solarData.buildingFootprintSqft,
      solar_api_response: solarData.rawData,
      ai_detection_data: aiAnalysis,
      detection_confidence: confidence.score,
      roof_type: aiAnalysis.roofType,
      predominant_pitch: measurements.predominantPitch,
      pitch_multiplier: PITCH_MULTIPLIERS[measurements.predominantPitch],
      facet_count: aiAnalysis.facets.length,
      complexity_rating: measurements.complexity,
      total_area_flat_sqft: measurements.totalFlatArea,
      total_area_adjusted_sqft: measurements.totalAdjustedArea,
      total_squares: measurements.totalSquares,
      waste_factor_percent: (measurements.wasteFactor - 1) * 100,
      total_squares_with_waste: measurements.totalSquaresWithWaste,
      pixels_per_foot: scale.pixelsPerFoot,
      scale_confidence: scale.confidence,
      scale_method: scale.method,
      measurement_confidence: confidence.score,
      api_variance_percent: measurements.verification?.variance || null,
      validation_status: confidence.validationStatus,
      requires_manual_review: confidence.requiresReview,
      total_eave_length: measurements.linearMeasurements.eave,
      total_rake_length: measurements.linearMeasurements.rake,
      total_hip_length: measurements.linearMeasurements.hip,
      total_valley_length: measurements.linearMeasurements.valley,
      total_ridge_length: measurements.linearMeasurements.ridge,
      material_calculations: measurements.materials,
      // NEW: Store linear features with WKT geometry for accurate overlay rendering
      linear_features_wkt: combinedLinearFeatures
    })
    .select()
    .single()

  if (measurementError) throw measurementError

  const facetInserts = measurements.facets.map((facet: any) => ({
    measurement_id: measurementRecord.id,
    facet_number: facet.facetNumber,
    polygon_points: [],
    shape_type: facet.shape,
    area_flat_sqft: facet.flatAreaSqft,
    pitch: facet.pitch,
    pitch_multiplier: facet.pitchMultiplier,
    area_adjusted_sqft: facet.adjustedAreaSqft,
    edge_eave_length: facet.edges.eave || 0,
    edge_rake_length: facet.edges.rake || 0,
    edge_hip_length: facet.edges.hip || 0,
    edge_valley_length: facet.edges.valley || 0,
    edge_ridge_length: facet.edges.ridge || 0,
    orientation: facet.orientation,
    detection_confidence: facet.confidence === 'high' ? 90 : facet.confidence === 'medium' ? 70 : 50
  }))

  if (facetInserts.length > 0) {
    await supabase.from('roof_facets').insert(facetInserts)
  }

  return measurementRecord
}

function mostCommon(arr: string[]): string {
  const counts: { [key: string]: number } = {}
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '6/12'
}
