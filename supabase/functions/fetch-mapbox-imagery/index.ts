import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

const MAPBOX_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ImageRequest {
  latitude: number
  longitude: number
  zoom?: number
  width?: number
  height?: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { latitude, longitude, zoom = 20, width = 1280, height = 1280 }: ImageRequest = await req.json()
    
    if (!latitude || !longitude) {
      throw new Error('latitude and longitude are required')
    }

    console.log(`📍 Fetching Mapbox imagery for ${latitude}, ${longitude} at zoom ${zoom}`)

    // Mapbox Static Images API - satellite style
    const mapboxUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
      `${longitude},${latitude},${zoom}/${width}x${height}@2x?` +
      `access_token=${MAPBOX_TOKEN}`
    
    // Fetch the satellite image
    const response = await fetch(mapboxUrl)
    
    if (!response.ok) {
      console.error('Mapbox fetch failed:', response.status, await response.text())
      throw new Error(`Mapbox API error: ${response.status}`)
    }
    
    const imageBuffer = await response.arrayBuffer()
    const base64Image = base64Encode(new Uint8Array(imageBuffer))
    
    // Calculate the geographic bounds of this image using Web Mercator projection
    const metersPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom)
    const widthInMeters = width * metersPerPixel
    const heightInMeters = height * metersPerPixel
    
    // Calculate corner coordinates (degrees)
    const latOffset = (heightInMeters / 2) / 111320 // meters to degrees latitude
    const lngOffset = (widthInMeters / 2) / (111320 * Math.cos(latitude * Math.PI / 180))
    
    const bounds = {
      topLeft: { lat: latitude + latOffset, lng: longitude - lngOffset },
      topRight: { lat: latitude + latOffset, lng: longitude + lngOffset },
      bottomLeft: { lat: latitude - latOffset, lng: longitude - lngOffset },
      bottomRight: { lat: latitude - latOffset, lng: longitude + lngOffset }
    }

    console.log(`✅ Image fetched: ${width}x${height} @ zoom ${zoom}`)
    console.log(`📐 Bounds: ${bounds.topLeft.lat.toFixed(6)}, ${bounds.topLeft.lng.toFixed(6)} to ${bounds.bottomRight.lat.toFixed(6)}, ${bounds.bottomRight.lng.toFixed(6)}`)

    return new Response(JSON.stringify({
      success: true,
      image: `data:image/png;base64,${base64Image}`,
      bounds,
      center: { lat: latitude, lng: longitude },
      zoom,
      metersPerPixel,
      dimensions: { width, height }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error: any) {
    console.error('❌ Error fetching Mapbox imagery:', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
