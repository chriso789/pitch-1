// Unified Roof Overlay Generator - Returns exact JSON format for AI Overlay Objective
// Single endpoint that orchestrates full analysis and returns precise roof topology
// ENHANCED: Phase 1-5 implementation for human-traced quality

import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!
const MAPBOX_PUBLIC_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Output format matching AI Overlay Objective specification
interface RoofOverlayOutput {
  perimeter: [number, number][]; // [[lng, lat], ...]
  ridges: RoofLine[];
  hips: RoofLine[];
  valleys: RoofLine[];
  eaves: RoofLine[];
  rakes: RoofLine[];
  detectedPerimeter?: [number, number][]; // AI-traced actual roof drip-line
  metadata: {
    roofType: string;
    qualityScore: number;
    dataSourcesPriority: string[];
    requiresManualReview: boolean;
    totalAreaSqft?: number;
    processedAt: string;
    alignmentAttempts?: number;
    perimeterSource?: string; // 'ai_vision' | 'osm' | 'solar'
  };
}

interface RoofLine {
  start: [number, number]; // [lng, lat]
  end: [number, number];   // [lng, lat]
  confidence: number;
  requiresReview: boolean;
  source?: string;
  visualEvidence?: string; // Phase 5: What the AI saw (shadow, highlight, edge)
  snappedToTarget?: boolean; // Phase 3: Whether endpoint is properly snapped
}

interface VisualAlignmentResult {
  line: RoofLine;
  aligned: boolean;
  offsetFt: number;
  adjustedLine?: RoofLine;
}

interface DetectedFeature {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  confidence: number;
  description: string;
  snapStartTo?: string;
  snapEndTo?: string;
}

const IMAGE_ZOOM = 20
const IMAGE_SIZE = 640
const SNAP_THRESHOLD_FT = 5 // Max snap distance (increased from 3 for better connectivity)
const FT_TO_DEG = 1 / 364000 // Approximate feet to degrees at US latitudes
const MIN_ALIGNMENT_SCORE = 90 // Target alignment score
const MAX_ALIGNMENT_ATTEMPTS = 3 // Iterative refinement limit
const DETAIL_ZOOM = 19 // Slightly zoomed out for better roof context

// Corner classification types
interface ClassifiedCorner {
  coord: [number, number];
  type: 'convex' | 'reflex'; // convex = eave corner (hip endpoint), reflex = valley origin
  angle: number;
  index: number;
}

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

    console.log(`🏠 Generate Roof Overlay for: ${address || `${lat}, ${lng}`}`)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const coordinates = { lat, lng }

    // Step 1: Fetch satellite imagery
    const mapboxUrl = imageUrl || await fetchMapboxSatellite(coordinates)
    console.log(`📸 Satellite image ready`)

    // Step 2: Call main analyze-roof-aerial for perimeter and initial detection
    const analysisResult = await callAnalyzeRoofAerial(supabase, address, coordinates)
    
    if (!analysisResult.success) {
      console.error('❌ Roof analysis failed:', analysisResult.error)
      return new Response(JSON.stringify({
        success: false,
        error: analysisResult.error || 'Roof analysis failed'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Step 3: Extract perimeter in correct format
    const perimeter = extractPerimeter(analysisResult.data)
    console.log(`📐 Perimeter: ${perimeter.length} vertices`)

    // Step 4: PHASE 1 - Enhanced AI Vision Detection with perimeter tracing + eave/rake classification
    const detectedFeatures = await detectAllFeaturesFromImage(
      mapboxUrl,
      perimeter,
      coordinates
    )
    console.log(`🔍 Detected: ${detectedFeatures.ridges.length} ridges, ${detectedFeatures.hips.length} hips, ${detectedFeatures.valleys.length} valleys, ${detectedFeatures.eaves.length} eaves, ${detectedFeatures.rakes.length} rakes`)

    // Use AI-traced perimeter if available (more accurate than OSM), otherwise fall back
    const effectivePerimeter = (detectedFeatures.aiTracedPerimeter && detectedFeatures.aiTracedPerimeter.length >= 4)
      ? detectedFeatures.aiTracedPerimeter
      : perimeter
    
    if (detectedFeatures.aiTracedPerimeter && detectedFeatures.aiTracedPerimeter.length >= 4) {
      console.log(`🏠 Using AI-traced perimeter (${effectivePerimeter.length} vertices) instead of footprint source (${perimeter.length} vertices)`)
    }

    // Step 5: Apply learned corrections from measurement_corrections table
    const correctedFeatures = await applyLearnedCorrections(
      supabase,
      detectedFeatures,
      effectivePerimeter,
      tenantId
    )

    // Step 6: PHASE 3 - Strict endpoint snapping with validation (interior lines only)
    const snappedFeatures = snapLinesToCorners(correctedFeatures, effectivePerimeter)

    // Step 6.5: PHASE 3 - Validate no floating lines
    const floatingValidation = validateNoFloatingLines(snappedFeatures, effectivePerimeter)
    if (!floatingValidation.valid) {
      console.warn(`⚠️ ${floatingValidation.floatingEndpoints.length} floating endpoint(s) detected - attempting retry`)
      const retryFeatures = await retryWithFeedback(mapboxUrl, floatingValidation.floatingEndpoints, effectivePerimeter, coordinates)
      if (retryFeatures) {
        snappedFeatures.ridges = mergeFeatures(snappedFeatures.ridges, retryFeatures.ridges)
        snappedFeatures.hips = mergeFeatures(snappedFeatures.hips, retryFeatures.hips)
        snappedFeatures.valleys = mergeFeatures(snappedFeatures.valleys, retryFeatures.valleys)
      }
    }

    // Step 7: PHASE 4 - Iterative visual alignment until 90%+ score
    let verifiedFeatures = snappedFeatures
    let alignmentScore = 0
    let attempts = 0

    while (alignmentScore < MIN_ALIGNMENT_SCORE && attempts < MAX_ALIGNMENT_ATTEMPTS) {
      const verification = await verifyVisualAlignment(
        mapboxUrl,
        verifiedFeatures,
        effectivePerimeter,
        coordinates
      )
      
      alignmentScore = calculateAlignmentScore(verification)
      console.log(`📊 Alignment attempt ${attempts + 1}: score = ${alignmentScore}%`)
      
      if (alignmentScore < MIN_ALIGNMENT_SCORE && attempts < MAX_ALIGNMENT_ATTEMPTS - 1) {
        verifiedFeatures = applyAlignmentAdjustments(verifiedFeatures, verification.adjustments)
      } else {
        verifiedFeatures = verification.features
      }
      attempts++
    }

    // Step 8: PHASE 5 - Build final output with eaves/rakes derived from perimeter
    // ═══════════════════════════════════════════════════════════════════════════
    // FOOTPRINT-DRIVEN EAVES/RAKES: Derive from effectivePerimeter edges
    // instead of using AI-traced classifications which miss kickouts
    // ═══════════════════════════════════════════════════════════════════════════
    const ridgeAzimuth = extractRidgeAzimuthFromLines(verifiedFeatures.ridges, coordinates);
    const footprintEavesRakes = deriveEavesRakesFromPerimeter(effectivePerimeter, ridgeAzimuth, coordinates);
    console.log(`🏠 Footprint-derived: ${footprintEavesRakes.eaves.length} eaves, ${footprintEavesRakes.rakes.length} rakes (ridge azimuth: ${ridgeAzimuth.toFixed(0)}°)`);
    
    const output: RoofOverlayOutput = {
      perimeter: effectivePerimeter,
      detectedPerimeter: detectedFeatures.aiTracedPerimeter && detectedFeatures.aiTracedPerimeter.length >= 4
        ? detectedFeatures.aiTracedPerimeter : undefined,
      ridges: verifiedFeatures.ridges.map(r => ({
        ...r,
        requiresReview: r.confidence < 80 || !r.snappedToTarget
      })),
      hips: verifiedFeatures.hips.map(h => ({
        ...h,
        requiresReview: h.confidence < 80 || !h.snappedToTarget
      })),
      valleys: verifiedFeatures.valleys.map(v => ({
        ...v,
        requiresReview: v.confidence < 80 || !v.snappedToTarget
      })),
      eaves: footprintEavesRakes.eaves,
      rakes: footprintEavesRakes.rakes,
      metadata: {
        roofType: analysisResult.data?.aiAnalysis?.roofType || 'complex',
        qualityScore: calculateQualityScore(verifiedFeatures),
        dataSourcesPriority: ['mapbox_satellite', 'ai_vision', 'footprint_derived'],
        requiresManualReview: checkIfRequiresReview(verifiedFeatures),
        totalAreaSqft: analysisResult.data?.measurements?.totalAreaSqft,
        processedAt: new Date().toISOString(),
        alignmentAttempts: attempts,
        perimeterSource: 'footprint_derived'
      }
    }

    const processingTimeMs = Date.now() - startTime
    console.log(`✅ Roof overlay generated in ${processingTimeMs}ms (${attempts} alignment attempts, score: ${alignmentScore}%)`)

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

// Fetch Mapbox satellite image URL - use zoom 19 for wider context to capture full roof
async function fetchMapboxSatellite(coordinates: { lat: number; lng: number }): Promise<string> {
  const { lat, lng } = coordinates
  // Use zoom 19 (wider view) so we capture full roof + surrounding context for better edge detection
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${DETAIL_ZOOM},0/${IMAGE_SIZE}x${IMAGE_SIZE}@2x?access_token=${MAPBOX_PUBLIC_TOKEN}`
}

// Call the existing analyze-roof-aerial function
async function callAnalyzeRoofAerial(
  supabase: any,
  address: string,
  coordinates: { lat: number; lng: number }
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('analyze-roof-aerial', {
      body: { address, coordinates }
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: data?.success || false, data: data?.data, error: data?.error }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Extract perimeter from analysis result in correct format [[lng, lat], ...]
function extractPerimeter(data: any): [number, number][] {
  if (!data) return []

  // Try to parse from perimeterWkt first
  if (data.perimeterWkt) {
    const coords = parseWKTPolygon(data.perimeterWkt)
    if (coords.length > 0) return coords
  }

  // Fallback to roofPerimeter vertices if available
  if (data.aiAnalysis?.roofPerimeter) {
    const vertices = data.aiAnalysis.roofPerimeter
    if (Array.isArray(vertices) && vertices.length > 0) {
      if (typeof vertices[0][0] === 'number') {
        return vertices as [number, number][]
      }
    }
  }

  return []
}

// Parse WKT POLYGON to coordinate array
function parseWKTPolygon(wkt: string): [number, number][] {
  if (!wkt) return []
  
  const match = wkt.match(/POLYGON\s*\(\(([^)]+)\)\)/i)
  if (!match) return []

  const coordsStr = match[1]
  const pairs = coordsStr.split(',').map(s => s.trim())
  
  return pairs.map(pair => {
    const [lngStr, latStr] = pair.split(/\s+/)
    return [parseFloat(lngStr), parseFloat(latStr)] as [number, number]
  }).filter(c => !isNaN(c[0]) && !isNaN(c[1]))
}

// PHASE 1: Enhanced AI Vision detection with shadow analysis and snapping rules
async function detectAllFeaturesFromImage(
  imageUrl: string,
  perimeter: [number, number][],
  coordinates: { lat: number; lng: number }
): Promise<{ ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[]; eaves: RoofLine[]; rakes: RoofLine[]; aiTracedPerimeter: [number, number][] }> {
  
  // Classify perimeter corners for better snapping hints
  const classifiedCorners = classifyPerimeterCorners(perimeter)
  const convexCorners = classifiedCorners.filter(c => c.type === 'convex')
  const reflexCorners = classifiedCorners.filter(c => c.type === 'reflex')
  
  console.log(`📐 Corner analysis: ${convexCorners.length} convex (hip targets), ${reflexCorners.length} reflex (valley origins)`)

  // ENHANCED PROMPT - v2: Focus on pixel-accurate perimeter tracing
  const prompt = `You are an expert satellite imagery analyst specializing in residential roof geometry extraction.

CRITICAL TASK: Trace the EXACT visible roof boundary and interior structural lines.

## STEP 1 - TRACE THE ROOF PERIMETER (MOST IMPORTANT)
Carefully trace the visible roof edge (drip-line/gutter line) as it appears in the satellite image.

CRITICAL RULES FOR PERIMETER:
- Roofs are almost NEVER perfect rectangles. Look VERY carefully for:
  * Front porch kickouts (a section of roof that extends forward)
  * Garage extensions (wider or narrower sections)
  * L-shaped, T-shaped, or U-shaped layouts
  * Setbacks where the roofline steps inward or outward
  * Bay windows or bump-outs
- Place a vertex at EVERY corner where the roof edge changes direction
- A simple rectangular roof = 4 vertices
- An L-shaped roof = 6 vertices minimum
- A T-shaped roof = 8 vertices minimum
- A complex roof with porches/extensions = 8-16 vertices
- Go CLOCKWISE starting from the top-left corner
- Use [x%, y%] coordinates where (0,0) = top-left, (100,100) = bottom-right of image

The footprint source suggests ${perimeter.length} corners but may be WRONG. Trust what you SEE in the image.
${convexCorners.length} convex corners, ${reflexCorners.length} reflex corners detected in footprint.

## STEP 2 - CLASSIFY EACH PERIMETER EDGE
For each consecutive pair of perimeter vertices, classify as:
- "eave": Edge parallel to or near-parallel to the main ridge (horizontal gutter line)
- "rake": Edge perpendicular to the ridge (sloped gable edge running uphill)

## STEP 3 - DETECT INTERIOR LINES
Look for these features in the satellite imagery:
1. RIDGES: Bright linear highlights at the very top/peak of the roof (usually the highest horizontal line)
2. HIPS: Diagonal lines running from a ridge endpoint DOWN to an outer corner
3. VALLEYS: Dark V-shaped shadow lines where two roof planes meet going INWARD (only in L/T/U shapes)

TOPOLOGY CONSTRAINTS:
- Every hip line starts at a ridge endpoint and ends at a perimeter corner
- Valleys ONLY exist at concave (inward-pointing) corners
- NO floating lines - every line endpoint connects to either a perimeter vertex or a ridge endpoint
- Every outer corner should have exactly one hip running to it

Return ONLY valid JSON (no markdown, no explanation):
{
  "tracedPerimeter": [
    {"x": 10, "y": 8, "description": "NW corner of main roof"},
    {"x": 75, "y": 8, "description": "NE corner of main roof"},
    {"x": 75, "y": 55, "description": "east wall setback"},
    {"x": 90, "y": 55, "description": "garage extension NE"},
    {"x": 90, "y": 92, "description": "SE corner garage"},
    {"x": 10, "y": 92, "description": "SW corner"}
  ],
  "perimeterEdges": [
    {"startIdx": 0, "endIdx": 1, "type": "eave", "description": "north eave"},
    {"startIdx": 1, "endIdx": 2, "type": "rake", "description": "east rake upper"},
    {"startIdx": 2, "endIdx": 3, "type": "eave", "description": "kickout eave"},
    {"startIdx": 3, "endIdx": 4, "type": "rake", "description": "garage east rake"},
    {"startIdx": 4, "endIdx": 5, "type": "eave", "description": "south eave"},
    {"startIdx": 5, "endIdx": 0, "type": "rake", "description": "west rake"}
  ],
  "ridges": [{"startX": 25, "startY": 45, "endX": 70, "endY": 45, "confidence": 92, "description": "main ridge peak highlight"}],
  "hips": [{"startX": 25, "startY": 45, "endX": 10, "endY": 8, "confidence": 88, "description": "NW hip diagonal shadow"}],
  "valleys": []
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
          { role: 'system', content: 'You are an expert at analyzing satellite roof imagery. You trace roof edges with pixel-level precision. You NEVER assume a roof is rectangular - you always look for the actual visible shape. Return only valid JSON, no markdown code blocks.' },
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
      console.error('AI vision detection failed:', response.status)
      return { ridges: [], hips: [], valleys: [], eaves: [], rakes: [], aiTracedPerimeter: [] }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('No JSON found in AI response')
      return { ridges: [], hips: [], valleys: [], eaves: [], rakes: [], aiTracedPerimeter: [] }
    }

    const parsed = JSON.parse(jsonMatch[0])
    
    // Convert pixel percentages to geo coordinates - use DETAIL_ZOOM since that's the image we send
    const toGeo = (x: number, y: number): [number, number] => {
      return pixelPctToGeo(x, y, coordinates, IMAGE_SIZE, DETAIL_ZOOM)
    }

    // Parse AI-traced perimeter (the actual visible roof drip-line)
    let aiTracedPerimeter: [number, number][] = []
    if (parsed.tracedPerimeter && Array.isArray(parsed.tracedPerimeter) && parsed.tracedPerimeter.length >= 3) {
      aiTracedPerimeter = parsed.tracedPerimeter.map((v: any) => toGeo(v.x, v.y))
      // Close the polygon
      if (aiTracedPerimeter.length >= 3) {
        const first = aiTracedPerimeter[0]
        const last = aiTracedPerimeter[aiTracedPerimeter.length - 1]
        if (Math.abs(first[0] - last[0]) > 0.000001 || Math.abs(first[1] - last[1]) > 0.000001) {
          aiTracedPerimeter.push([...first] as [number, number])
        }
      }
      console.log(`🏠 AI traced perimeter: ${aiTracedPerimeter.length} vertices (including kickouts/extensions)`)
    }

    // Parse eave and rake edges from perimeter classification
    const eaves: RoofLine[] = []
    const rakes: RoofLine[] = []
    if (parsed.perimeterEdges && Array.isArray(parsed.perimeterEdges) && aiTracedPerimeter.length >= 3) {
      const perimVerts = aiTracedPerimeter.slice(0, -1) // exclude closing vertex
      for (const edge of parsed.perimeterEdges) {
        const startIdx = edge.startIdx
        const endIdx = edge.endIdx
        if (startIdx >= 0 && startIdx < perimVerts.length && endIdx >= 0 && endIdx < perimVerts.length) {
          const line: RoofLine = {
            start: perimVerts[startIdx],
            end: perimVerts[endIdx],
            confidence: 85,
            requiresReview: false,
            source: 'ai_vision_perimeter',
            visualEvidence: edge.description || undefined,
            snappedToTarget: true // these ARE the perimeter
          }
          if (edge.type === 'eave') {
            eaves.push(line)
          } else if (edge.type === 'rake') {
            rakes.push(line)
          }
        }
      }
      console.log(`📏 AI classified edges: ${eaves.length} eaves, ${rakes.length} rakes`)
    }

    const ridges: RoofLine[] = (parsed.ridges || []).map((r: DetectedFeature) => ({
      start: toGeo(r.startX, r.startY),
      end: toGeo(r.endX, r.endY),
      confidence: r.confidence || 80,
      requiresReview: (r.confidence || 80) < 75,
      source: 'ai_vision',
      visualEvidence: r.description || undefined,
      snappedToTarget: false // Will be set after snapping
    }))

    const hips: RoofLine[] = (parsed.hips || []).map((h: DetectedFeature) => ({
      start: toGeo(h.startX, h.startY),
      end: toGeo(h.endX, h.endY),
      confidence: h.confidence || 80,
      requiresReview: (h.confidence || 80) < 75,
      source: 'ai_vision',
      visualEvidence: h.description || undefined,
      snappedToTarget: false
    }))

    const valleys: RoofLine[] = (parsed.valleys || []).map((v: DetectedFeature) => ({
      start: toGeo(v.startX, v.startY),
      end: toGeo(v.endX, v.endY),
      confidence: v.confidence || 80,
      requiresReview: (v.confidence || 80) < 75,
      source: 'ai_vision',
      visualEvidence: v.description || undefined,
      snappedToTarget: false
    }))

    return { ridges, hips, valleys, eaves, rakes, aiTracedPerimeter }

  } catch (error) {
    console.error('AI vision detection error:', error)
    return { ridges: [], hips: [], valleys: [], eaves: [], rakes: [], aiTracedPerimeter: [] }
  }
}

// Convert pixel percentage to geo coordinates
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

// Classify perimeter corners as convex (hip endpoints) or reflex (valley origins)
function classifyPerimeterCorners(perimeter: [number, number][]): ClassifiedCorner[] {
  if (perimeter.length < 3) return []
  
  const corners: ClassifiedCorner[] = []
  
  for (let i = 0; i < perimeter.length; i++) {
    const prev = perimeter[(i - 1 + perimeter.length) % perimeter.length]
    const curr = perimeter[i]
    const next = perimeter[(i + 1) % perimeter.length]
    
    // Calculate vectors
    const v1x = curr[0] - prev[0]
    const v1y = curr[1] - prev[1]
    const v2x = next[0] - curr[0]
    const v2y = next[1] - curr[1]
    
    // Cross product to determine turn direction
    const cross = v1x * v2y - v1y * v2x
    
    // Calculate angle in degrees
    const dot = v1x * v2x + v1y * v2y
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y)
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * 180 / Math.PI
    
    // For a polygon traced clockwise:
    // cross > 0 = left turn = convex (outward corner)
    // cross < 0 = right turn = reflex (inward corner)
    // For counter-clockwise, it's the opposite
    // We determine winding based on polygon area sign
    const polygonArea = calculatePolygonArea(perimeter)
    const isClockwise = polygonArea < 0
    
    let type: 'convex' | 'reflex'
    if (isClockwise) {
      type = cross > 0 ? 'convex' : 'reflex'
    } else {
      type = cross < 0 ? 'convex' : 'reflex'
    }
    
    corners.push({
      coord: curr,
      type,
      angle,
      index: i
    })
  }
  
  return corners
}

// Calculate signed polygon area (negative = clockwise, positive = counter-clockwise)
function calculatePolygonArea(perimeter: [number, number][]): number {
  let area = 0
  for (let i = 0; i < perimeter.length; i++) {
    const j = (i + 1) % perimeter.length
    area += perimeter[i][0] * perimeter[j][1]
    area -= perimeter[j][0] * perimeter[i][1]
  }
  return area / 2
}

// Apply learned corrections from database
async function applyLearnedCorrections(
  supabase: any,
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[]; [key: string]: any },
  perimeter: [number, number][],
  tenantId?: string
): Promise<{ ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[]; [key: string]: any }> {
  
  if (!tenantId) return features

  try {
    // Get learned correction patterns
    const { data: corrections } = await supabase
      .from('measurement_corrections')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!corrections || corrections.length === 0) return features

    // Calculate average correction factors by line type
    const ridgeCorrections = corrections.filter((c: any) => c.line_type === 'ridge')
    const hipCorrections = corrections.filter((c: any) => c.line_type === 'hip')
    const valleyCorrections = corrections.filter((c: any) => c.line_type === 'valley')

    // Apply average shift patterns to each line type
    const applyCorrection = (line: RoofLine, correctionSet: any[]): RoofLine => {
      if (correctionSet.length === 0) return line

      // Calculate average shift
      const avgShiftLng = correctionSet.reduce((sum, c) => sum + (c.shift_lng || 0), 0) / correctionSet.length
      const avgShiftLat = correctionSet.reduce((sum, c) => sum + (c.shift_lat || 0), 0) / correctionSet.length

      return {
        ...line,
        start: [line.start[0] + avgShiftLng, line.start[1] + avgShiftLat],
        end: [line.end[0] + avgShiftLng, line.end[1] + avgShiftLat],
        source: 'ai_vision_corrected'
      }
    }

    return {
      ...features,
      ridges: features.ridges.map(r => applyCorrection(r, ridgeCorrections)),
      hips: features.hips.map(h => applyCorrection(h, hipCorrections)),
      valleys: features.valleys.map(v => applyCorrection(v, valleyCorrections))
    }

  } catch (error) {
    console.warn('Failed to apply learned corrections:', error)
    return features
  }
}

// PHASE 3: Snap all line endpoints to nearest corners or intersections with validation
function snapLinesToCorners(
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[]; eaves?: RoofLine[]; rakes?: RoofLine[]; [key: string]: any },
  perimeter: [number, number][]
): { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[]; eaves: RoofLine[]; rakes: RoofLine[]; [key: string]: any } {
  
  const snapThresholdDeg = SNAP_THRESHOLD_FT * FT_TO_DEG

  // Collect all potential snap targets: perimeter corners + ridge endpoints
  const snapTargets: [number, number][] = [...perimeter]
  
  // Add ridge endpoints as snap targets for hips
  features.ridges.forEach(r => {
    snapTargets.push(r.start)
    snapTargets.push(r.end)
  })

  const snapPoint = (point: [number, number]): { snapped: [number, number]; wasSnapped: boolean } => {
    let nearest = point
    let minDist = Infinity
    let wasSnapped = false

    for (const target of snapTargets) {
      const dist = Math.sqrt(
        Math.pow(point[0] - target[0], 2) + 
        Math.pow(point[1] - target[1], 2)
      )
      if (dist < minDist && dist < snapThresholdDeg) {
        minDist = dist
        nearest = target
        wasSnapped = true
      }
    }

    return { snapped: nearest, wasSnapped }
  }

  const snapLine = (line: RoofLine): RoofLine => {
    const startSnap = snapPoint(line.start)
    const endSnap = snapPoint(line.end)
    
    return {
      ...line,
      start: startSnap.snapped,
      end: endSnap.snapped,
      snappedToTarget: startSnap.wasSnapped && endSnap.wasSnapped
    }
  }

  // Snap ridges first (they're the anchor points)
  const snappedRidges = features.ridges.map(snapLine)
  
  // Update snap targets with snapped ridge endpoints
  snappedRidges.forEach(r => {
    snapTargets.push(r.start)
    snapTargets.push(r.end)
  })

  // Snap hips (should connect to ridge ends or perimeter corners)
  const snappedHips = features.hips.map(snapLine)
  
  // Add hip endpoints for valley snapping
  snappedHips.forEach(h => {
    snapTargets.push(h.start)
    snapTargets.push(h.end)
  })
  
  // Snap valleys (should connect to reflex vertices or ridge junctions)
  const snappedValleys = features.valleys.map(snapLine)

  return {
    ...features,
    ridges: snappedRidges,
    hips: snappedHips,
    valleys: snappedValleys,
    eaves: features.eaves || [],
    rakes: features.rakes || [],
  }
}

// PHASE 3: Validate no floating lines - all endpoints must connect
function validateNoFloatingLines(
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] },
  perimeter: [number, number][]
): { valid: boolean; floatingEndpoints: [number, number][] } {
  const floatingEndpoints: [number, number][] = []
  const tolerance = SNAP_THRESHOLD_FT * FT_TO_DEG * 1.5 // Slightly larger for validation

  // Collect all valid connection targets
  const validTargets: [number, number][] = [...perimeter]
  
  // Ridge endpoints are valid targets
  features.ridges.forEach(r => {
    validTargets.push(r.start)
    validTargets.push(r.end)
  })
  
  // Hip endpoints are valid targets
  features.hips.forEach(h => {
    validTargets.push(h.start)
    validTargets.push(h.end)
  })

  const isConnected = (point: [number, number]): boolean => {
    return validTargets.some(target => {
      const dist = Math.sqrt(
        Math.pow(point[0] - target[0], 2) + 
        Math.pow(point[1] - target[1], 2)
      )
      return dist < tolerance
    })
  }

  // Check all hip endpoints (they MUST connect to ridge or perimeter)
  features.hips.forEach(h => {
    if (!isConnected(h.start)) floatingEndpoints.push(h.start)
    if (!isConnected(h.end)) floatingEndpoints.push(h.end)
  })

  // Check all valley endpoints
  features.valleys.forEach(v => {
    if (!isConnected(v.start)) floatingEndpoints.push(v.start)
    if (!isConnected(v.end)) floatingEndpoints.push(v.end)
  })

  return {
    valid: floatingEndpoints.length === 0,
    floatingEndpoints
  }
}

// PHASE 3: Retry detection with feedback about floating lines
async function retryWithFeedback(
  imageUrl: string,
  floatingEndpoints: [number, number][],
  perimeter: [number, number][],
  coordinates: { lat: number; lng: number }
): Promise<{ ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] } | null> {
  
  if (floatingEndpoints.length === 0) return null

  const feedbackPrompt = `Previous detection had ${floatingEndpoints.length} floating endpoint(s) that don't connect to any corner or intersection.

CRITICAL: Every line endpoint MUST touch either:
1. A perimeter corner
2. Another roof line endpoint (ridge, hip, or valley)

Re-analyze the roof and ensure ALL lines connect properly. Hips should run from ridge endpoints to perimeter corners.

Return corrected features in the same JSON format as before.`

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are correcting roof overlay lines. All endpoints must connect to corners or other lines.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: feedbackPrompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 2000
      })
    })

    if (!response.ok) {
      console.warn('Retry with feedback failed')
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    
    const toGeo = (x: number, y: number): [number, number] => {
      return pixelPctToGeo(x, y, coordinates, IMAGE_SIZE, IMAGE_ZOOM)
    }

    return {
      ridges: (parsed.ridges || []).map((r: any) => ({
        start: toGeo(r.startX, r.startY),
        end: toGeo(r.endX, r.endY),
        confidence: r.confidence || 75,
        requiresReview: true,
        source: 'ai_vision_retry',
        snappedToTarget: false
      })),
      hips: (parsed.hips || []).map((h: any) => ({
        start: toGeo(h.startX, h.startY),
        end: toGeo(h.endX, h.endY),
        confidence: h.confidence || 75,
        requiresReview: true,
        source: 'ai_vision_retry',
        snappedToTarget: false
      })),
      valleys: (parsed.valleys || []).map((v: any) => ({
        start: toGeo(v.startX, v.startY),
        end: toGeo(v.endX, v.endY),
        confidence: v.confidence || 75,
        requiresReview: true,
        source: 'ai_vision_retry',
        snappedToTarget: false
      }))
    }

  } catch (error) {
    console.warn('Retry with feedback error:', error)
    return null
  }
}

// Merge retry features with originals
function mergeFeatures(original: RoofLine[], retry: RoofLine[]): RoofLine[] {
  // Simple strategy: use retry features if they have better snapping
  if (retry.length === 0) return original
  
  // Prefer features that are properly snapped
  const merged = [...original]
  for (const retryLine of retry) {
    // Check if this is a better version of an existing line
    const existingIdx = merged.findIndex(o => 
      linesOverlap(o, retryLine)
    )
    
    if (existingIdx >= 0 && retryLine.snappedToTarget) {
      merged[existingIdx] = retryLine
    } else if (existingIdx < 0) {
      merged.push(retryLine)
    }
  }
  
  return merged
}

// Check if two lines overlap significantly
function linesOverlap(a: RoofLine, b: RoofLine): boolean {
  const tolerance = SNAP_THRESHOLD_FT * FT_TO_DEG * 2
  
  const startClose = Math.sqrt(
    Math.pow(a.start[0] - b.start[0], 2) + 
    Math.pow(a.start[1] - b.start[1], 2)
  ) < tolerance
  
  const endClose = Math.sqrt(
    Math.pow(a.end[0] - b.end[0], 2) + 
    Math.pow(a.end[1] - b.end[1], 2)
  ) < tolerance
  
  return startClose && endClose
}

// PHASE 4: Visual alignment verification with adjustment suggestions
async function verifyVisualAlignment(
  imageUrl: string,
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] },
  perimeter: [number, number][],
  coordinates: { lat: number; lng: number }
): Promise<{ 
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] };
  adjustments: any[];
}> {
  
  // Skip verification if no features to verify
  if (features.ridges.length === 0 && features.hips.length === 0 && features.valleys.length === 0) {
    return { features, adjustments: [] }
  }

  const prompt = `You are verifying the alignment of roof overlay lines against the satellite image.

For each line listed below, score how well it aligns with the ACTUAL visible roof feature (0-100):
- 100 = Perfect alignment on the visible edge
- 90-99 = Excellent, minimal offset (<1ft)
- 75-89 = Good alignment, minor offset (1-2ft)
- 50-74 = Needs adjustment, visible misalignment (2-5ft)
- Below 50 = Significantly misaligned (>5ft)

Also suggest which direction to shift misaligned lines:
- "shift_up", "shift_down", "shift_left", "shift_right"
- Include estimated shift distance in feet

Lines to verify:
${JSON.stringify({ ridges: features.ridges.length, hips: features.hips.length, valleys: features.valleys.length })}

Return JSON with alignment scores:
{
  "ridges": [{"index": 0, "alignmentScore": 92, "offsetFt": 1.0, "aligned": true}],
  "hips": [{"index": 0, "alignmentScore": 85, "offsetFt": 2.0, "aligned": true, "shiftDirection": "shift_left"}],
  "valleys": [{"index": 0, "alignmentScore": 70, "offsetFt": 4.0, "aligned": false, "shiftDirection": "shift_up", "shiftFt": 3}],
  "overallScore": 85
}`

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are verifying roof overlay accuracy. Return only valid JSON with alignment scores.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 1500
      })
    })

    if (!response.ok) {
      console.warn('Alignment verification failed, returning unverified features')
      return { features, adjustments: [] }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { features, adjustments: [] }

    const verification = JSON.parse(jsonMatch[0])

    // Apply verification results
    const applyVerification = (lines: RoofLine[], verifications: any[]): RoofLine[] => {
      return lines.map((line, idx) => {
        const v = verifications?.find((vf: any) => vf.index === idx)
        if (v) {
          return {
            ...line,
            confidence: v.alignmentScore,
            requiresReview: !v.aligned || v.alignmentScore < 75
          }
        }
        return line
      })
    }

    // Collect adjustments for next iteration
    const adjustments: any[] = []
    for (const type of ['ridges', 'hips', 'valleys']) {
      const typeVerifications = verification[type] || []
      for (const v of typeVerifications) {
        if (v.shiftDirection && v.shiftFt) {
          adjustments.push({
            type,
            index: v.index,
            direction: v.shiftDirection,
            distanceFt: v.shiftFt
          })
        }
      }
    }

    return {
      features: {
        ridges: applyVerification(features.ridges, verification.ridges || []),
        hips: applyVerification(features.hips, verification.hips || []),
        valleys: applyVerification(features.valleys, verification.valleys || [])
      },
      adjustments
    }

  } catch (error) {
    console.warn('Alignment verification error:', error)
    return { features, adjustments: [] }
  }
}

// PHASE 4: Calculate overall alignment score
function calculateAlignmentScore(verification: { 
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] };
  adjustments: any[];
}): number {
  const allLines = [
    ...verification.features.ridges,
    ...verification.features.hips,
    ...verification.features.valleys
  ]
  
  if (allLines.length === 0) return 50
  
  return Math.round(
    allLines.reduce((sum, l) => sum + l.confidence, 0) / allLines.length
  )
}

// PHASE 4: Apply alignment adjustments for next iteration
function applyAlignmentAdjustments(
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] },
  adjustments: any[]
): { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] } {
  
  if (adjustments.length === 0) return features

  const applyShift = (line: RoofLine, direction: string, distanceFt: number): RoofLine => {
    const shiftDeg = distanceFt * FT_TO_DEG
    let dLng = 0, dLat = 0
    
    switch (direction) {
      case 'shift_up':
        dLat = shiftDeg
        break
      case 'shift_down':
        dLat = -shiftDeg
        break
      case 'shift_left':
        dLng = -shiftDeg
        break
      case 'shift_right':
        dLng = shiftDeg
        break
    }
    
    return {
      ...line,
      start: [line.start[0] + dLng, line.start[1] + dLat],
      end: [line.end[0] + dLng, line.end[1] + dLat]
    }
  }

  const adjustedFeatures = {
    ridges: [...features.ridges],
    hips: [...features.hips],
    valleys: [...features.valleys]
  }

  for (const adj of adjustments) {
    const typeKey = adj.type as 'ridges' | 'hips' | 'valleys'
    if (adjustedFeatures[typeKey][adj.index]) {
      adjustedFeatures[typeKey][adj.index] = applyShift(
        adjustedFeatures[typeKey][adj.index],
        adj.direction,
        adj.distanceFt
      )
    }
  }

  return adjustedFeatures
}

// Calculate overall quality score
function calculateQualityScore(features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] }): number {
  const allLines = [...features.ridges, ...features.hips, ...features.valleys]
  
  if (allLines.length === 0) return 50

  const avgConfidence = allLines.reduce((sum, l) => sum + l.confidence, 0) / allLines.length
  const reviewCount = allLines.filter(l => l.requiresReview).length
  const reviewPenalty = (reviewCount / allLines.length) * 20
  
  // Bonus for properly snapped lines
  const snappedCount = allLines.filter(l => l.snappedToTarget).length
  const snappedBonus = (snappedCount / allLines.length) * 10

  return Math.round(Math.max(0, Math.min(100, avgConfidence - reviewPenalty + snappedBonus)))
}

// Check if manual review is needed
function checkIfRequiresReview(features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] }): boolean {
  const allLines = [...features.ridges, ...features.hips, ...features.valleys]
  
  // Review needed if any line is flagged
  if (allLines.some(l => l.requiresReview)) return true
  
  // Review needed if too few features detected for a normal roof
  if (features.ridges.length === 0) return true
  
  // Review needed if any line not properly snapped
  if (allLines.some(l => !l.snappedToTarget)) return true
  
  // Review needed if average confidence is below threshold
  const avgConfidence = allLines.reduce((sum, l) => sum + l.confidence, 0) / Math.max(1, allLines.length)
  if (avgConfidence < 70) return true

  return false
}

// ═══════════════════════════════════════════════════════════════════════════
// 🏠 FOOTPRINT-DRIVEN EAVE/RAKE DERIVATION for overlay engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract ridge azimuth from detected ridge lines.
 */
function extractRidgeAzimuthFromLines(
  ridges: RoofLine[],
  coordinates: { lat: number; lng: number }
): number {
  if (ridges.length === 0) return 90; // Default E-W ridge
  
  // Use longest ridge
  let longest = ridges[0];
  let maxLen = 0;
  for (const r of ridges) {
    const dx = r.end[0] - r.start[0];
    const dy = r.end[1] - r.start[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > maxLen) { maxLen = len; longest = r; }
  }
  
  const dLng = longest.end[0] - longest.start[0];
  const dLat = longest.end[1] - longest.start[1];
  const metersPerDegLng = 111320 * Math.cos(coordinates.lat * Math.PI / 180);
  const metersPerDegLat = 111320;
  
  let bearing = Math.atan2(dLng * metersPerDegLng, dLat * metersPerDegLat) * 180 / Math.PI;
  if (bearing < 0) bearing += 360;
  if (bearing >= 180) bearing -= 180;
  return bearing;
}

/**
 * Derive eaves and rakes from perimeter polygon edges using ridge azimuth.
 */
function deriveEavesRakesFromPerimeter(
  perimeter: [number, number][],
  ridgeAzimuth: number,
  coordinates: { lat: number; lng: number }
): { eaves: RoofLine[]; rakes: RoofLine[] } {
  const eaves: RoofLine[] = [];
  const rakes: RoofLine[] = [];
  const n = perimeter.length;
  if (n < 3) return { eaves, rakes };
  
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(coordinates.lat * Math.PI / 180);
  
  // Skip closing vertex if polygon is closed
  const lastIdx = (perimeter[0][0] === perimeter[n - 1][0] && perimeter[0][1] === perimeter[n - 1][1])
    ? n - 1 : n;
  
  for (let i = 0; i < lastIdx; i++) {
    const v1 = perimeter[i];
    const v2 = perimeter[(i + 1) % n];
    
    const dLng = v2[0] - v1[0];
    const dLat = v2[1] - v1[1];
    
    let edgeBearing = Math.atan2(dLng * metersPerDegLng, dLat * metersPerDegLat) * 180 / Math.PI;
    if (edgeBearing < 0) edgeBearing += 360;
    if (edgeBearing >= 180) edgeBearing -= 180;
    
    let angleDiff = Math.abs(edgeBearing - ridgeAzimuth);
    if (angleDiff > 90) angleDiff = 180 - angleDiff;
    
    const isEave = angleDiff > 60;
    
    const dx = dLng * metersPerDegLng;
    const dy = dLat * metersPerDegLat;
    const lengthFt = Math.sqrt(dx * dx + dy * dy) * 3.28084;
    
    if (lengthFt < 1) continue;
    
    const line: RoofLine = {
      start: v1,
      end: v2,
      confidence: 90,
      requiresReview: false,
      source: 'footprint_derived',
      snappedToTarget: true
    };
    
    if (isEave) {
      eaves.push(line);
    } else {
      rakes.push(line);
    }
  }
  
  return { eaves, rakes };
}
