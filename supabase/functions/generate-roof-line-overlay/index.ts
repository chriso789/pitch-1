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
const ZOOM = 20

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
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${ZOOM},0/${IMG_W}x${IMG_H}@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`
}

const DETECT_PROMPT = `You are an expert roof-line annotator looking at an aerial satellite image of a single residential roof.

Output ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "lines": [
    { "type": "ridge"|"hip"|"valley"|"eave"|"rake", "p1": [x,y], "p2": [x,y], "confidence": 0.0-1.0 }
  ]
}

Coordinate system: pixel coordinates in a ${IMG_W}x${IMG_H} image, origin top-left, x right, y down.

Definitions (be strict):
- ridge: top horizontal seam where two upward-sloping planes meet
- hip: sloped seam from a ridge end down to an outer corner (external angle)
- valley: sloped seam where two planes meet at an internal angle (water flows down it)
- eave: lower horizontal edge of a roof plane (where gutters sit)
- rake: sloped outer edge of a gable end

Rules:
- Trace EVERY visible roof edge. Do not invent lines that are not visually evidenced.
- Lines must be straight segments with crisp endpoints that snap to actual roof corners.
- Use whole-pixel integers.
- Return 8-40 lines for a typical residential roof.
- No duplicates, no overlapping segments.`

async function detectLines(imageBase64: string): Promise<DetectedLine[]> {
  const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-pro',
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
    throw new Error(`AI gateway ${resp.status}: ${txt.slice(0, 500)}`)
  }

  const data = await resp.json()
  const raw = data.choices?.[0]?.message?.content ?? ''
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`AI returned no JSON: ${raw.slice(0, 300)}`)

  const parsed = JSON.parse(match[0]) as { lines: Omit<DetectedLine, 'id'>[] }
  return parsed.lines.map((l, i) => ({ ...l, id: `line-${i}` }))
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

    // 1. Fetch Mapbox aerial
    const mapboxUrl = buildMapboxUrl(lat, lng)
    const imgResp = await fetch(mapboxUrl)
    if (!imgResp.ok) throw new Error(`Mapbox fetch failed: ${imgResp.status}`)
    const imgBytes = new Uint8Array(await imgResp.arrayBuffer())
    const imgBase64 = btoa(String.fromCharCode(...imgBytes))

    // 2. Detect lines via AI
    const detected = await detectLines(imgBase64)

    // 3. Compute lengths (meters/pixel * 3.28084 ft/m)
    const mpp = metersPerPixel(lat, ZOOM) / 2 // /2 for @2x retina
    const ftPerPx = mpp * 3.28084

    const lines: DetectedLine[] = detected.map((l) => {
      const lp = pxLength(l.p1, l.p2)
      return { ...l, length_px: lp, length_ft: lp * ftPerPx }
    })

    // 4. Roll up totals
    const totals_ft: Record<string, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 }
    for (const l of lines) totals_ft[l.type] = (totals_ft[l.type] || 0) + (l.length_ft || 0)
    totals_ft.perimeter = totals_ft.eave + totals_ft.rake

    // 5. Upload PNG to bucket
    const storagePath = `${tenant_id}/${measurement_id}/v1.png`
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
        version: 1,
        source: 'auto',
        image_url: signed?.signedUrl ?? null,
        storage_path: storagePath,
        base_image_url: mapboxUrl,
        image_width: IMG_W * 2,
        image_height: IMG_H * 2,
        meters_per_pixel: mpp,
        center_lat: lat,
        center_lng: lng,
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
