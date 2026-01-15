import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface FusionRequest {
  lat: number;
  lng: number;
  existingFootprint?: {
    vertices: Array<{ lat: number; lng: number }>;
    source: string;
    confidence: number;
  };
}

interface FootprintCandidate {
  vertices: Array<{ lat: number; lng: number }>;
  source: string;
  confidence: number;
  areaSqft: number;
  vertexCount: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { lat, lng, existingFootprint } = await req.json() as FusionRequest
    
    console.log(`🔀 Footprint fusion for ${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    
    const candidates: FootprintCandidate[] = []
    
    // If existing footprint provided, add it as a candidate
    if (existingFootprint?.vertices?.length >= 3) {
      const area = calculatePolygonArea(existingFootprint.vertices)
      candidates.push({
        vertices: existingFootprint.vertices,
        source: existingFootprint.source,
        confidence: existingFootprint.confidence,
        areaSqft: area,
        vertexCount: existingFootprint.vertices.length,
      })
    }
    
    // Fetch from multiple sources in parallel
    const [osmResult, microsoftResult] = await Promise.allSettled([
      fetchOSMFootprint(lat, lng),
      fetchMicrosoftFootprint(lat, lng),
    ])
    
    // Add OSM result
    if (osmResult.status === 'fulfilled' && osmResult.value) {
      candidates.push(osmResult.value)
      console.log(`  OSM: ${osmResult.value.vertexCount} vertices, ${osmResult.value.areaSqft.toFixed(0)} sqft`)
    }
    
    // Add Microsoft result
    if (microsoftResult.status === 'fulfilled' && microsoftResult.value) {
      candidates.push(microsoftResult.value)
      console.log(`  Microsoft: ${microsoftResult.value.vertexCount} vertices, ${microsoftResult.value.areaSqft.toFixed(0)} sqft`)
    }
    
    if (candidates.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No footprint sources returned data'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Score and rank candidates
    const scored = candidates.map(c => ({
      ...c,
      score: calculateFootprintScore(c, candidates),
    })).sort((a, b) => b.score - a.score)
    
    const best = scored[0]
    
    // Calculate consensus area (median of all candidates)
    const areas = candidates.map(c => c.areaSqft).sort((a, b) => a - b)
    const consensusArea = areas[Math.floor(areas.length / 2)]
    
    // Warn if best differs significantly from consensus
    const areaVariance = Math.abs(best.areaSqft - consensusArea) / consensusArea * 100
    const warnings: string[] = []
    
    if (areaVariance > 15) {
      warnings.push(`Best footprint area differs ${areaVariance.toFixed(0)}% from consensus`)
    }
    
    if (best.vertexCount <= 4) {
      warnings.push('Selected footprint is rectangular - may be simplified')
    }
    
    console.log(`✅ Best footprint: ${best.source} (${best.score.toFixed(0)} score, ${best.areaSqft.toFixed(0)} sqft)`)
    
    return new Response(JSON.stringify({
      success: true,
      data: {
        best: {
          vertices: best.vertices,
          source: best.source,
          confidence: best.confidence,
          areaSqft: best.areaSqft,
          vertexCount: best.vertexCount,
          score: best.score,
        },
        candidates: scored.map(c => ({
          source: c.source,
          areaSqft: c.areaSqft,
          vertexCount: c.vertexCount,
          confidence: c.confidence,
          score: c.score,
        })),
        consensusArea,
        warnings,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('❌ footprint-fusion error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Fetch from OSM Overpass API
async function fetchOSMFootprint(lat: number, lng: number): Promise<FootprintCandidate | null> {
  try {
    const query = `
      [out:json][timeout:10];
      way["building"](around:50,${lat},${lng});
      out body geom;
    `
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.elements?.length) return null
    
    // Find closest building
    let best: { ring: Array<{ lat: number; lng: number }>; distance: number } | null = null
    
    for (const element of data.elements) {
      if (element.geometry?.length >= 4) {
        const ring = element.geometry.map((n: any) => ({ lat: n.lat, lng: n.lon }))
        const centroid = getCentroid(ring)
        const distance = haversineDistance(lat, lng, centroid.lat, centroid.lng)
        
        if (!best || distance < best.distance) {
          best = { ring, distance }
        }
      }
    }
    
    if (!best) return null
    
    return {
      vertices: best.ring,
      source: 'osm_buildings',
      confidence: 0.85 - (best.distance > 15 ? 0.1 : 0),
      areaSqft: calculatePolygonArea(best.ring),
      vertexCount: best.ring.length,
    }
  } catch {
    return null
  }
}

// Fetch from Microsoft/Esri Buildings
async function fetchMicrosoftFootprint(lat: number, lng: number): Promise<FootprintCandidate | null> {
  try {
    const radius = 50
    const metersPerDegLat = 111320
    const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180)
    const latOffset = radius / metersPerDegLat
    const lngOffset = radius / metersPerDegLng
    
    const url = `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Structures/FeatureServer/0/query?where=1%3D1&geometry=${lng - lngOffset},${lat - latOffset},${lng + lngOffset},${lat + latOffset}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&f=geojson`
    
    const response = await fetch(url)
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.features?.length) return null
    
    // Find closest building
    let best: { ring: Array<{ lat: number; lng: number }>; distance: number } | null = null
    
    for (const feature of data.features) {
      if (feature.geometry?.type === 'Polygon' && feature.geometry.coordinates?.[0]?.length >= 4) {
        const ring = feature.geometry.coordinates[0].map((c: number[]) => ({ lat: c[1], lng: c[0] }))
        const centroid = getCentroid(ring)
        const distance = haversineDistance(lat, lng, centroid.lat, centroid.lng)
        
        if (!best || distance < best.distance) {
          best = { ring, distance }
        }
      }
    }
    
    if (!best) return null
    
    return {
      vertices: best.ring,
      source: 'microsoft_buildings',
      confidence: 0.88 - (best.distance > 15 ? 0.1 : 0),
      areaSqft: calculatePolygonArea(best.ring),
      vertexCount: best.ring.length,
    }
  } catch {
    return null
  }
}

// Calculate a score for ranking footprints
function calculateFootprintScore(candidate: FootprintCandidate, allCandidates: FootprintCandidate[]): number {
  let score = candidate.confidence * 100
  
  // Prefer more vertices (more detailed)
  if (candidate.vertexCount > 6) score += 10
  if (candidate.vertexCount > 10) score += 5
  
  // Penalize simple rectangles
  if (candidate.vertexCount === 4) score -= 15
  
  // Prefer areas close to median
  const areas = allCandidates.map(c => c.areaSqft).sort((a, b) => a - b)
  const median = areas[Math.floor(areas.length / 2)]
  const variance = Math.abs(candidate.areaSqft - median) / median
  score -= variance * 20
  
  // Source preference
  const sourceBonus: Record<string, number> = {
    'mapbox_vector': 15,
    'regrid_parcel': 12,
    'osm_buildings': 8,
    'microsoft_buildings': 8,
    'manual': 20,
    'solar_bbox_fallback': -20,
  }
  score += sourceBonus[candidate.source] || 0
  
  return Math.max(0, Math.min(100, score))
}

function calculatePolygonArea(vertices: Array<{ lat: number; lng: number }>): number {
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
  
  return Math.abs(sum) / 2 * 10.764
}

function getCentroid(vertices: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  return {
    lat: vertices.reduce((s, v) => s + v.lat, 0) / vertices.length,
    lng: vertices.reduce((s, v) => s + v.lng, 0) / vertices.length,
  }
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
