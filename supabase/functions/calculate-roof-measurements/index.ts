import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// PITCH MULTIPLIER TABLE
const PITCH_MULTIPLIERS: Record<string, number> = {
  'flat': 1.000,
  '1/12': 1.003,
  '2/12': 1.014,
  '3/12': 1.031,
  '4/12': 1.054,
  '5/12': 1.083,
  '6/12': 1.118,
  '7/12': 1.158,
  '8/12': 1.202,
  '9/12': 1.250,
  '10/12': 1.302,
  '11/12': 1.357,
  '12/12': 1.414,
  '14/12': 1.537,
  '16/12': 1.667,
  '18/12': 1.803,
  '20/12': 1.943
}

// HAVERSINE DISTANCE FORMULA
// Calculates exact distance between two GPS coordinates in feet
function haversineDistance(coord1: {lat: number, lng: number}, coord2: {lat: number, lng: number}): number {
  const R = 20902231 // Earth's radius in feet
  
  const toRad = (deg: number) => deg * (Math.PI / 180)
  
  const dLat = toRad(coord2.lat - coord1.lat)
  const dLon = toRad(coord2.lng - coord1.lng)
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.lat)) * Math.cos(toRad(coord2.lat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c
  
  return distance
}

// POLYGON AREA CALCULATION using Shoelace formula
function calculatePolygonArea(points: Array<{lat: number, lng: number}>): number {
  if (points.length < 3) return 0
  
  // Convert GPS points to local Cartesian coordinates (feet)
  const origin = points[0]
  const cartesianPoints = points.map(point => {
    // Distance east from origin
    const x = haversineDistance(origin, { lat: origin.lat, lng: point.lng })
    const xSign = point.lng >= origin.lng ? 1 : -1
    
    // Distance north from origin  
    const y = haversineDistance(origin, { lat: point.lat, lng: origin.lng })
    const ySign = point.lat >= origin.lat ? 1 : -1
    
    return { x: x * xSign, y: y * ySign }
  })
  
  // Shoelace formula
  let area = 0
  for (let i = 0; i < cartesianPoints.length; i++) {
    const j = (i + 1) % cartesianPoints.length
    area += cartesianPoints[i].x * cartesianPoints[j].y
    area -= cartesianPoints[j].x * cartesianPoints[i].y
  }
  area = Math.abs(area / 2)
  
  return area // Already in square feet
}

// POLYGON PERIMETER CALCULATION
function calculatePolygonPerimeter(points: Array<{lat: number, lng: number}>): number {
  let perimeter = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    perimeter += haversineDistance(points[i], points[j])
  }
  return perimeter
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { gpsAnalysis } = await req.json()
    
    if (!gpsAnalysis) {
      throw new Error('gpsAnalysis is required')
    }

    console.log('📐 Calculating roof measurements from GPS data...')

    // Calculate measurements for each facet
    const facetMeasurements = (gpsAnalysis.facets || []).map((facet: any) => {
      const flatArea = calculatePolygonArea(facet.polygon || [])
      const perimeter = calculatePolygonPerimeter(facet.polygon || [])
      const pitchMultiplier = PITCH_MULTIPLIERS[facet.estimatedPitch] || 1.118 // Default 6/12
      const adjustedArea = flatArea * pitchMultiplier
      
      return {
        facetNumber: facet.facetNumber,
        orientation: facet.orientation,
        pitch: facet.estimatedPitch,
        pitchMultiplier,
        flatAreaSqft: Math.round(flatArea * 10) / 10,
        adjustedAreaSqft: Math.round(adjustedArea * 10) / 10,
        perimeterFeet: Math.round(perimeter * 10) / 10,
        polygon: facet.polygon
      }
    })
    
    // Calculate edge measurements by type
    const edgeMeasurements = {
      ridge: {
        segments: (gpsAnalysis.edges?.ridges || []).map((edge: any) => ({
          start: edge.start,
          end: edge.end,
          lengthFeet: Math.round(haversineDistance(edge.start, edge.end) * 10) / 10,
          facetsConnected: edge.facetsConnected
        })),
        totalFeet: 0
      },
      hip: {
        segments: (gpsAnalysis.edges?.hips || []).map((edge: any) => ({
          start: edge.start,
          end: edge.end,
          lengthFeet: Math.round(haversineDistance(edge.start, edge.end) * 10) / 10,
          facetsConnected: edge.facetsConnected
        })),
        totalFeet: 0
      },
      valley: {
        segments: (gpsAnalysis.edges?.valleys || []).map((edge: any) => ({
          start: edge.start,
          end: edge.end,
          lengthFeet: Math.round(haversineDistance(edge.start, edge.end) * 10) / 10,
          facetsConnected: edge.facetsConnected
        })),
        totalFeet: 0
      },
      eave: {
        segments: (gpsAnalysis.edges?.eaves || []).map((edge: any) => ({
          start: edge.start,
          end: edge.end,
          lengthFeet: Math.round(haversineDistance(edge.start, edge.end) * 10) / 10
        })),
        totalFeet: 0
      },
      rake: {
        segments: (gpsAnalysis.edges?.rakes || []).map((edge: any) => ({
          start: edge.start,
          end: edge.end,
          lengthFeet: Math.round(haversineDistance(edge.start, edge.end) * 10) / 10
        })),
        totalFeet: 0
      }
    }
    
    // Calculate totals
    edgeMeasurements.ridge.totalFeet = edgeMeasurements.ridge.segments.reduce((sum: number, seg: any) => sum + seg.lengthFeet, 0)
    edgeMeasurements.hip.totalFeet = edgeMeasurements.hip.segments.reduce((sum: number, seg: any) => sum + seg.lengthFeet, 0)
    edgeMeasurements.valley.totalFeet = edgeMeasurements.valley.segments.reduce((sum: number, seg: any) => sum + seg.lengthFeet, 0)
    edgeMeasurements.eave.totalFeet = edgeMeasurements.eave.segments.reduce((sum: number, seg: any) => sum + seg.lengthFeet, 0)
    edgeMeasurements.rake.totalFeet = edgeMeasurements.rake.segments.reduce((sum: number, seg: any) => sum + seg.lengthFeet, 0)
    
    // Calculate total roof area and perimeter
    const totalFlatArea = facetMeasurements.reduce((sum: number, f: any) => sum + f.flatAreaSqft, 0)
    const totalAdjustedArea = facetMeasurements.reduce((sum: number, f: any) => sum + f.adjustedAreaSqft, 0)
    const totalPerimeter = edgeMeasurements.eave.totalFeet + edgeMeasurements.rake.totalFeet
    const totalSquares = Math.round((totalAdjustedArea / 100) * 10) / 10
    
    // Determine predominant pitch
    const pitchCounts: Record<string, number> = {}
    facetMeasurements.forEach((f: any) => {
      pitchCounts[f.pitch] = (pitchCounts[f.pitch] || 0) + f.adjustedAreaSqft
    })
    const predominantPitch = Object.keys(pitchCounts).length > 0
      ? Object.keys(pitchCounts).reduce((a, b) => pitchCounts[a] > pitchCounts[b] ? a : b)
      : '6/12'
    
    // Pitch variation analysis
    const hasPitchChange = Object.keys(pitchCounts).length > 1
    const pitchZones = Object.entries(pitchCounts).map(([pitch, area]) => ({
      pitch,
      areaSqft: Math.round(area * 10) / 10,
      facets: facetMeasurements.filter((f: any) => f.pitch === pitch).map((f: any) => f.facetNumber)
    }))

    const summary = {
      totalRoofAreaSqft: Math.round(totalAdjustedArea * 10) / 10,
      totalFlatAreaSqft: Math.round(totalFlatArea * 10) / 10,
      totalSquares,
      totalFacets: facetMeasurements.length,
      predominantPitch,
      predominantPitchArea: Math.round((pitchCounts[predominantPitch] || 0) * 10) / 10,
      roofType: gpsAnalysis.roofType,
      totalPerimeterFeet: Math.round(totalPerimeter * 10) / 10
    }

    const linearSummary = {
      ridgeFeet: Math.round(edgeMeasurements.ridge.totalFeet * 10) / 10,
      hipFeet: Math.round(edgeMeasurements.hip.totalFeet * 10) / 10,
      valleyFeet: Math.round(edgeMeasurements.valley.totalFeet * 10) / 10,
      eaveFeet: Math.round(edgeMeasurements.eave.totalFeet * 10) / 10,
      rakeFeet: Math.round(edgeMeasurements.rake.totalFeet * 10) / 10,
      hipsAndRidges: Math.round((edgeMeasurements.hip.totalFeet + edgeMeasurements.ridge.totalFeet) * 10) / 10,
      eavesAndRakes: Math.round((edgeMeasurements.eave.totalFeet + edgeMeasurements.rake.totalFeet) * 10) / 10
    }

    const materialCalculations = calculateMaterialRequirements(totalAdjustedArea, edgeMeasurements)

    console.log(`✅ Measurements calculated: ${totalAdjustedArea.toFixed(0)} sqft, ${totalSquares} squares`)

    return new Response(JSON.stringify({
      success: true,
      summary,
      facets: facetMeasurements,
      edges: edgeMeasurements,
      linearSummary,
      materialCalculations,
      pitchAnalysis: {
        hasPitchChange,
        pitchZones
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error: any) {
    console.error('❌ Measurement calculation error:', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// MATERIAL CALCULATIONS
function calculateMaterialRequirements(totalArea: number, edges: any) {
  const wasteFactors = [0, 10, 12, 15, 17, 20, 22]
  const hipsAndRidges = edges.hip.totalFeet + edges.ridge.totalFeet
  const eavesAndRakes = edges.eave.totalFeet + edges.rake.totalFeet
  const valleys = edges.valley.totalFeet
  
  return wasteFactors.map(waste => {
    const areaWithWaste = totalArea * (1 + waste / 100)
    const perimeterWithWaste = eavesAndRakes * (1 + waste / 100)
    const hipsRidgesWithWaste = hipsAndRidges * (1 + waste / 100)
    
    return {
      wastePercent: waste,
      areaSqft: Math.round(areaWithWaste),
      squares: Math.round(areaWithWaste / 100 * 10) / 10,
      shingleBundles: Math.ceil(areaWithWaste / 33), // ~33 sqft per bundle
      starterFeet: Math.round(perimeterWithWaste),
      starterBundles: Math.ceil(perimeterWithWaste / 85), // ~85 ft per bundle
      iceAndWaterFeet: Math.round(eavesAndRakes + valleys * 2),
      iceAndWaterRolls: Math.ceil((eavesAndRakes + valleys * 2) / 65), // 65 ft per roll
      cappingFeet: Math.round(hipsRidgesWithWaste),
      cappingBundles: Math.ceil(hipsRidgesWithWaste / 25) // ~25 ft per bundle
    }
  })
}
