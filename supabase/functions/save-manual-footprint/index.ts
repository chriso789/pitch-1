import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ManualFootprintRequest {
  measurementId: string;
  vertices: Array<{ lat: number; lng: number }>;
  source: 'manual_import' | 'manual_trace' | 'wkt_import';
  manualReferenceArea?: number; // Optional user-provided area for comparison
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { measurementId, vertices, source, manualReferenceArea } = await req.json() as ManualFootprintRequest
    
    console.log(`📐 Saving manual footprint for measurement ${measurementId}`)
    console.log(`   Source: ${source}, Vertices: ${vertices.length}`)
    
    // Validate polygon
    if (!vertices || vertices.length < 3) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Polygon must have at least 3 vertices'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Check polygon is closed (first and last vertex should match or we close it)
    const isClosed = vertices[0].lat === vertices[vertices.length - 1].lat &&
                     vertices[0].lng === vertices[vertices.length - 1].lng
    const closedVertices = isClosed ? vertices : [...vertices, vertices[0]]
    
    // Validate no self-intersection (simplified check)
    if (!isValidPolygon(closedVertices)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Polygon appears to be self-intersecting or invalid'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Calculate area from vertices
    const areaSqft = calculatePolygonAreaSqft(closedVertices)
    const perimeterFt = calculatePerimeterFt(closedVertices)
    const vertexCount = closedVertices.length
    const isRectangular = checkIfRectangular(closedVertices)
    
    console.log(`   Calculated: ${areaSqft.toFixed(0)} sqft, ${perimeterFt.toFixed(0)} ft perimeter, ${vertexCount} vertices, rectangular=${isRectangular}`)
    
    // Convert to WKT
    const wkt = verticesToWKT(closedVertices)
    
    // Initialize Supabase client
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // Update the measurement record
    const updateData: Record<string, any> = {
      perimeter_wkt: wkt,
      footprint_source: source,
      footprint_vertex_count: vertexCount,
      footprint_is_rectangular: isRectangular,
      requires_manual_review: false, // User manually verified
      updated_at: new Date().toISOString(),
    }
    
    // If manual reference area provided, calculate accuracy
    if (manualReferenceArea && manualReferenceArea > 0) {
      updateData.manual_reference_area_sqft = manualReferenceArea
      updateData.accuracy_vs_manual_percent = ((areaSqft - manualReferenceArea) / manualReferenceArea) * 100
    }
    
    const { data, error } = await supabaseClient
      .from('roof_measurements')
      .update(updateData)
      .eq('id', measurementId)
      .select()
      .single()
    
    if (error) {
      console.error('❌ Failed to save manual footprint:', error)
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`✅ Manual footprint saved successfully`)
    
    return new Response(JSON.stringify({
      success: true,
      data: {
        measurementId,
        areaSqft,
        perimeterFt,
        vertexCount,
        isRectangular,
        wkt,
        source,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('❌ save-manual-footprint error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Helper functions

function calculatePolygonAreaSqft(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 3) return 0
  
  const midLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180)
  
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
  return areaM2 * 10.764 // Convert to sqft
}

function calculatePerimeterFt(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 2) return 0
  
  const midLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180)
  
  let perimeter = 0
  for (let i = 0; i < vertices.length - 1; i++) {
    const dx = (vertices[i + 1].lng - vertices[i].lng) * metersPerDegLng
    const dy = (vertices[i + 1].lat - vertices[i].lat) * metersPerDegLat
    perimeter += Math.sqrt(dx * dx + dy * dy)
  }
  
  return perimeter * 3.28084 // Convert to feet
}

function checkIfRectangular(vertices: Array<{ lat: number; lng: number }>): boolean {
  // Remove closing vertex if present
  const uniqueVertices = vertices.length > 3 && 
    vertices[0].lat === vertices[vertices.length - 1].lat &&
    vertices[0].lng === vertices[vertices.length - 1].lng
    ? vertices.slice(0, -1)
    : vertices
  
  if (uniqueVertices.length !== 4) return false
  
  // Check if all angles are approximately 90 degrees
  const angles: number[] = []
  for (let i = 0; i < 4; i++) {
    const prev = uniqueVertices[(i - 1 + 4) % 4]
    const curr = uniqueVertices[i]
    const next = uniqueVertices[(i + 1) % 4]
    
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
  
  // All angles should be close to 90 degrees (within 15 degrees tolerance)
  return angles.every(angle => Math.abs(angle - 90) < 15)
}

function isValidPolygon(vertices: Array<{ lat: number; lng: number }>): boolean {
  // Basic validity checks
  if (vertices.length < 4) return false // Need at least 3 vertices + closing
  
  // Check for duplicate adjacent vertices
  for (let i = 0; i < vertices.length - 1; i++) {
    if (vertices[i].lat === vertices[i + 1].lat && 
        vertices[i].lng === vertices[i + 1].lng) {
      return false
    }
  }
  
  // Area should be non-zero
  const area = calculatePolygonAreaSqft(vertices)
  if (area < 50) return false // Minimum 50 sqft
  
  return true
}

function verticesToWKT(vertices: Array<{ lat: number; lng: number }>): string {
  const coords = vertices.map(v => `${v.lng} ${v.lat}`).join(', ')
  return `POLYGON((${coords}))`
}
