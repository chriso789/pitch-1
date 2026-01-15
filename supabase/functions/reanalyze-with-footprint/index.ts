import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ReanalyzeRequest {
  measurementId: string;
  useManualFootprint?: boolean;
  manualVertices?: Array<{ lat: number; lng: number }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { measurementId, useManualFootprint, manualVertices } = await req.json() as ReanalyzeRequest
    
    console.log(`🔄 Re-analyzing measurement ${measurementId} with manual footprint`)
    
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // Fetch existing measurement
    const { data: measurement, error: fetchError } = await supabaseClient
      .from('roof_measurements')
      .select('*, contacts!inner(latitude, longitude, address_line1, city, state, zip_code)')
      .eq('id', measurementId)
      .single()
    
    if (fetchError || !measurement) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Measurement not found'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Get coordinates
    const lat = measurement.latitude || measurement.contacts?.latitude
    const lng = measurement.longitude || measurement.contacts?.longitude
    
    if (!lat || !lng) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No coordinates available for re-analysis'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Get footprint vertices - either from request or from saved manual perimeter
    let footprintVertices: Array<{ lat: number; lng: number }> | null = null
    
    if (manualVertices && manualVertices.length >= 3) {
      footprintVertices = manualVertices
      console.log(`📐 Using provided vertices: ${manualVertices.length} points`)
    } else if (useManualFootprint && measurement.manual_perimeter_wkt) {
      footprintVertices = parseWKTToVertices(measurement.manual_perimeter_wkt)
      console.log(`📐 Using saved manual perimeter: ${footprintVertices?.length || 0} vertices`)
    }
    
    if (!footprintVertices || footprintVertices.length < 3) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No valid manual footprint available'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Calculate measurements from manual footprint
    const measurements = calculateMeasurementsFromFootprint(footprintVertices)
    
    // Update the measurement record with new calculations
    const updateData: Record<string, any> = {
      perimeter_wkt: verticesToWKT(footprintVertices),
      footprint_source: 'manual_reanalysis',
      footprint_vertex_count: footprintVertices.length,
      footprint_is_rectangular: checkIfRectangular(footprintVertices),
      requires_manual_review: false,
      updated_at: new Date().toISOString(),
    }
    
    // Update tags with new measurements
    const existingTags = measurement.tags || {}
    const updatedTags = {
      ...existingTags,
      'roof.area': measurements.areaSqft,
      'roof.squares': measurements.areaSqft / 100,
      'perimeter.ft': measurements.perimeterFt,
    }
    
    updateData.tags = updatedTags
    
    // Calculate accuracy if manual reference exists
    if (measurement.manual_reference_area_sqft) {
      updateData.accuracy_vs_manual_percent = 
        ((measurements.areaSqft - measurement.manual_reference_area_sqft) / measurement.manual_reference_area_sqft) * 100
      updateData.accuracy_compared_at = new Date().toISOString()
    }
    
    const { data: updated, error: updateError } = await supabaseClient
      .from('roof_measurements')
      .update(updateData)
      .eq('id', measurementId)
      .select()
      .single()
    
    if (updateError) {
      console.error('Failed to update measurement:', updateError)
      return new Response(JSON.stringify({
        success: false,
        error: updateError.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`✅ Re-analysis complete: ${measurements.areaSqft.toFixed(0)} sqft from ${footprintVertices.length} vertices`)
    
    return new Response(JSON.stringify({
      success: true,
      data: {
        measurementId,
        areaSqft: measurements.areaSqft,
        perimeterFt: measurements.perimeterFt,
        vertexCount: footprintVertices.length,
        isRectangular: updateData.footprint_is_rectangular,
        accuracyVsManual: updateData.accuracy_vs_manual_percent,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('❌ reanalyze-with-footprint error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Parse WKT POLYGON to vertex array
function parseWKTToVertices(wkt: string): Array<{ lat: number; lng: number }> | null {
  try {
    const match = wkt.match(/POLYGON\s*\(\s*\(\s*([^)]+)\s*\)\s*\)/i)
    if (!match) return null
    
    const coordsStr = match[1]
    const pairs = coordsStr.split(',').map(p => p.trim())
    
    const vertices: Array<{ lat: number; lng: number }> = []
    for (const pair of pairs) {
      const parts = pair.split(/\s+/).filter(Boolean)
      if (parts.length === 2) {
        vertices.push({ lng: parseFloat(parts[0]), lat: parseFloat(parts[1]) })
      }
    }
    
    return vertices.length >= 3 ? vertices : null
  } catch {
    return null
  }
}

function verticesToWKT(vertices: Array<{ lat: number; lng: number }>): string {
  const closed = [...vertices]
  if (vertices[0].lat !== vertices[vertices.length - 1].lat ||
      vertices[0].lng !== vertices[vertices.length - 1].lng) {
    closed.push(vertices[0])
  }
  const coords = closed.map(v => `${v.lng} ${v.lat}`).join(', ')
  return `POLYGON((${coords}))`
}

function calculateMeasurementsFromFootprint(vertices: Array<{ lat: number; lng: number }>): {
  areaSqft: number;
  perimeterFt: number;
} {
  const midLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180)
  
  // Calculate perimeter
  let perimeter = 0
  const closed = [...vertices, vertices[0]]
  for (let i = 0; i < closed.length - 1; i++) {
    const dx = (closed[i + 1].lng - closed[i].lng) * metersPerDegLng
    const dy = (closed[i + 1].lat - closed[i].lat) * metersPerDegLat
    perimeter += Math.sqrt(dx * dx + dy * dy)
  }
  
  // Calculate area using shoelace
  let sum = 0
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length
    const x1 = vertices[i].lng * metersPerDegLng
    const y1 = vertices[i].lat * metersPerDegLat
    const x2 = vertices[j].lng * metersPerDegLng
    const y2 = vertices[j].lat * metersPerDegLat
    sum += (x1 * y2 - x2 * y1)
  }
  const areaM2 = Math.abs(sum) / 2
  
  return {
    areaSqft: areaM2 * 10.764,
    perimeterFt: perimeter * 3.28084,
  }
}

function checkIfRectangular(vertices: Array<{ lat: number; lng: number }>): boolean {
  const unique = vertices.length > 3 && 
    vertices[0].lat === vertices[vertices.length - 1].lat &&
    vertices[0].lng === vertices[vertices.length - 1].lng
    ? vertices.slice(0, -1)
    : vertices
  
  if (unique.length !== 4) return false
  
  const angles: number[] = []
  for (let i = 0; i < 4; i++) {
    const prev = unique[(i - 1 + 4) % 4]
    const curr = unique[i]
    const next = unique[(i + 1) % 4]
    
    const v1x = prev.lng - curr.lng
    const v1y = prev.lat - curr.lat
    const v2x = next.lng - curr.lng
    const v2y = next.lat - curr.lat
    
    const dot = v1x * v2x + v1y * v2y
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y)
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y)
    
    if (mag1 === 0 || mag2 === 0) return false
    
    const cosAngle = dot / (mag1 * mag2)
    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI
    angles.push(angle)
  }
  
  return angles.every(angle => Math.abs(angle - 90) < 15)
}
