// Generates v28-style roof line overlays from Mapbox aerial imagery.
// Uses Lovable AI (google/gemini-2.5-pro) to detect ridge/hip/valley/eave/rake lines,
// stores PNG + JSON line list in roof_line_overlays for training and UI display.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!
const MAPBOX_TOKEN = Deno.env.get('MAPBOX_ACCESS_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const IMG_W = 1024
const IMG_H = 1024
const STATIC_SCALE = 2
const DETECTION_IMG_W = IMG_W * STATIC_SCALE
const DETECTION_IMG_H = IMG_H * STATIC_SCALE
// Zoom 21 + tight Mapbox tile gives us the target house filling most of the frame.
// Earlier zoom 20 was pulling in 4-6 neighboring houses, which is what caused the
// AI to hallucinate ridges/eaves across multiple parcels.
const ZOOM = 21

interface DetectedLine {
  id: string
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake'
  p1: [number, number]
  p2: [number, number]
  confidence: number
  length_px?: number
  length_ft?: number
}

function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
}

function pxLength(p1: [number, number], p2: [number, number]): number {
  const dx = p2[0] - p1[0]
  const dy = p2[1] - p1[1]
  return Math.sqrt(dx * dx + dy * dy)
}

function buildMapboxUrl(lat: number, lng: number): string {
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${ZOOM},0/${IMG_W}x${IMG_H}@${STATIC_SCALE}x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`
}

const DETECT_PROMPT = `You are an expert roof-line annotator looking at a tightly-cropped aerial satellite image of a SINGLE residential property.

Output ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "lines": [
    { "type": "ridge"|"hip"|"valley"|"eave"|"rake", "p1": [x,y], "p2": [x,y], "confidence": 0.0-1.0 }
  ]
}

Coordinate system: pixel coordinates in a ${DETECTION_IMG_W}x${DETECTION_IMG_H} image, origin top-left, x right, y down.

CRITICAL TARGETING — READ CAREFULLY:
- The image has been cropped and zoomed so the TARGET HOUSE is the dominant roof in the frame.
- Annotate ONLY the single roof whose footprint covers the image center [${DETECTION_IMG_W / 2}, ${DETECTION_IMG_H / 2}].
- DO NOT annotate any neighboring houses, even if part of them is visible at the edge of the frame.
- DO NOT draw a line unless BOTH endpoints sit on a visible roof edge of the TARGET house. If you can't see the edge clearly (tree, shadow, low contrast), OMIT the line entirely.
- DO NOT connect endpoints across gaps, driveways, lawns, or pools. Every line must lie ON the roof surface.
- If the target roof is unclear, return fewer lines (5-10) rather than guessing.

Definitions (be strict):
- ridge: top horizontal seam where two upward-sloping planes meet (highest line on the roof)
- hip: sloped seam from a ridge end down to an outer corner (external angle)
- valley: sloped seam where two planes meet at an internal angle (water flows down it)
- eave: lower horizontal edge of a roof plane (where gutters sit) — should form the closed outer perimeter
- rake: sloped outer edge of a gable end

Process (follow in order):
1. Identify the single target roof centered in the image. Mentally outline its full perimeter.
2. Trace the eave perimeter as a closed loop of 4-12 eave segments. Every endpoint must snap to a real outer corner.
3. Add ridges along the highest seams.
4. Add hips from ridge ends down to outer eave corners.
5. Add valleys only where you can see the dark V-shaped seam.
6. Add rakes only along visible gable-end slopes.

Hard rules:
- Lines must be straight segments with whole-pixel integer endpoints.
- No duplicates, no overlapping segments, no zero-length lines.
- Return 6-30 lines for a typical residential roof. Quality over quantity.
- If you are uncertain about a segment, set confidence below 0.6 — better to be honest than to invent geometry.`

function normalizeDetectedLines(lines: DetectedLine[]): DetectedLine[] {
  if (lines.length === 0) return lines

  const points = lines.flatMap((line) => [line.p1, line.p2])
  const maxX = Math.max(...points.map(([x]) => x))
  const maxY = Math.max(...points.map(([, y]) => y))
  const centroidX = points.reduce((sum, [x]) => sum + x, 0) / points.length
  const centroidY = points.reduce((sum, [, y]) => sum + y, 0) / points.length
  const centerX = DETECTION_IMG_W / 2
  const centerY = DETECTION_IMG_H / 2

  const looksLikeHalfScale =
    STATIC_SCALE === 2 &&
    maxX <= IMG_W + 64 &&
    maxY <= IMG_H + 64 &&
    Math.hypot(centroidX - centerX, centroidY - centerY) > DETECTION_IMG_W * 0.22

  const scale = looksLikeHalfScale ? STATIC_SCALE : 1

  return lines.map((line) => ({
    ...line,
    p1: [
      Math.max(0, Math.min(DETECTION_IMG_W, Math.round(line.p1[0] * scale))),
      Math.max(0, Math.min(DETECTION_IMG_H, Math.round(line.p1[1] * scale))),
    ],
    p2: [
      Math.max(0, Math.min(DETECTION_IMG_W, Math.round(line.p2[0] * scale))),
      Math.max(0, Math.min(DETECTION_IMG_H, Math.round(line.p2[1] * scale))),
    ],
  }))
}

async function callGemini(model: string, imageBase64: string, timeoutMs: number): Promise<DetectedLine[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: DETECT_PROMPT },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
            ],
          },
        ],
      }),
    })

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`AI gateway ${resp.status}: ${txt.slice(0, 300)}`)
    }

    const data = await resp.json()
    const raw = data.choices?.[0]?.message?.content ?? ''
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error(`AI returned no JSON: ${raw.slice(0, 200)}`)

    const parsed = JSON.parse(match[0]) as { lines: Omit<DetectedLine, 'id'>[] }
    return parsed.lines.map((l, i) => ({ ...l, id: `line-${i}` }))
  } finally {
    clearTimeout(timer)
  }
}

function coverageFraction(lines: DetectedLine[]): number {
  if (lines.length === 0) return 0
  const xs = lines.flatMap((l) => [l.p1[0], l.p2[0]])
  const ys = lines.flatMap((l) => [l.p1[1], l.p2[1]])
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  return (w * h) / (DETECTION_IMG_W * DETECTION_IMG_H)
}

async function detectLines(imageBase64: string): Promise<DetectedLine[]> {
  // Try flash first for speed.
  let lines: DetectedLine[] = []
  try {
    lines = await callGemini('google/gemini-2.5-flash', imageBase64, 55_000)
  } catch (err) {
    console.warn('flash model failed, falling back to pro', err instanceof Error ? err.message : err)
    return await callGemini('google/gemini-2.5-pro', imageBase64, 80_000)
  }
  // If flash mis-targeted (tiny bounding box), retry with pro for better visual reasoning.
  const coverage = coverageFraction(lines)
  if (coverage < 0.05 || lines.length < 6) {
    console.warn(`flash returned poor coverage (${(coverage * 100).toFixed(1)}%, ${lines.length} lines) — retrying with pro`)
    try {
      return await callGemini('google/gemini-2.5-pro', imageBase64, 80_000)
    } catch (err) {
      console.warn('pro retry failed, keeping flash result', err instanceof Error ? err.message : err)
    }
  }
  return lines
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { measurement_id, tenant_id, lat, lng } = await req.json()

    if (!measurement_id || !tenant_id || lat == null || lng == null) {
      return new Response(
        JSON.stringify({ error: 'measurement_id, tenant_id, lat, lng required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: measurementRow, error: measurementError } = await admin
      .from('roof_measurements')
      .select('target_lat, target_lng, gps_coordinates')
      .eq('id', measurement_id)
      .maybeSingle()

    if (measurementError) throw measurementError

    const resolvedLat =
      measurementRow?.target_lat ??
      ((measurementRow?.gps_coordinates as { lat?: number } | null)?.lat ?? null) ??
      lat
    const resolvedLng =
      measurementRow?.target_lng ??
      ((measurementRow?.gps_coordinates as { lng?: number } | null)?.lng ?? null) ??
      lng

    if (resolvedLat == null || resolvedLng == null) {
      throw new Error('Unable to resolve measurement coordinates for overlay generation')
    }

    // 1. Fetch Mapbox aerial
    const mapboxUrl = buildMapboxUrl(resolvedLat, resolvedLng)
    const imgResp = await fetch(mapboxUrl)
    if (!imgResp.ok) throw new Error(`Mapbox fetch failed: ${imgResp.status}`)
    const imgBytes = new Uint8Array(await imgResp.arrayBuffer())
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < imgBytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, imgBytes.subarray(i, i + chunkSize) as unknown as number[])
    }
    const imgBase64 = btoa(binary)

    // 2. Detect lines via AI
    const detected = normalizeDetectedLines(await detectLines(imgBase64))

    // 3. Compute lengths (meters/pixel * 3.28084 ft/m)
    const mpp = metersPerPixel(resolvedLat, ZOOM) / STATIC_SCALE
    const ftPerPx = mpp * 3.28084

    const lines: DetectedLine[] = detected.map((l) => {
      const lp = pxLength(l.p1, l.p2)
      return { ...l, length_px: lp, length_ft: lp * ftPerPx }
    })

    // 4. Roll up totals
    const totals_ft: Record<string, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 }
    for (const l of lines) totals_ft[l.type] = (totals_ft[l.type] || 0) + (l.length_ft || 0)
    totals_ft.perimeter = totals_ft.eave + totals_ft.rake

    const { data: latestOverlay } = await admin
      .from('roof_line_overlays')
      .select('version')
      .eq('measurement_id', measurement_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextVersion = (latestOverlay?.version ?? 0) + 1

    // 5. Upload PNG to bucket
    const storagePath = `${tenant_id}/${measurement_id}/v${nextVersion}.png`
    const { error: uploadErr } = await admin.storage
      .from('roof-line-overlays')
      .upload(storagePath, imgBytes, { contentType: 'image/png', upsert: true })
    if (uploadErr) console.error('Upload error', uploadErr)

    const { data: signed } = await admin.storage
      .from('roof-line-overlays')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

    // 6. Insert overlay row
    const { data: overlay, error: insertErr } = await admin
      .from('roof_line_overlays')
      .insert({
        tenant_id,
        measurement_id,
        version: nextVersion,
        source: 'auto',
        image_url: signed?.signedUrl ?? null,
        storage_path: storagePath,
        base_image_url: mapboxUrl,
        image_width: DETECTION_IMG_W,
        image_height: DETECTION_IMG_H,
        meters_per_pixel: mpp,
        center_lat: resolvedLat,
        center_lng: resolvedLng,
        zoom: ZOOM,
        lines,
        totals_ft,
        model_version: 'google/gemini-2.5-pro',
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    return new Response(JSON.stringify({ success: true, overlay }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('generate-roof-line-overlay error', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
