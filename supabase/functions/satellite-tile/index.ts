// Public proxy that returns a Mapbox satellite static tile for a given
// lat/lng/zoom/size, using the server-side MAPBOX_ACCESS_TOKEN secret. Lets the
// frontend (PinConfirmDialog, etc.) display satellite imagery without needing
// a publishable Mapbox token in the browser bundle.

const MAPBOX_TOKEN = Deno.env.get('MAPBOX_ACCESS_TOKEN') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const lat = parseFloat(url.searchParams.get('lat') ?? '')
    const lng = parseFloat(url.searchParams.get('lng') ?? '')
    const zoom = Math.min(22, Math.max(1, parseInt(url.searchParams.get('zoom') ?? '20', 10)))
    const size = Math.min(1280, Math.max(64, parseInt(url.searchParams.get('size') ?? '640', 10)))

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return new Response(JSON.stringify({ error: 'lat and lng required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!MAPBOX_TOKEN) {
      return new Response(JSON.stringify({ error: 'MAPBOX_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const tileUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom},0/${size}x${size}@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`

    const resp = await fetch(tileUrl)
    if (!resp.ok) {
      const text = await resp.text()
      return new Response(JSON.stringify({ error: 'Mapbox error', detail: text.slice(0, 500) }), {
        status: resp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const buf = await resp.arrayBuffer()
    return new Response(buf, {
      headers: {
        ...corsHeaders,
        'Content-Type': resp.headers.get('content-type') ?? 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
