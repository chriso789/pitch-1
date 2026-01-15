import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ValidationRequest {
  measurementId: string;
}

interface PerimeterValidationResult {
  valid: boolean;
  perimeterLengthFt: number;
  edgeTotalFt: number;
  edgeCoveragePercent: number;
  calculatedAreaSqft: number;
  reportedAreaSqft: number;
  areaVariancePercent: number;
  warnings: string[];
  details: {
    eaveLengthFt: number;
    rakeLengthFt: number;
    ridgeLengthFt: number;
    hipLengthFt: number;
    valleyLengthFt: number;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { measurementId } = await req.json() as ValidationRequest
    
    console.log(`📐 Validating perimeter consistency for measurement ${measurementId}`)
    
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // Fetch measurement with all relevant data
    const { data: measurement, error: fetchError } = await supabaseClient
      .from('roof_measurements')
      .select('*')
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
    
    const warnings: string[] = []
    
    // Extract linear features from tags
    const tags = measurement.tags || {}
    const eaveLengthFt = parseFloat(tags['lf.eave'] || '0')
    const rakeLengthFt = parseFloat(tags['lf.rake'] || '0')
    const ridgeLengthFt = parseFloat(tags['lf.ridge'] || '0')
    const hipLengthFt = parseFloat(tags['lf.hip'] || '0')
    const valleyLengthFt = parseFloat(tags['lf.valley'] || '0')
    const reportedAreaSqft = parseFloat(tags['roof.area'] || '0')
    
    // Edge total (eave + rake should approximate perimeter)
    const edgeTotalFt = eaveLengthFt + rakeLengthFt
    
    // Calculate perimeter from WKT if available
    let perimeterLengthFt = 0
    let calculatedAreaSqft = 0
    
    const perimeterWkt = measurement.perimeter_wkt || measurement.manual_perimeter_wkt
    if (perimeterWkt) {
      const { perimeter, area } = parseWKTPolygon(perimeterWkt)
      perimeterLengthFt = perimeter
      calculatedAreaSqft = area
    }
    
    // Calculate edge coverage percentage
    const edgeCoveragePercent = perimeterLengthFt > 0 
      ? (edgeTotalFt / perimeterLengthFt) * 100 
      : 0
    
    // Calculate area variance
    const areaVariancePercent = reportedAreaSqft > 0 && calculatedAreaSqft > 0
      ? ((calculatedAreaSqft - reportedAreaSqft) / reportedAreaSqft) * 100
      : 0
    
    // Validation checks
    let valid = true
    
    // Edge coverage should be 70-110% of perimeter (some overlap expected at corners)
    if (edgeCoveragePercent > 0 && (edgeCoveragePercent < 70 || edgeCoveragePercent > 130)) {
      valid = false
      if (edgeCoveragePercent < 70) {
        warnings.push(`Low edge coverage: ${edgeCoveragePercent.toFixed(0)}% - linear features may be incomplete`)
      } else {
        warnings.push(`High edge coverage: ${edgeCoveragePercent.toFixed(0)}% - possible duplicate edges`)
      }
    }
    
    // Area variance should be within 15%
    if (Math.abs(areaVariancePercent) > 15) {
      valid = false
      warnings.push(`Area mismatch: calculated ${calculatedAreaSqft.toFixed(0)} sqft vs reported ${reportedAreaSqft.toFixed(0)} sqft (${areaVariancePercent > 0 ? '+' : ''}${areaVariancePercent.toFixed(1)}%)`)
    }
    
    // Interior features (ridge + hip + valley) should be reasonable
    const interiorTotal = ridgeLengthFt + hipLengthFt + valleyLengthFt
    if (interiorTotal === 0 && reportedAreaSqft > 500) {
      warnings.push('No interior features detected (ridge/hip/valley) for large roof')
    }
    
    // Ridge should exist for most roofs
    if (ridgeLengthFt === 0 && reportedAreaSqft > 500) {
      warnings.push('No ridge detected - unusual for residential roof')
    }
    
    // Update measurement with validation results
    const { error: updateError } = await supabaseClient
      .from('roof_measurements')
      .update({
        edge_coverage_percent: edgeCoveragePercent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', measurementId)
    
    if (updateError) {
      console.warn('Failed to update measurement with validation results:', updateError)
    }
    
    const result: PerimeterValidationResult = {
      valid,
      perimeterLengthFt,
      edgeTotalFt,
      edgeCoveragePercent,
      calculatedAreaSqft,
      reportedAreaSqft,
      areaVariancePercent,
      warnings,
      details: {
        eaveLengthFt,
        rakeLengthFt,
        ridgeLengthFt,
        hipLengthFt,
        valleyLengthFt,
      }
    }
    
    console.log(`📐 Validation result: valid=${valid}, coverage=${edgeCoveragePercent.toFixed(0)}%, variance=${areaVariancePercent.toFixed(1)}%`)
    
    return new Response(JSON.stringify({
      success: true,
      data: result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('❌ validate-perimeter error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Parse WKT POLYGON and calculate perimeter + area
function parseWKTPolygon(wkt: string): { perimeter: number; area: number } {
  try {
    const match = wkt.match(/POLYGON\s*\(\s*\(\s*([^)]+)\s*\)\s*\)/i)
    if (!match) return { perimeter: 0, area: 0 }
    
    const coordsStr = match[1]
    const pairs = coordsStr.split(',').map(p => p.trim())
    
    const vertices: Array<{ lng: number; lat: number }> = []
    for (const pair of pairs) {
      const parts = pair.split(/\s+/).filter(Boolean)
      if (parts.length === 2) {
        vertices.push({ lng: parseFloat(parts[0]), lat: parseFloat(parts[1]) })
      }
    }
    
    if (vertices.length < 3) return { perimeter: 0, area: 0 }
    
    // Calculate perimeter
    const midLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length
    const metersPerDegLat = 111320
    const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180)
    
    let perimeter = 0
    for (let i = 0; i < vertices.length - 1; i++) {
      const dx = (vertices[i + 1].lng - vertices[i].lng) * metersPerDegLng
      const dy = (vertices[i + 1].lat - vertices[i].lat) * metersPerDegLat
      perimeter += Math.sqrt(dx * dx + dy * dy)
    }
    const perimeterFt = perimeter * 3.28084
    
    // Calculate area using shoelace formula
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
    const areaSqft = areaM2 * 10.764
    
    return { perimeter: perimeterFt, area: areaSqft }
  } catch {
    return { perimeter: 0, area: 0 }
  }
}
