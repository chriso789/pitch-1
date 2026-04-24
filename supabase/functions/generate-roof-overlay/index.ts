// Unified Roof Overlay Generator - Returns exact JSON format for AI Overlay Objective
// TWO-PASS VERTEX-SNAPPED approach for human-traced quality
// Pass 1: Detect all vertices (corners, ridge ends, hip apexes, T-junctions)
// Pass 2: Connect vertices as classified edges (ridge/hip/valley/eave/rake)

import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!
const MAPBOX_PUBLIC_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RoofOverlayOutput {
  perimeter: [number, number][]
  ridges: RoofLine[]
  hips: RoofLine[]
  valleys: RoofLine[]
  eaves: RoofLine[]
  rakes: RoofLine[]
  detectedPerimeter?: [number, number][]
  metadata: {
    roofType: string
    qualityScore: number
    dataSourcesPriority: string[]
    requiresManualReview: boolean
    totalAreaSqft?: number
    processedAt: string
    alignmentAttempts?: number
    perimeterSource?: string
    detectionMethod: string
  }
}

interface RoofLine {
  start: [number, number]
  end: [number, number]
  confidence: number
  requiresReview: boolean
  source?: string
  visualEvidence?: string
  snappedToTarget?: boolean
}

// Detected vertex from Pass 1
interface DetectedVertex {
  id: string
  x: number  // pixel percentage 0-100
  y: number  // pixel percentage 0-100
  type: string // eave_corner, ridge_end, hip_apex, valley_bottom, t_junction, gable_peak
  description: string
}

// Detected edge from Pass 2
interface DetectedEdge {
  fromId: string
  toId: string
  type: string // ridge, hip, valley, eave, rake
  confidence: number
  description: string
}

const IMAGE_SIZE = 1024
const DETAIL_ZOOM = 20
const SNAP_THRESHOLD_FT = 5
const FT_TO_DEG = 1 / 364000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const { lat, lng, address, imageUrl, tenantId } = await req.json()
    
    if (!lat || !lng) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing required coordinates (lat, lng)' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`🏠 Generate Roof Overlay (two-pass) for: ${address || `${lat}, ${lng}`}`)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const coordinates = { lat, lng }

    // Step 1: Fetch satellite imagery
    const mapboxUrl = imageUrl || fetchMapboxSatellite(coordinates)
    console.log(`📸 Satellite image ready`)

    // Step 2: Call analyze-roof-aerial for perimeter
    const analysisResult = await callAnalyzeRoofAerial(supabase, address, coordinates)

    // Step 3: Extract perimeter with Vision fallback
    let perimeter: [number, number][] = []
    if (analysisResult.success) {
      perimeter = extractPerimeter(analysisResult.data)
      console.log(`📐 Perimeter from analyzer: ${perimeter.length} vertices`)
    }

    if (perimeter.length < 4) {
      console.log('🛟 Falling back to Gemini Vision perimeter trace')
      const traced = await traceRoofPerimeterFromImage(mapboxUrl, coordinates)
      if (traced && traced.length >= 4) {
        perimeter = traced
        console.log(`✅ Vision-traced perimeter: ${perimeter.length} vertices`)
      } else {
        return new Response(JSON.stringify({
          success: false,
          error: 'Could not extract roof perimeter from aerial imagery'
        }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    // Step 4: TWO-PASS VERTEX-SNAPPED DETECTION (perimeter-constrained)
    // ═══════════════════════════════════════════
    // Pass 1: Detect all vertices, seeded with known perimeter corners
    // Pass 2: Connect vertices as classified edges
    // Repair: Drop orphan edges, ensure perimeter eaves are present
    const perimeterPctVertices = perimeter.map(([lng, lat]) =>
      geoToPixelPct(lng, lat, coordinates, IMAGE_SIZE, DETAIL_ZOOM)
    )

    const twoPassResult = await twoPassVertexSnappedDetection(
      mapboxUrl,
      coordinates,
      perimeterPctVertices
    )

    if (!twoPassResult) {
      console.error('❌ Two-pass detection returned no results')
      return new Response(JSON.stringify({
        success: false,
        error: 'AI detection failed to identify roof features'
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Repair topology: drop edges referencing missing vertices, dedupe, ensure perimeter eaves
    const repaired = repairTopology(twoPassResult, perimeterPctVertices)
    console.log(`🔧 Repaired: ${repaired.vertices.length} vertices, ${repaired.edges.length} edges (was ${twoPassResult.vertices.length}/${twoPassResult.edges.length})`)

    // Convert pixel coordinates to geo coordinates
    const geoFeatures = convertToGeoFeatures(repaired, coordinates)
    console.log(`🌍 Geo features: ${geoFeatures.ridges.length} ridges, ${geoFeatures.hips.length} hips, ${geoFeatures.valleys.length} valleys, ${geoFeatures.eaves.length} eaves, ${geoFeatures.rakes.length} rakes`)

    // Step 5: Snap interior lines to perimeter corners
    const snappedFeatures = snapInteriorLinesToPerimeter(geoFeatures, perimeter)

    // Step 6: Apply learned corrections
    const correctedFeatures = await applyLearnedCorrections(supabase, snappedFeatures, tenantId)

    // Step 7: Build output
    const qualityScore = calculateQualityScore(correctedFeatures)
    const output: RoofOverlayOutput = {
      perimeter,
      ridges: correctedFeatures.ridges,
      hips: correctedFeatures.hips,
      valleys: correctedFeatures.valleys,
      eaves: correctedFeatures.eaves,
      rakes: correctedFeatures.rakes,
      metadata: {
        roofType: analysisResult.data?.aiAnalysis?.roofType || 'complex',
        qualityScore,
        dataSourcesPriority: ['mapbox_satellite', 'ai_vision_two_pass'],
        requiresManualReview: qualityScore < 75,
        totalAreaSqft: analysisResult.data?.measurements?.totalAreaSqft,
        processedAt: new Date().toISOString(),
        perimeterSource: 'footprint_derived',
        detectionMethod: 'two_pass_vertex_snapped'
      }
    }

    const processingTimeMs = Date.now() - startTime
    console.log(`✅ Roof overlay generated in ${processingTimeMs}ms (quality: ${qualityScore}%)`)

    return new Response(JSON.stringify({
      success: true,
      data: output,
      processingTimeMs
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('❌ Generate roof overlay error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// ═══════════════════════════════════════════════════════════════
// TWO-PASS VERTEX-SNAPPED DETECTION
// ═══════════════════════════════════════════════════════════════

interface TwoPassResult {
  vertices: DetectedVertex[]
  edges: DetectedEdge[]
}

async function twoPassVertexSnappedDetection(
  imageUrl: string,
  coordinates: { lat: number; lng: number }
): Promise<TwoPassResult | null> {

  // ──── PASS 1: Detect all vertices ────
  console.log('🔵 Pass 1: Detecting vertices...')
  const vertices = await detectVertices(imageUrl)
  if (!vertices || vertices.length < 3) {
    console.error('Pass 1 failed: insufficient vertices detected')
    return null
  }
  console.log(`🔵 Pass 1 complete: ${vertices.length} vertices detected`)

  // ──── PASS 2: Connect vertices as classified edges ────
  console.log('🟢 Pass 2: Connecting vertices as edges...')
  const edges = await connectVerticesAsEdges(imageUrl, vertices)
  if (!edges || edges.length < 3) {
    console.error('Pass 2 failed: insufficient edges detected')
    return null
  }
  console.log(`🟢 Pass 2 complete: ${edges.length} edges classified`)

  return { vertices, edges }
}

async function detectVertices(imageUrl: string): Promise<DetectedVertex[] | null> {
  const prompt = `You are an expert satellite imagery analyst. Analyze this roof image and identify EVERY vertex point where roof edges meet.

VERTEX TYPES TO FIND:
1. EAVE CORNERS: Where the roof edge (gutter line) changes direction at building corners
2. RIDGE ENDS: Where a ridge line terminates (at a gable end or where it meets a hip)
3. HIP APEXES: Where a hip line originates at the ridge and begins descending
4. VALLEY BOTTOMS: Where two roof planes meet creating an inward V at the eave level
5. T-JUNCTIONS: Where a smaller roof section meets a larger one
6. GABLE PEAKS: The triangular peak of a gable end

CRITICAL RULES:
- Use [x%, y%] coordinates where (0,0) = top-left, (100,100) = bottom-right of image
- Give each vertex a unique ID like "v1", "v2", etc.
- Look VERY carefully at the image — roofs are rarely perfect rectangles
- Include ALL corners including porch kickouts, garage extensions, dormers
- Accuracy is paramount — place each point exactly on the visible feature

Return ONLY valid JSON (no markdown, no explanation):
{
  "vertices": [
    {"id": "v1", "x": 15.2, "y": 10.5, "type": "eave_corner", "description": "NW eave corner of main roof"},
    {"id": "v2", "x": 82.1, "y": 10.8, "type": "eave_corner", "description": "NE eave corner of main roof"},
    {"id": "v3", "x": 48.5, "y": 42.0, "type": "ridge_end", "description": "west end of main ridge"},
    {"id": "v4", "x": 78.0, "y": 42.0, "type": "ridge_end", "description": "east end of main ridge where hip begins"}
  ]
}`

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: 'You are a precision roof geometry analyst. You identify exact vertex locations on satellite roof images. Return only valid JSON, no markdown.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      })
    })

    if (!response.ok) {
      console.error('Pass 1 AI call failed:', response.status)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('Pass 1: No JSON in response')
      return null
    }

    const parsed = JSON.parse(jsonMatch[0])
    const vertices: DetectedVertex[] = (parsed.vertices || []).map((v: any) => ({
      id: v.id,
      x: v.x,
      y: v.y,
      type: v.type || 'unknown',
      description: v.description || ''
    }))

    return vertices

  } catch (error) {
    console.error('Pass 1 error:', error)
    return null
  }
}

async function connectVerticesAsEdges(
  imageUrl: string,
  vertices: DetectedVertex[]
): Promise<DetectedEdge[] | null> {
  
  // Build vertex list for the prompt
  const vertexList = vertices.map(v => 
    `  ${v.id}: (${v.x.toFixed(1)}%, ${v.y.toFixed(1)}%) — ${v.type} — ${v.description}`
  ).join('\n')

  const prompt = `You are connecting previously detected roof vertices into classified edges.

HERE ARE THE DETECTED VERTICES (from Pass 1):
${vertexList}

YOUR TASK: For each pair of vertices that should be connected by a roof feature, create an edge with the correct classification.

EDGE TYPES:
- "ridge": Connects ridge_end to ridge_end (the peak line at the very top)
- "hip": Connects a ridge endpoint DOWN to an eave_corner (diagonal line descending from ridge to corner)
- "valley": Connects from a T-junction or reflex corner UP to a ridge (inward V where two sections meet)
- "eave": Connects eave_corner to eave_corner along the gutter/drip line (horizontal bottom edge)
- "rake": Connects eave_corner to gable_peak (sloped edge at a gable end)

TOPOLOGY RULES:
- Every eave_corner should connect to its adjacent eave_corners (forming the perimeter)
- Every eave_corner that is NOT a gable end should have a hip running UP to the nearest ridge endpoint
- Ridges run along the top peak, connecting ridge endpoints
- Valleys ONLY exist at inside corners (L-shaped, T-shaped roofs)
- Every vertex should have at least 2 edges connected to it
- Do NOT create edges between vertices that are not visually connected by a roof feature
- Every edge MUST use vertex IDs from the list above — no new points allowed

Return ONLY valid JSON (no markdown):
{
  "edges": [
    {"fromId": "v1", "toId": "v2", "type": "eave", "confidence": 95, "description": "north eave line"},
    {"fromId": "v3", "toId": "v4", "type": "ridge", "confidence": 90, "description": "main ridge"},
    {"fromId": "v3", "toId": "v1", "type": "hip", "confidence": 88, "description": "NW hip from ridge to corner"}
  ]
}`

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: 'You are connecting roof vertices into classified edges. Every edge MUST reference existing vertex IDs. Return only valid JSON, no markdown.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      })
    })

    if (!response.ok) {
      console.error('Pass 2 AI call failed:', response.status)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('Pass 2: No JSON in response')
      return null
    }

    const parsed = JSON.parse(jsonMatch[0])
    
    // Validate that all edge references exist in vertex list
    const vertexIds = new Set(vertices.map(v => v.id))
    const edges: DetectedEdge[] = (parsed.edges || [])
      .filter((e: any) => vertexIds.has(e.fromId) && vertexIds.has(e.toId))
      .map((e: any) => ({
        fromId: e.fromId,
        toId: e.toId,
        type: e.type || 'unknown',
        confidence: e.confidence || 80,
        description: e.description || ''
      }))

    const invalidCount = (parsed.edges || []).length - edges.length
    if (invalidCount > 0) {
      console.warn(`Pass 2: Dropped ${invalidCount} edges with invalid vertex references`)
    }

    return edges

  } catch (error) {
    console.error('Pass 2 error:', error)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// COORDINATE CONVERSION & FEATURE BUILDING
// ═══════════════════════════════════════════════════════════════

interface GeoFeatures {
  ridges: RoofLine[]
  hips: RoofLine[]
  valleys: RoofLine[]
  eaves: RoofLine[]
  rakes: RoofLine[]
}

function convertToGeoFeatures(
  result: TwoPassResult,
  coordinates: { lat: number; lng: number }
): GeoFeatures {
  const { vertices, edges } = result

  // Build vertex lookup
  const vertexMap = new Map<string, DetectedVertex>()
  for (const v of vertices) {
    vertexMap.set(v.id, v)
  }

  const toGeo = (x: number, y: number): [number, number] => {
    return pixelPctToGeo(x, y, coordinates, IMAGE_SIZE, DETAIL_ZOOM)
  }

  const features: GeoFeatures = {
    ridges: [], hips: [], valleys: [], eaves: [], rakes: []
  }

  for (const edge of edges) {
    const fromVertex = vertexMap.get(edge.fromId)
    const toVertex = vertexMap.get(edge.toId)
    if (!fromVertex || !toVertex) continue

    const line: RoofLine = {
      start: toGeo(fromVertex.x, fromVertex.y),
      end: toGeo(toVertex.x, toVertex.y),
      confidence: edge.confidence,
      requiresReview: edge.confidence < 75,
      source: 'ai_two_pass',
      visualEvidence: edge.description,
      snappedToTarget: true // snapped to detected vertices by construction
    }

    const type = edge.type.toLowerCase()
    if (type === 'ridge') features.ridges.push(line)
    else if (type === 'hip') features.hips.push(line)
    else if (type === 'valley') features.valleys.push(line)
    else if (type === 'eave') features.eaves.push(line)
    else if (type === 'rake') features.rakes.push(line)
  }

  return features
}

function pixelPctToGeo(
  xPct: number,
  yPct: number,
  center: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): [number, number] {
  const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180)
  
  const pxOffsetX = ((xPct / 100) - 0.5) * imageSize
  const pxOffsetY = ((yPct / 100) - 0.5) * imageSize
  
  const metersX = pxOffsetX * metersPerPixel
  const metersY = -pxOffsetY * metersPerPixel
  
  return [
    center.lng + metersX / metersPerDegLng,
    center.lat + metersY / metersPerDegLat
  ]
}

// ═══════════════════════════════════════════════════════════════
// SNAPPING & POST-PROCESSING
// ═══════════════════════════════════════════════════════════════

function snapInteriorLinesToPerimeter(
  features: GeoFeatures,
  perimeter: [number, number][]
): GeoFeatures {
  const snapThresholdDeg = SNAP_THRESHOLD_FT * FT_TO_DEG

  // Collect snap targets from perimeter + ridge endpoints
  const snapTargets: [number, number][] = [...perimeter]
  features.ridges.forEach(r => {
    snapTargets.push(r.start)
    snapTargets.push(r.end)
  })

  const snapPoint = (point: [number, number]): [number, number] => {
    let nearest = point
    let minDist = Infinity

    for (const target of snapTargets) {
      const dist = Math.sqrt(
        Math.pow(point[0] - target[0], 2) + 
        Math.pow(point[1] - target[1], 2)
      )
      if (dist < minDist && dist < snapThresholdDeg) {
        minDist = dist
        nearest = target
      }
    }
    return nearest
  }

  const snapLine = (line: RoofLine): RoofLine => ({
    ...line,
    start: snapPoint(line.start),
    end: snapPoint(line.end),
    snappedToTarget: true
  })

  return {
    ridges: features.ridges.map(snapLine),
    hips: features.hips.map(snapLine),
    valleys: features.valleys.map(snapLine),
    eaves: features.eaves.map(snapLine),
    rakes: features.rakes.map(snapLine)
  }
}

// ═══════════════════════════════════════════════════════════════
// LEARNED CORRECTIONS
// ═══════════════════════════════════════════════════════════════

async function applyLearnedCorrections(
  supabase: any,
  features: GeoFeatures,
  tenantId?: string
): Promise<GeoFeatures> {
  if (!tenantId) return features

  try {
    const { data: corrections } = await supabase
      .from('measurement_corrections')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!corrections || corrections.length === 0) return features

    const applyCorrection = (line: RoofLine, correctionSet: any[]): RoofLine => {
      if (correctionSet.length === 0) return line
      const avgShiftLng = correctionSet.reduce((sum: number, c: any) => sum + (c.shift_lng || 0), 0) / correctionSet.length
      const avgShiftLat = correctionSet.reduce((sum: number, c: any) => sum + (c.shift_lat || 0), 0) / correctionSet.length
      return {
        ...line,
        start: [line.start[0] + avgShiftLng, line.start[1] + avgShiftLat],
        end: [line.end[0] + avgShiftLng, line.end[1] + avgShiftLat],
        source: 'ai_two_pass_corrected'
      }
    }

    const ridgeC = corrections.filter((c: any) => c.line_type === 'ridge')
    const hipC = corrections.filter((c: any) => c.line_type === 'hip')
    const valleyC = corrections.filter((c: any) => c.line_type === 'valley')

    return {
      ...features,
      ridges: features.ridges.map(r => applyCorrection(r, ridgeC)),
      hips: features.hips.map(h => applyCorrection(h, hipC)),
      valleys: features.valleys.map(v => applyCorrection(v, valleyC))
    }
  } catch (error) {
    console.warn('Failed to apply learned corrections:', error)
    return features
  }
}

// ═══════════════════════════════════════════════════════════════
// QUALITY & SCORING
// ═══════════════════════════════════════════════════════════════

function calculateQualityScore(features: GeoFeatures): number {
  const allLines = [
    ...features.ridges, ...features.hips, ...features.valleys,
    ...features.eaves, ...features.rakes
  ]
  
  if (allLines.length === 0) return 50

  const avgConfidence = allLines.reduce((sum, l) => sum + l.confidence, 0) / allLines.length
  const snappedCount = allLines.filter(l => l.snappedToTarget).length
  const snappedBonus = (snappedCount / allLines.length) * 10

  return Math.round(Math.max(0, Math.min(100, avgConfidence + snappedBonus)))
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function fetchMapboxSatellite(coordinates: { lat: number; lng: number }): string {
  const { lat, lng } = coordinates
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${DETAIL_ZOOM},0/${IMAGE_SIZE}x${IMAGE_SIZE}@2x?access_token=${MAPBOX_PUBLIC_TOKEN}`
}

async function callAnalyzeRoofAerial(
  supabase: any,
  address: string,
  coordinates: { lat: number; lng: number }
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('analyze-roof-aerial', {
      body: { address, coordinates }
    })
    if (error) return { success: false, error: error.message }
    return { success: data?.success || false, data: data?.data, error: data?.error }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

function extractPerimeter(data: any): [number, number][] {
  if (!data) return []
  if (data.perimeterWkt) {
    const coords = parseWKTPolygon(data.perimeterWkt)
    if (coords.length > 0) return coords
  }
  if (data.aiAnalysis?.roofPerimeter) {
    const vertices = data.aiAnalysis.roofPerimeter
    if (Array.isArray(vertices) && vertices.length > 0 && typeof vertices[0][0] === 'number') {
      return vertices as [number, number][]
    }
  }
  return []
}

function parseWKTPolygon(wkt: string): [number, number][] {
  if (!wkt) return []
  const match = wkt.match(/POLYGON\s*\(\(([^)]+)\)\)/i)
  if (!match) return []
  return match[1].split(',').map(s => {
    const [lngStr, latStr] = s.trim().split(/\s+/)
    return [parseFloat(lngStr), parseFloat(latStr)] as [number, number]
  }).filter(c => !isNaN(c[0]) && !isNaN(c[1]))
}

async function traceRoofPerimeterFromImage(
  imageUrl: string,
  coordinates: { lat: number; lng: number }
): Promise<[number, number][] | null> {
  const HALF_SPAN_M = 40

  const prompt = `You are looking at a high-resolution satellite image of a single residential property.

TASK: Trace the OUTER ROOF DRIP-LINE of the MAIN house in the center.

Return ONLY valid JSON:
{ "vertices": [[x, y], [x, y], ...] }

RULES:
- x and y are NORMALIZED image coordinates: 0.0 = left/top edge, 1.0 = right/bottom edge.
- Provide 4 to 24 vertices in CLOCKWISE order.
- Trace ONLY the main house roof.
- Snap precisely to actual roof corners visible in the image.

Output ONLY the JSON object.`

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
        max_completion_tokens: 1500,
        temperature: 0.1,
      }),
    })

    if (!response.ok) {
      console.error('Vision perimeter HTTP error:', response.status)
      return null
    }

    const ai = await response.json()
    let content: string = ai?.choices?.[0]?.message?.content || ''
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch {
      const m = content.match(/\{[\s\S]*\}/)
      if (!m) return null
      parsed = JSON.parse(m[0])
    }

    const verts = parsed?.vertices
    if (!Array.isArray(verts) || verts.length < 4) return null

    const metersPerDegLat = 111320
    const metersPerDegLng = 111320 * Math.cos((coordinates.lat * Math.PI) / 180)

    const result: [number, number][] = []
    for (const v of verts) {
      if (!Array.isArray(v) || v.length < 2) continue
      const x = Math.max(0, Math.min(1, Number(v[0])))
      const y = Math.max(0, Math.min(1, Number(v[1])))
      const dxM = (x - 0.5) * 2 * HALF_SPAN_M
      const dyM = (y - 0.5) * 2 * HALF_SPAN_M
      const lng = coordinates.lng + dxM / metersPerDegLng
      const lat = coordinates.lat - dyM / metersPerDegLat
      result.push([lng, lat])
    }

    if (result.length < 4) return null
    const first = result[0], last = result[result.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) {
      result.push([first[0], first[1]])
    }
    return result
  } catch (err) {
    console.error('Vision perimeter trace exception:', err)
    return null
  }
}
