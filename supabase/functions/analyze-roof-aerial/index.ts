import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
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
          materials: measurements.materials
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
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${coords.lat},${coords.lng}&zoom=20&size=640x640&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`
  const response = await fetch(url)
  const buffer = await response.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  return { url: `data:image/png;base64,${base64}`, source: 'google_maps', resolution: '640x640', quality: 8 }
}

async function fetchGoogleSolarData(coords: any) {
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${coords.lat}&location.longitude=${coords.lng}&key=${GOOGLE_SOLAR_API_KEY}`
    const response = await fetch(url)
    if (!response.ok) return { available: false, buildingFootprintSqft: null, roofSegmentCount: 0 }
    const data = await response.json()
    const buildingFootprintSqm = data.solarPotential?.buildingStats?.areaMeters2 || 0
    const buildingFootprintSqft = buildingFootprintSqm * 10.764
    const roofSegments = data.solarPotential?.roofSegmentStats || []
    return {
      available: true,
      buildingFootprintSqft,
      roofSegmentCount: roofSegments.length,
      roofSegments: roofSegments.map((s: any) => ({ pitchDegrees: s.pitchDegrees, azimuthDegrees: s.azimuthDegrees, areaMeters2: s.stats?.areaMeters2 })),
      rawData: data
    }
  } catch {
    return { available: false, buildingFootprintSqft: null, roofSegmentCount: 0 }
  }
}

async function fetchMapboxSatellite(coords: any) {
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${coords.lng},${coords.lat},20,0/640x640@2x?access_token=${MAPBOX_PUBLIC_TOKEN}`
  const response = await fetch(url)
  const buffer = await response.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  return { url: `data:image/png;base64,${base64}`, source: 'mapbox', resolution: '1280x1280', quality: 9 }
}

async function analyzeRoofWithAI(imageUrl: string, address: string) {
  const prompt = `You are a professional roof measurement technician analyzing aerial imagery of ${address}.

Analyze this image and provide ONLY valid JSON in this EXACT format (no markdown, no backticks, just JSON):

{
  "roofType": "gable|hip|flat|complex",
  "facets": [
    {
      "facetNumber": 1,
      "shape": "rectangle|triangle|trapezoid|irregular",
      "estimatedPitch": "5/12",
      "pitchConfidence": "high|medium|low",
      "estimatedAreaSqft": 850,
      "edges": {"eave": 40, "rake": 25, "hip": 0, "valley": 0, "ridge": 40},
      "features": {"chimneys": 0, "skylights": 0, "vents": 2},
      "orientation": "north|south|east|west",
      "boundingBox": [{"x": 100, "y": 200}, {"x": 300, "y": 200}, {"x": 300, "y": 400}, {"x": 100, "y": 400}]
    }
  ],
  "overallComplexity": "simple|moderate|complex",
  "shadowAnalysis": {"estimatedPitchRange": "4/12 to 6/12", "confidence": "high|medium|low"},
  "detectionNotes": "Your observations"
}

CRITICAL: Respond ONLY with valid JSON. No text before or after. No markdown formatting.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4-vision-preview',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }] }],
      max_tokens: 4000,
      temperature: 0.1
    })
  })

  const data = await response.json()
  let content = data.choices[0].message.content
  content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const aiAnalysis = JSON.parse(content)
  if (!aiAnalysis.facets || aiAnalysis.facets.length === 0) throw new Error('AI failed to detect facets')
  return aiAnalysis
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
      material_calculations: measurements.materials
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
    primary_direction: facet.orientation,
    eave_length: facet.edges.eave,
    rake_length: facet.edges.rake,
    hip_length: facet.edges.hip,
    valley_length: facet.edges.valley,
    ridge_length: facet.edges.ridge,
    chimney_count: facet.features.chimneys,
    skylight_count: facet.features.skylights,
    vent_count: facet.features.vents,
    detection_confidence: facet.confidence === 'high' ? 90 : facet.confidence === 'medium' ? 70 : 50
  }))

  const { error: facetsError } = await supabase.from('roof_measurement_facets').insert(facetInserts)
  if (facetsError) throw facetsError

  return measurementRecord
}

function mostCommon(arr: string[]): string {
  const counts = arr.reduce((acc: any, val) => { acc[val] = (acc[val] || 0) + 1; return acc }, {})
  return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b)
}
