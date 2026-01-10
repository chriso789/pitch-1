// Unified Roof Overlay Generator - Returns exact JSON format for AI Overlay Objective
// Single endpoint that orchestrates full analysis and returns precise roof topology

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
  metadata: {
    roofType: string;
    qualityScore: number;
    dataSourcesPriority: string[];
    requiresManualReview: boolean;
    totalAreaSqft?: number;
    processedAt: string;
  };
}

interface RoofLine {
  start: [number, number]; // [lng, lat]
  end: [number, number];   // [lng, lat]
  confidence: number;
  requiresReview: boolean;
  source?: string;
}

interface VisualAlignmentResult {
  line: RoofLine;
  aligned: boolean;
  offsetFt: number;
  adjustedLine?: RoofLine;
}

const IMAGE_ZOOM = 20
const IMAGE_SIZE = 640

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

    // Step 4: AI Vision Detection for Ridges, Hips, Valleys with shadows
    const detectedFeatures = await detectAllFeaturesFromImage(
      mapboxUrl,
      perimeter,
      coordinates
    )
    console.log(`🔍 Detected: ${detectedFeatures.ridges.length} ridges, ${detectedFeatures.hips.length} hips, ${detectedFeatures.valleys.length} valleys`)

    // Step 5: Apply learned corrections from measurement_corrections table
    const correctedFeatures = await applyLearnedCorrections(
      supabase,
      detectedFeatures,
      perimeter,
      tenantId
    )

    // Step 6: Snap all endpoints to corners/intersections
    const snappedFeatures = snapLinesToCorners(correctedFeatures, perimeter)

    // Step 7: Visual alignment verification pass
    const verifiedFeatures = await verifyVisualAlignment(
      mapboxUrl,
      snappedFeatures,
      perimeter,
      coordinates
    )

    // Step 8: Build final output
    const output: RoofOverlayOutput = {
      perimeter,
      ridges: verifiedFeatures.ridges,
      hips: verifiedFeatures.hips,
      valleys: verifiedFeatures.valleys,
      metadata: {
        roofType: analysisResult.data?.aiAnalysis?.roofType || 'complex',
        qualityScore: calculateQualityScore(verifiedFeatures),
        dataSourcesPriority: ['mapbox_satellite', 'ai_vision', 'geometry_derived'],
        requiresManualReview: checkIfRequiresReview(verifiedFeatures),
        totalAreaSqft: analysisResult.data?.measurements?.totalAreaSqft,
        processedAt: new Date().toISOString()
      }
    }

    const processingTimeMs = Date.now() - startTime
    console.log(`✅ Roof overlay generated in ${processingTimeMs}ms`)

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

// Fetch Mapbox satellite image URL
async function fetchMapboxSatellite(coordinates: { lat: number; lng: number }): Promise<string> {
  const { lat, lng } = coordinates
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${IMAGE_ZOOM},0/${IMAGE_SIZE}x${IMAGE_SIZE}@2x?access_token=${MAPBOX_PUBLIC_TOKEN}`
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
      // If vertices are already geo coords
      if (typeof vertices[0][0] === 'number') {
        return vertices as [number, number][]
      }
      // If vertices are pixel percentage objects, need coordinates to convert
      // This would require the center coordinates - handled elsewhere
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

// AI Vision detection for ridges, hips, and valleys
async function detectAllFeaturesFromImage(
  imageUrl: string,
  perimeter: [number, number][],
  coordinates: { lat: number; lng: number }
): Promise<{ ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] }> {
  
  const prompt = `You are a roof measurement expert analyzing a satellite image. 
Identify ALL roof features and provide their coordinates as percentages of the image (0-100%).

DETECTION RULES:
1. RIDGES: The highest lines where two roof planes meet at the top
   - Look for: bright linear highlights at roof peaks
   - Usually run horizontally or along the longest building axis
   
2. HIPS: Diagonal lines from ridge endpoints down to building corners
   - Look for: double-shadow edges (light on both sides of the line)
   - Connect ridge ends diagonally down to eave corners
   
3. VALLEYS: Internal troughs where two roof planes slope inward
   - Look for: darker linear shadows forming V-shapes
   - Water flows DOWN valleys toward eaves
   - Common in L-shaped, T-shaped, or complex roofs

For each feature, provide:
- startX, startY, endX, endY (as percentages 0-100)
- confidence (0-100)
- description of what you see

Return ONLY valid JSON in this exact format:
{
  "ridges": [{"startX": 25, "startY": 45, "endX": 75, "endY": 45, "confidence": 92, "description": "Main ridge visible as bright line"}],
  "hips": [{"startX": 25, "startY": 45, "endX": 10, "endY": 80, "confidence": 88, "description": "Hip from ridge to corner"}],
  "valleys": [{"startX": 50, "startY": 30, "endX": 50, "endY": 55, "confidence": 85, "description": "Valley at L-junction"}]
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
          { role: 'system', content: 'You are an expert at analyzing satellite roof imagery. Return only valid JSON.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 2000
      })
    })

    if (!response.ok) {
      console.error('AI vision detection failed:', response.status)
      return { ridges: [], hips: [], valleys: [] }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('No JSON found in AI response')
      return { ridges: [], hips: [], valleys: [] }
    }

    const parsed = JSON.parse(jsonMatch[0])
    
    // Convert pixel percentages to geo coordinates
    const toGeo = (x: number, y: number): [number, number] => {
      return pixelPctToGeo(x, y, coordinates, IMAGE_SIZE, IMAGE_ZOOM)
    }

    const ridges: RoofLine[] = (parsed.ridges || []).map((r: any) => ({
      start: toGeo(r.startX, r.startY),
      end: toGeo(r.endX, r.endY),
      confidence: r.confidence || 80,
      requiresReview: (r.confidence || 80) < 75,
      source: 'ai_vision'
    }))

    const hips: RoofLine[] = (parsed.hips || []).map((h: any) => ({
      start: toGeo(h.startX, h.startY),
      end: toGeo(h.endX, h.endY),
      confidence: h.confidence || 80,
      requiresReview: (h.confidence || 80) < 75,
      source: 'ai_vision'
    }))

    const valleys: RoofLine[] = (parsed.valleys || []).map((v: any) => ({
      start: toGeo(v.startX, v.startY),
      end: toGeo(v.endX, v.endY),
      confidence: v.confidence || 80,
      requiresReview: (v.confidence || 80) < 75,
      source: 'ai_vision'
    }))

    return { ridges, hips, valleys }

  } catch (error) {
    console.error('AI vision detection error:', error)
    return { ridges: [], hips: [], valleys: [] }
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

// Apply learned corrections from database
async function applyLearnedCorrections(
  supabase: any,
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] },
  perimeter: [number, number][],
  tenantId?: string
): Promise<{ ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] }> {
  
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
      ridges: features.ridges.map(r => applyCorrection(r, ridgeCorrections)),
      hips: features.hips.map(h => applyCorrection(h, hipCorrections)),
      valleys: features.valleys.map(v => applyCorrection(v, valleyCorrections))
    }

  } catch (error) {
    console.warn('Failed to apply learned corrections:', error)
    return features
  }
}

// Snap all line endpoints to nearest corners or intersections
function snapLinesToCorners(
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] },
  perimeter: [number, number][]
): { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] } {
  
  const SNAP_THRESHOLD_FT = 3 // 3 feet max snap distance
  const FT_TO_DEG = 1 / 364000 // Approximate feet to degrees at US latitudes
  const snapThresholdDeg = SNAP_THRESHOLD_FT * FT_TO_DEG

  // Collect all potential snap targets: perimeter corners + ridge endpoints
  const snapTargets: [number, number][] = [...perimeter]
  
  // Add ridge endpoints as snap targets for hips
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
    end: snapPoint(line.end)
  })

  // Snap ridges first (they're the anchor points)
  const snappedRidges = features.ridges.map(snapLine)
  
  // Update snap targets with snapped ridge endpoints
  snappedRidges.forEach(r => {
    snapTargets.push(r.start)
    snapTargets.push(r.end)
  })

  // Snap hips (should connect to ridge ends or perimeter corners)
  const snappedHips = features.hips.map(snapLine)
  
  // Snap valleys (should connect to reflex vertices or ridge junctions)
  const snappedValleys = features.valleys.map(snapLine)

  return {
    ridges: snappedRidges,
    hips: snappedHips,
    valleys: snappedValleys
  }
}

// Visual alignment verification using AI
async function verifyVisualAlignment(
  imageUrl: string,
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] },
  perimeter: [number, number][],
  coordinates: { lat: number; lng: number }
): Promise<{ ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] }> {
  
  // Skip verification if no features to verify
  if (features.ridges.length === 0 && features.hips.length === 0 && features.valleys.length === 0) {
    return features
  }

  const prompt = `You are verifying the alignment of roof overlay lines against the satellite image.

For each line listed below, score how well it aligns with the ACTUAL visible roof feature (0-100):
- 100 = Perfect alignment on the visible edge
- 75-99 = Good alignment, minor offset
- 50-74 = Needs adjustment, visible misalignment
- Below 50 = Significantly misaligned

Lines to verify:
${JSON.stringify({ ridges: features.ridges, hips: features.hips, valleys: features.valleys }, null, 2)}

Return JSON with alignment scores for each line:
{
  "ridges": [{"index": 0, "alignmentScore": 92, "offsetEstimateFt": 1.5, "aligned": true}],
  "hips": [{"index": 0, "alignmentScore": 85, "offsetEstimateFt": 2.0, "aligned": true}],
  "valleys": [{"index": 0, "alignmentScore": 70, "offsetEstimateFt": 4.0, "aligned": false}]
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
          { role: 'system', content: 'You are verifying roof overlay accuracy. Return only valid JSON.' },
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
      return features
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return features

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

    return {
      ridges: applyVerification(features.ridges, verification.ridges || []),
      hips: applyVerification(features.hips, verification.hips || []),
      valleys: applyVerification(features.valleys, verification.valleys || [])
    }

  } catch (error) {
    console.warn('Alignment verification error:', error)
    return features
  }
}

// Calculate overall quality score
function calculateQualityScore(features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] }): number {
  const allLines = [...features.ridges, ...features.hips, ...features.valleys]
  
  if (allLines.length === 0) return 50

  const avgConfidence = allLines.reduce((sum, l) => sum + l.confidence, 0) / allLines.length
  const reviewCount = allLines.filter(l => l.requiresReview).length
  const reviewPenalty = (reviewCount / allLines.length) * 20

  return Math.round(Math.max(0, Math.min(100, avgConfidence - reviewPenalty)))
}

// Check if manual review is needed
function checkIfRequiresReview(features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] }): boolean {
  const allLines = [...features.ridges, ...features.hips, ...features.valleys]
  
  // Review needed if any line is flagged
  if (allLines.some(l => l.requiresReview)) return true
  
  // Review needed if too few features detected for a normal roof
  if (features.ridges.length === 0) return true
  
  // Review needed if average confidence is below threshold
  const avgConfidence = allLines.reduce((sum, l) => sum + l.confidence, 0) / Math.max(1, allLines.length)
  if (avgConfidence < 70) return true

  return false
}
