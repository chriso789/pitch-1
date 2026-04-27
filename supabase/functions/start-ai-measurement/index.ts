// ===================================================================
// start-ai-measurement — geometry_first_v2 pipeline
//
// Canonical CRM-facing entrypoint for the "AI Measurement" button on
// lead/project detail pages. Runs the geometry-first protocol:
//   1. Resolve property (lead_id/project_id → address + lat/lng)
//   2. Geocode if coordinates missing
//   3. Pull Mapbox satellite (@2x)  + Google Solar (when available)
//   4. Calibrate pixel→feet using @2x raster_scale correction
//   5. Build roof planes (Solar segments preferred)
//   6. Compute area (shoelace) + pitch multiplier + line lengths
//   7. Run quality checks → status (completed | needs_review | needs_manual_measurement)
//   8. Persist forensic geometry (ai_measurement_*) AND publish customer
//      summary (roof_measurements + measurement_approvals)
//   9. Update measurement_jobs for UI polling
//
// HARD RULES enforced here:
//   - Never mark a job "completed" with placeholder geometry
//   - @2x raster correction is mandatory before any pixel→feet math
//   - Lead/project linkage is enforced (single page only)
// ===================================================================

import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import { generateRoofDiagrams } from '../_shared/roof-diagram-renderer.ts'
import {
  buildRoofPlanes,
  filterStrongRidges,
  intersectSegments,
  type Line as SplitLine,
} from '../_shared/plane-split.ts'
import { fetchMapboxVectorFootprint } from '../_shared/mapbox-footprint-extractor.ts'
import { fetchOSMBuildingFootprint } from '../_shared/osm-footprint-extractor.ts'
import { fetchMicrosoftBuildingFootprint } from '../_shared/microsoft-footprint-extractor.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Server-side token: prefer the secret/access token. Public token is a last
// resort because URL-restricted public tokens routinely 403 from edge runtimes.
const MAPBOX_SERVER_TOKEN =
  Deno.env.get('MAPBOX_ACCESS_TOKEN') ||
  Deno.env.get('MAPBOX_TOKEN') ||
  Deno.env.get('MAPBOX_PUBLIC_TOKEN') ||
  ''
// Static Images token: same precedence — access token first.
const MAPBOX_IMAGE_TOKEN =
  Deno.env.get('MAPBOX_ACCESS_TOKEN') ||
  Deno.env.get('MAPBOX_PUBLIC_TOKEN') ||
  Deno.env.get('MAPBOX_TOKEN') ||
  ''
// Backwards-compat alias for any code paths still referencing MAPBOX_TOKEN.
const MAPBOX_TOKEN = MAPBOX_SERVER_TOKEN
const GOOGLE_SOLAR_API_KEY = Deno.env.get('GOOGLE_SOLAR_API_KEY') || ''
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
const GOOGLE_STATIC_KEY = GOOGLE_MAPS_API_KEY

const ENGINE_VERSION = 'geometry_first_v2'
const MAX_AUTO_ROOF_AREA_SQFT = 30000
const MAX_FOOTPRINT_FRAME_FRACTION = 0.65
const FOOTPRINT_EDGE_MARGIN_PX = 4

// ─────────────────────────────────────────────────────────────────────
// Geometry helpers (pure, unit-tested via acceptance tests)
// ─────────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number }
type GeoPt = { lat: number; lng: number }
type DecodedRaster = { width: number; height: number; data: Uint8Array }

type GeoXY = [number, number] // [lng, lat]
type FootprintSource = 'mapbox_vector' | 'osm_buildings' | 'microsoft_buildings'

interface AuthoritativeFootprint {
  coordinates: GeoXY[]
  source: FootprintSource
  confidence: number
  areaM2?: number
  vertexCount: number
}

function solarAggregatePlane(
  solar: any,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  pitchHintRise: number | null,
  azimuthHint: number | null,
): RoofPlane | null {
  let sw = solar?.boundingBox?.sw
  let ne = solar?.boundingBox?.ne
  if ((!sw || !ne) && Array.isArray(solar?.solarPotential?.roofSegmentStats)) {
    const boxes = solar.solarPotential.roofSegmentStats.map((seg: any) => seg?.boundingBox).filter((bb: any) => bb?.sw && bb?.ne)
    if (boxes.length > 0) {
      sw = {
        latitude: Math.min(...boxes.map((bb: any) => Number(bb.sw.latitude))),
        longitude: Math.min(...boxes.map((bb: any) => Number(bb.sw.longitude))),
      }
      ne = {
        latitude: Math.max(...boxes.map((bb: any) => Number(bb.ne.latitude))),
        longitude: Math.max(...boxes.map((bb: any) => Number(bb.ne.longitude))),
      }
    }
  }
  const areaM2 = Number(solar?.solarPotential?.wholeRoofStats?.areaMeters2 || 0)
  if (!sw || !ne || !Number.isFinite(areaM2) || areaM2 <= 0) return null

  const polyGeo = [
    { lat: sw.latitude, lng: sw.longitude },
    { lat: sw.latitude, lng: ne.longitude },
    { lat: ne.latitude, lng: ne.longitude },
    { lat: ne.latitude, lng: sw.longitude },
  ]
  const polyPx = polyGeo.map((p) => latLngToPixel(p, centerLat, centerLng, imgW, imgH, actualMpp))
  const pmInfo = pitchHintRise != null ? pitchInfo(pitchHintRise) : { pitch_degrees: 0, pitch_multiplier: 1 }
  const area2dSqft = areaM2 * 10.7639

  return {
    plane_index: 0,
    source: 'google_solar_aggregate',
    polygon_px: polyPx,
    polygon_geojson: polyGeo,
    pitch: pitchHintRise,
    pitch_degrees: pmInfo.pitch_degrees,
    azimuth: azimuthHint,
    area_2d_sqft: area2dSqft,
    pitch_multiplier: pmInfo.pitch_multiplier,
    area_pitch_adjusted_sqft: area2dSqft * pmInfo.pitch_multiplier,
    confidence: 0.68,
  }
}

function openGeoRing(coords: GeoXY[]): GeoXY[] {
  if (!coords.length) return []
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (
    Math.abs(first[0] - last[0]) < 1e-12 &&
    Math.abs(first[1] - last[1]) < 1e-12
  ) {
    return coords.slice(0, -1)
  }
  return coords.slice()
}

function geoPolygonAreaM2(coords: GeoXY[]): number {
  const ring = openGeoRing(coords)
  if (ring.length < 3) return 0
  const midLat = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos((midLat * Math.PI) / 180)

  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    const x1 = ring[i][0] * metersPerDegLng
    const y1 = ring[i][1] * metersPerDegLat
    const x2 = ring[j][0] * metersPerDegLng
    const y2 = ring[j][1] * metersPerDegLat
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

async function resolveAuthoritativeFootprint(
  lat: number,
  lng: number,
  solarAreaHintSqft: number,
): Promise<AuthoritativeFootprint | null> {
  const candidates: AuthoritativeFootprint[] = []

  console.log(`[authoritative] starting resolve at ${lat.toFixed(6)},${lng.toFixed(6)} mapbox_token=${MAPBOX_TOKEN ? 'yes' : 'NO'}`)

  if (MAPBOX_TOKEN) {
    try {
      const mapbox = await fetchMapboxVectorFootprint(lat, lng, MAPBOX_TOKEN)
      if (mapbox.footprint?.coordinates?.length) {
        candidates.push({
          coordinates: mapbox.footprint.coordinates as GeoXY[],
          source: 'mapbox_vector',
          confidence: Number(mapbox.footprint.confidence || 0.8),
          areaM2: mapbox.footprint.areaM2,
          vertexCount: Number(mapbox.footprint.vertexCount || mapbox.footprint.coordinates.length || 0),
        })
        console.log(`[authoritative] mapbox returned footprint vertices=${mapbox.footprint.coordinates.length} areaM2=${mapbox.footprint.areaM2}`)
      } else {
        console.log(`[authoritative] mapbox returned NO footprint reason=${(mapbox as any).fallbackReason || (mapbox as any).error || 'empty'}`)
      }
    } catch (err) {
      console.warn(`[authoritative] mapbox threw: ${err}`)
    }
  }

  try {
    const osm = await fetchOSMBuildingFootprint(lat, lng)
    if (osm.footprint?.coordinates?.length) {
      candidates.push({
        coordinates: osm.footprint.coordinates as GeoXY[],
        source: 'osm_buildings',
        confidence: Number(osm.footprint.confidence || 0.75),
        areaM2: osm.footprint.areaM2,
        vertexCount: Number(osm.footprint.vertexCount || osm.footprint.coordinates.length || 0),
      })
      console.log(`[authoritative] osm returned footprint vertices=${osm.footprint.coordinates.length} areaM2=${osm.footprint.areaM2}`)
    } else {
      console.log(`[authoritative] osm returned NO footprint reason=${osm.fallbackReason || osm.error || 'empty'}`)
    }
  } catch (err) {
    console.warn(`[authoritative] osm threw: ${err}`)
  }

  try {
    const microsoft = await fetchMicrosoftBuildingFootprint(lat, lng)
    if (microsoft.footprint?.coordinates?.length) {
      candidates.push({
        coordinates: microsoft.footprint.coordinates as GeoXY[],
        source: 'microsoft_buildings',
        confidence: Number(microsoft.footprint.confidence || 0.75),
        areaM2: microsoft.footprint.areaM2,
        vertexCount: Number(microsoft.footprint.vertexCount || microsoft.footprint.coordinates.length || 0),
      })
      console.log(`[authoritative] microsoft returned footprint vertices=${microsoft.footprint.coordinates.length} areaM2=${microsoft.footprint.areaM2}`)
    } else {
      console.log(`[authoritative] microsoft returned NO footprint reason=${(microsoft as any).fallbackReason || (microsoft as any).error || 'empty'}`)
    }
  } catch (err) {
    console.warn(`[authoritative] microsoft threw: ${err}`)
  }

  if (!candidates.length) {
    console.warn(`[authoritative] NO candidates from any provider — falling back`)
    return null
  }

  const score = (fp: AuthoritativeFootprint) => {
    const areaSqft = (fp.areaM2 && fp.areaM2 > 0 ? fp.areaM2 : geoPolygonAreaM2(fp.coordinates)) * 10.7639
    const detailScore = Math.min(0.12, Math.max(0, fp.vertexCount - 4) * 0.01)
    const sourceScore =
      fp.source === 'mapbox_vector' ? 0.08 :
      fp.source === 'osm_buildings' ? 0.05 : 0.03

    let areaScore = 0
    if (areaSqft < 100 || areaSqft > 40000) areaScore -= 0.5

    if (solarAreaHintSqft > 0 && areaSqft > 0) {
      const ratio = Math.max(areaSqft, solarAreaHintSqft) / Math.max(1, Math.min(areaSqft, solarAreaHintSqft))
      if (ratio <= 1.25) areaScore += 0.12
      else if (ratio <= 1.5) areaScore += 0.06
      else if (ratio <= 2.0) areaScore += 0.02
      else areaScore -= 0.12
    }

    return fp.confidence + detailScore + sourceScore + areaScore
  }

  const best = [...candidates].sort((a, b) => score(b) - score(a))[0]
  console.log(
    `[start-ai-measurement] authoritative footprint selected: ${best.source} ` +
    `vertices=${best.vertexCount} confidence=${best.confidence.toFixed(2)} areaM2=${(best.areaM2 ?? 0).toFixed(1)}`
  )
  return best
}

function planeFromAuthoritativeFootprint(
  footprint: AuthoritativeFootprint,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  pitchHintRise: number | null,
  azimuthHint: number | null,
  planeIndex = 0,
): RoofPlane {
  const ring = openGeoRing(footprint.coordinates)
  const polyGeo = ring.map(([lng, lat]) => ({ lat, lng }))
  const polyPx = polyGeo.map((p) =>
    latLngToPixel(p, centerLat, centerLng, imgW, imgH, actualMpp),
  )

  const areaM2 =
    footprint.areaM2 && footprint.areaM2 > 0
      ? footprint.areaM2
      : geoPolygonAreaM2(footprint.coordinates)

  const area2dSqft = areaM2 * 10.7639
  const pmInfo =
    pitchHintRise != null
      ? pitchInfo(pitchHintRise)
      : { pitch_degrees: 0, pitch_multiplier: 1 }

  return {
    plane_index: planeIndex,
    source: footprint.source,
    polygon_px: polyPx,
    polygon_geojson: polyGeo,
    pitch: pitchHintRise,
    pitch_degrees: pmInfo.pitch_degrees,
    azimuth: azimuthHint,
    area_2d_sqft: area2dSqft,
    pitch_multiplier: pmInfo.pitch_multiplier,
    area_pitch_adjusted_sqft: area2dSqft * pmInfo.pitch_multiplier,
    confidence: Math.max(0.72, footprint.confidence),
  }
}

function isLowDetailAuthoritativeFootprint(footprint: AuthoritativeFootprint | null): boolean {
  if (!footprint) return true
  const vertexCount = Number(footprint.vertexCount || openGeoRing(footprint.coordinates).length || 0)
  return vertexCount <= 6 || footprint.confidence < 0.82
}

function sniffRasterFormat(buf: Uint8Array): 'png' | 'jpeg' | 'unknown' {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) return 'png'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg'
  return 'unknown'
}

async function decodeRaster(buf: Uint8Array, contentType?: string | null): Promise<DecodedRaster> {
  const ct = String(contentType || '').toLowerCase()
  const fmt = ct.includes('png')
    ? 'png'
    : ct.includes('jpeg') || ct.includes('jpg')
      ? 'jpeg'
      : sniffRasterFormat(buf)

  if (fmt === 'png') {
    const { PNG } = await import('npm:pngjs@7.0.0')
    const png = PNG.sync.read(buf as any)
    return { width: png.width, height: png.height, data: png.data as Uint8Array }
  }

  if (fmt === 'jpeg') {
    const jpeg = await import('npm:jpeg-js@0.4.4')
    const decode = (jpeg as any).decode || (jpeg as any).default?.decode
    if (!decode) throw new Error('JPEG decoder unavailable')
    const decoded = decode(buf, { useTArray: true })
    if (!decoded?.width || !decoded?.height || !decoded?.data) throw new Error('JPEG decode failed')
    return { width: decoded.width, height: decoded.height, data: decoded.data as Uint8Array }
  }

  throw new Error(`Unsupported raster format: ${contentType || 'unknown'}`)
}

/** Logical (Web Mercator) meters-per-pixel at given lat/zoom. */
export function logicalMetersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
}

/** ACTUAL meters/feet per pixel after accounting for @2x raster scaling. */
export function calibrate(lat: number, zoom: number, rasterScale: number) {
  const mppLogical = logicalMetersPerPixel(lat, zoom)
  const mppActual = mppLogical / rasterScale
  return {
    meters_per_pixel_logical: mppLogical,
    meters_per_pixel_actual: mppActual,
    feet_per_pixel_actual: mppActual * 3.280839895,
  }
}

/** Shoelace area in pixel² for a closed polygon (last == first not required). */
export function shoelaceAreaPx(poly: Pt[]): number {
  if (!poly || poly.length < 3) return 0
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/** Convert r/12 pitch (rise) → degrees + slope multiplier. */
export function pitchInfo(rise: number) {
  const r = Math.max(0, rise)
  return {
    pitch_degrees: (Math.atan(r / 12) * 180) / Math.PI,
    pitch_multiplier: Math.sqrt(144 + r * r) / 12,
  }
}

/** Polyline length in pixels. */
export function polylineLengthPx(line: Pt[]): number {
  if (!line || line.length < 2) return 0
  let len = 0
  for (let i = 1; i < line.length; i++) {
    const dx = line[i].x - line[i - 1].x
    const dy = line[i].y - line[i - 1].y
    len += Math.sqrt(dx * dx + dy * dy)
  }
  return len
}

/** Pixel (image) → GeoJSON lat/lng using image center + actual mpp. */
export function pixelToLatLng(
  x: number,
  y: number,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
): GeoPt {
  const dx_m = (x - imgW / 2) * actualMpp
  const dy_m = (y - imgH / 2) * actualMpp
  const dLat = -((dy_m / 6378137) * 180) / Math.PI
  const dLng =
    ((dx_m / (6378137 * Math.cos((centerLat * Math.PI) / 180))) * 180) / Math.PI
  return { lat: centerLat + dLat, lng: centerLng + dLng }
}

/** Bow-tie / self-intersection check (segments share endpoints excepted). */
export function hasSelfIntersection(poly: Pt[]): boolean {
  const n = poly.length
  if (n < 4) return false
  const segs: [Pt, Pt][] = []
  for (let i = 0; i < n; i++) segs.push([poly[i], poly[(i + 1) % n]])
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      // skip adjacent segments
      if (j === i + 1 || (i === 0 && j === segs.length - 1)) continue
      if (segIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) return true
    }
  }
  return false
}

function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-9) return false
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6
}

/** Convert a geographic polygon (lat/lng around centerLat/Lng) to image pixels. */
function latLngToPixel(
  pt: GeoPt,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
): Pt {
  const dLatRad = ((pt.lat - centerLat) * Math.PI) / 180
  const dLngRad = ((pt.lng - centerLng) * Math.PI) / 180
  const dy_m = -dLatRad * 6378137
  const dx_m = dLngRad * 6378137 * Math.cos((centerLat * Math.PI) / 180)
  return { x: imgW / 2 + dx_m / actualMpp, y: imgH / 2 + dy_m / actualMpp }
}

// ─────────────────────────────────────────────────────────────────────
// Source loaders
// ─────────────────────────────────────────────────────────────────────

async function geocodeAddress(address: string) {
  if (!GOOGLE_MAPS_API_KEY) return null
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`
  const r = await fetch(url)
  if (!r.ok) return null
  const j: any = await r.json()
  const top = j?.results?.[0]
  if (!top) return null
  return {
    lat: top.geometry?.location?.lat,
    lng: top.geometry?.location?.lng,
    location_type: top.geometry?.location_type || 'APPROXIMATE',
    formatted: top.formatted_address,
  }
}

// Legacy Mapbox-only helper kept for any callers that still expect it.
// New code paths should use fetchPreferredBaseImagery() instead.
async function fetchMapbox(lat: number, lng: number, zoom = 20, logicalSize = 640) {
  if (!MAPBOX_IMAGE_TOKEN) return null
  const url =
    `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
    `${lng},${lat},${zoom}/${logicalSize}x${logicalSize}@2x?access_token=${MAPBOX_IMAGE_TOKEN}`
  const r = await fetch(url)
  if (!r.ok) return null
  return {
    image_url: url,
    logical_w: logicalSize,
    logical_h: logicalSize,
    actual_w: logicalSize * 2,
    actual_h: logicalSize * 2,
    raster_scale: 2,
    zoom,
  }
}

// ── Provider-agnostic base imagery ────────────────────────────────────
type BaseImagery = {
  provider: 'mapbox' | 'google_static'
  imageUrl: string
  rgba: Uint8Array
  width: number
  height: number
  logicalWidth: number
  logicalHeight: number
  rasterScale: number
  zoom: number
}

async function fetchStaticRaster(
  url: string,
  provider: 'mapbox' | 'google_static',
  zoom: number,
  logicalWidth = 640,
  logicalHeight = 640,
  rasterScale = 2,
): Promise<BaseImagery | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      console.warn(`[imagery] ${provider} HTTP ${resp.status}`, detail.slice(0, 300))
      return null
    }
    const contentType = resp.headers.get('content-type') || ''
    const bytes = new Uint8Array(await resp.arrayBuffer())
    const decoded = await decodeRaster(bytes, contentType).catch((err) => {
      console.warn(`[imagery] ${provider} decode failed`, String(err))
      return null
    })
    if (!decoded || !decoded.width || !decoded.height || !decoded.data?.length) {
      return null
    }
    return {
      provider,
      imageUrl: url,
      rgba: decoded.data,
      width: decoded.width,
      height: decoded.height,
      logicalWidth,
      logicalHeight,
      rasterScale,
      zoom,
    }
  } catch (err) {
    console.warn(`[imagery] ${provider} exception`, String(err))
    return null
  }
}

async function fetchPreferredBaseImagery(
  lat: number,
  lng: number,
  zoom: number,
  logicalWidth = 640,
  logicalHeight = 640,
): Promise<BaseImagery | null> {
  if (MAPBOX_IMAGE_TOKEN) {
    const mapboxUrl =
      `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
      `${lng},${lat},${zoom},0,0/${logicalWidth}x${logicalHeight}@2x` +
      `?access_token=${MAPBOX_IMAGE_TOKEN}&logo=false&attribution=false`
    const mb = await fetchStaticRaster(mapboxUrl, 'mapbox', zoom, logicalWidth, logicalHeight, 2)
    if (mb) return mb
    console.warn('[imagery] Mapbox failed; falling back to Google Static Maps')
  }
  if (GOOGLE_STATIC_KEY) {
    const googleUrl =
      `https://maps.googleapis.com/maps/api/staticmap` +
      `?center=${lat},${lng}` +
      `&zoom=${zoom}` +
      `&size=${logicalWidth}x${logicalHeight}` +
      `&scale=2&maptype=satellite&format=png&key=${GOOGLE_STATIC_KEY}`
    const gg = await fetchStaticRaster(googleUrl, 'google_static', zoom, logicalWidth, logicalHeight, 2)
    if (gg) return gg
  }
  return null
}

function computeImageBounds(
  lat: number,
  lng: number,
  zoom: number,
  logicalWidth: number,
  logicalHeight: number,
): [number, number, number, number] {
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
  const halfW = (logicalWidth * metersPerPixel) / 2
  const halfH = (logicalHeight * metersPerPixel) / 2
  const latOffset = halfH / 111320
  const lngOffset = halfW / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lng - lngOffset, lat - latOffset, lng + lngOffset, lat + latOffset]
}

async function fetchGoogleSolar(lat: number, lng: number) {
  if (!GOOGLE_SOLAR_API_KEY) return null
  // Use LOW as the floor — Solar's API returns the best available imagery at
  // or above this threshold (HIGH/MEDIUM/LOW). Hardcoding HIGH causes 404s on
  // most US suburban addresses where only MEDIUM coverage exists.
  // Try HIGH first, fall back through MEDIUM to LOW so we always get the
  // best available data without blocking the pipeline.
  for (const quality of ['HIGH', 'MEDIUM', 'LOW']) {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=${quality}&key=${GOOGLE_SOLAR_API_KEY}`
    const r = await fetch(url)
    if (r.ok) {
      const data = await r.json()
      console.log(`[fetchGoogleSolar] success at quality=${quality}, segments=${data?.solarPotential?.roofSegmentStats?.length || 0}`)
      return data
    }
    if (r.status !== 404) {
      console.warn(`[fetchGoogleSolar] non-404 error at quality=${quality}: ${r.status}`)
      return null
    }
  }
  console.log(`[fetchGoogleSolar] no Solar coverage at any quality for ${lat},${lng}`)
  return null
}

// ─────────────────────────────────────────────────────────────────────
// Plane / edge derivation
// ─────────────────────────────────────────────────────────────────────

interface RoofPlane {
  plane_index: number
  source: string
  polygon_px: Pt[]
  polygon_geojson: GeoPt[]
  pitch: number | null // r/12 rise
  pitch_degrees: number | null
  azimuth: number | null
  area_2d_sqft: number
  pitch_multiplier: number
  area_pitch_adjusted_sqft: number
  confidence: number
}

interface RoofEdge {
  edge_type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unknown'
  source: string
  line_px: Pt[]
  line_geojson: GeoPt[]
  length_px: number
  length_ft: number
  confidence: number
}

/** Build planes from Google Solar roofSegmentStats (preferred path). */
function planesFromSolar(
  solar: any,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
): RoofPlane[] {
  const segs: any[] = solar?.solarPotential?.roofSegmentStats || []
  return segs
    .map((seg: any, idx: number) => {
      const bb = seg.boundingBox
      if (!bb?.sw || !bb?.ne) return null
      const sw = { lat: bb.sw.latitude, lng: bb.sw.longitude }
      const ne = { lat: bb.ne.latitude, lng: bb.ne.longitude }
      const nw = { lat: ne.lat, lng: sw.lng }
      const se = { lat: sw.lat, lng: ne.lng }
      const polyGeo = [sw, se, ne, nw]
      const polyPx = polyGeo.map((p) =>
        latLngToPixel(p, centerLat, centerLng, imgW, imgH, actualMpp),
      )
      const pitchDeg = seg.pitchDegrees ?? null
      const rise =
        pitchDeg != null ? Math.tan((pitchDeg * Math.PI) / 180) * 12 : null
      const pmInfo =
        rise != null
          ? pitchInfo(rise)
          : { pitch_degrees: pitchDeg ?? 0, pitch_multiplier: 1 }

      // Trust Solar's stats.areaMeters2 for sloped area (it's on-roof area).
      const areaSlopedSqft = (seg?.stats?.areaMeters2 ?? 0) * 10.7639
      const areaPxFlat = shoelaceAreaPx(polyPx)
      const area2dSqft = areaPxFlat * feetPerPixel * feetPerPixel
      // If we have sloped area from Solar, derive multiplier consistency
      const finalSlopedSqft =
        areaSlopedSqft > 0
          ? areaSlopedSqft
          : area2dSqft * pmInfo.pitch_multiplier

      return {
        plane_index: idx,
        // HARD RULE: Solar boundingBox is an axis-aligned rectangle hint, NOT
        // real facet geometry. Tag it as bbox so the QC gate can refuse to
        // publish a customer-ready report from it.
        source: 'google_solar_bbox',
        polygon_px: polyPx,
        polygon_geojson: polyGeo,
        pitch: rise,
        pitch_degrees: pmInfo.pitch_degrees,
        azimuth: seg.azimuthDegrees ?? null,
        area_2d_sqft: area2dSqft,
        pitch_multiplier: pmInfo.pitch_multiplier,
        area_pitch_adjusted_sqft: finalSlopedSqft,
        confidence: 0.5,
      } as RoofPlane
    })
    .filter(Boolean) as RoofPlane[]
}

/** Derive perimeter eaves/rakes from a single union footprint when no facets exist. */
function edgesFromPerimeter(
  perimPx: Pt[],
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
): RoofEdge[] {
  if (perimPx.length < 3) return []
  const out: RoofEdge[] = []
  for (let i = 0; i < perimPx.length; i++) {
    const a = perimPx[i]
    const b = perimPx[(i + 1) % perimPx.length]
    const lpx = polylineLengthPx([a, b])
    out.push({
      edge_type: 'eave', // unclassified perimeter → assumed eave; needs_review
      source: 'perimeter_fallback',
      line_px: [a, b],
      line_geojson: [
        pixelToLatLng(a.x, a.y, centerLat, centerLng, imgW, imgH, actualMpp),
        pixelToLatLng(b.x, b.y, centerLat, centerLng, imgW, imgH, actualMpp),
      ],
      length_px: lpx,
      length_ft: lpx * feetPerPixel,
      confidence: 0.4,
    })
  }
  return out
}

function lineToRoofEdge(
  line: SplitLine,
  edgeType: RoofEdge['edge_type'],
  source: string,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
  confidence: number,
): RoofEdge {
  const lpx = polylineLengthPx([line.p1, line.p2])
  return {
    edge_type: edgeType,
    source,
    line_px: [line.p1, line.p2],
    line_geojson: [
      pixelToLatLng(line.p1.x, line.p1.y, centerLat, centerLng, imgW, imgH, actualMpp),
      pixelToLatLng(line.p2.x, line.p2.y, centerLat, centerLng, imgW, imgH, actualMpp),
    ],
    length_px: lpx,
    length_ft: lpx * feetPerPixel,
    confidence,
  }
}

function clipLineToPolygonSegment(polygon: Pt[], line: SplitLine): SplitLine | null {
  if (polygon.length < 3) return null
  const dx = line.p2.x - line.p1.x
  const dy = line.p2.y - line.p1.y
  const len = Math.hypot(dx, dy)
  if (len <= 1e-6) return null
  const ux = dx / len
  const uy = dy / len
  const minX = Math.min(...polygon.map((p) => p.x))
  const maxX = Math.max(...polygon.map((p) => p.x))
  const minY = Math.min(...polygon.map((p) => p.y))
  const maxY = Math.max(...polygon.map((p) => p.y))
  const reach = Math.hypot(maxX - minX, maxY - minY) * 2 + len
  const extended = {
    p1: { x: line.p1.x - ux * reach, y: line.p1.y - uy * reach },
    p2: { x: line.p2.x + ux * reach, y: line.p2.y + uy * reach },
  }
  const hits: Array<{ p: Pt; t: number }> = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const hit = intersectSegments(extended.p1, extended.p2, a, b)
    if (!hit) continue
    const t = (hit.x - extended.p1.x) * ux + (hit.y - extended.p1.y) * uy
    if (!hits.some((h) => Math.hypot(h.p.x - hit.x, h.p.y - hit.y) < 2)) hits.push({ p: hit, t })
  }
  if (hits.length < 2) return null
  hits.sort((a, b) => a.t - b.t)
  return { p1: hits[0].p, p2: hits[hits.length - 1].p, votes: line.votes }
}

function synthesizeCentralRidgeFromFootprint(
  plane: RoofPlane,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
): RoofEdge | null {
  const poly = plane.polygon_px
  if (poly.length < 4) return null
  const minX = Math.min(...poly.map((p) => p.x))
  const maxX = Math.max(...poly.map((p) => p.x))
  const minY = Math.min(...poly.map((p) => p.y))
  const maxY = Math.max(...poly.map((p) => p.y))
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length
  const widthPx = maxX - minX
  const heightPx = maxY - minY
  if (Math.min(widthPx, heightPx) < 20) return null
  const inset = Math.min(widthPx, heightPx) * 0.22
  const candidate: SplitLine = widthPx >= heightPx
    ? { p1: { x: minX + inset, y: cy }, p2: { x: maxX - inset, y: cy }, votes: 1 }
    : { p1: { x: cx, y: minY + inset }, p2: { x: cx, y: maxY - inset }, votes: 1 }
  const clipped = clipLineToPolygonSegment(poly, candidate) || candidate
  if (polylineLengthPx([clipped.p1, clipped.p2]) < Math.min(widthPx, heightPx) * 0.2) return null
  return lineToRoofEdge(
    clipped,
    'ridge',
    'solar_dsm_inferred_ridge',
    centerLat,
    centerLng,
    imgW,
    imgH,
    actualMpp,
    feetPerPixel,
    0.58,
  )
}

/** Detect shared edges between adjacent planes → ridges/hips/valleys (best-effort).
 *  Plus: emit perimeter eaves/rakes for every plane edge that is NOT shared. */
function edgesFromPlanes(
  planes: RoofPlane[],
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
): RoofEdge[] {
  const out: RoofEdge[] = []
  // Tolerance scales with image size; Solar bbox polygons can be loose by ~10-15 px.
  const eps = Math.max(12, Math.round(Math.max(imgW, imgH) * 0.012))

  type Seg = { a: Pt; b: Pt; planeIdx: number }
  const allSegs: Seg[] = []
  planes.forEach((p, planeIdx) => {
    for (let i = 0; i < p.polygon_px.length; i++) {
      allSegs.push({
        a: p.polygon_px[i],
        b: p.polygon_px[(i + 1) % p.polygon_px.length],
        planeIdx,
      })
    }
  })

  const sharedFlags = new Array(allSegs.length).fill(false)
  const ridgeKeys = new Set<string>()

  // 1) Detect shared / overlapping segments between different planes
  for (let i = 0; i < allSegs.length; i++) {
    for (let j = i + 1; j < allSegs.length; j++) {
      const sa = allSegs[i]
      const sb = allSegs[j]
      if (sa.planeIdx === sb.planeIdx) continue

      const overlap = segOverlap(sa, sb, eps)
      if (!overlap) continue

      sharedFlags[i] = true
      sharedFlags[j] = true

      const key = sortedKey(overlap.a, overlap.b)
      if (ridgeKeys.has(key)) continue
      ridgeKeys.add(key)

      const lpx = polylineLengthPx([overlap.a, overlap.b])
      const azA = planes[sa.planeIdx].azimuth ?? 0
      const azB = planes[sb.planeIdx].azimuth ?? 0
      const diff = Math.abs(((azA - azB + 540) % 360) - 180)
      // Opposing planes (gable / hip ridge) → ridge; adjacent slopes → hip/valley
      const edgeType: RoofEdge['edge_type'] =
        diff < 45 ? 'ridge' : diff > 120 ? 'hip' : 'valley'

      out.push({
        edge_type: edgeType,
        source: 'plane_topology',
        line_px: [overlap.a, overlap.b],
        line_geojson: [
          pixelToLatLng(overlap.a.x, overlap.a.y, centerLat, centerLng, imgW, imgH, actualMpp),
          pixelToLatLng(overlap.b.x, overlap.b.y, centerLat, centerLng, imgW, imgH, actualMpp),
        ],
        length_px: lpx,
        length_ft: lpx * feetPerPixel,
        confidence: 0.65,
      })
    }
  }

  // 2) Every non-shared plane edge is a perimeter edge (eave or rake).
  //    Without slope direction we default to 'eave' — good enough for diagram.
  const perimSeen = new Set<string>()
  for (let i = 0; i < allSegs.length; i++) {
    if (sharedFlags[i]) continue
    const s = allSegs[i]
    const key = sortedKey(s.a, s.b)
    if (perimSeen.has(key)) continue
    perimSeen.add(key)
    const lpx = polylineLengthPx([s.a, s.b])
    out.push({
      edge_type: 'eave',
      source: 'plane_topology',
      line_px: [s.a, s.b],
      line_geojson: [
        pixelToLatLng(s.a.x, s.a.y, centerLat, centerLng, imgW, imgH, actualMpp),
        pixelToLatLng(s.b.x, s.b.y, centerLat, centerLng, imgW, imgH, actualMpp),
      ],
      length_px: lpx,
      length_ft: lpx * feetPerPixel,
      confidence: 0.55,
    })
  }

  return out
}

/** Check if two segments overlap (collinear within eps) and return the shared portion. */
function segOverlap(
  s1: { a: Pt; b: Pt },
  s2: { a: Pt; b: Pt },
  eps: number,
): { a: Pt; b: Pt } | null {
  // Direction vectors
  const v1x = s1.b.x - s1.a.x
  const v1y = s1.b.y - s1.a.y
  const len1 = Math.hypot(v1x, v1y)
  if (len1 < 1) return null
  const ux = v1x / len1
  const uy = v1y / len1

  // Project s2 endpoints onto s1 line; check perpendicular distance
  const projDist = (p: Pt) => {
    const dx = p.x - s1.a.x
    const dy = p.y - s1.a.y
    const along = dx * ux + dy * uy
    const perp = Math.abs(-dy * ux + dx * uy) // |cross|
    return { along, perp }
  }
  const p2a = projDist(s2.a)
  const p2b = projDist(s2.b)
  if (p2a.perp > eps || p2b.perp > eps) return null

  // Overlap range along s1 direction
  const lo = Math.max(0, Math.min(p2a.along, p2b.along))
  const hi = Math.min(len1, Math.max(p2a.along, p2b.along))
  if (hi - lo < Math.max(8, len1 * 0.25)) return null // need meaningful overlap

  const a: Pt = { x: s1.a.x + ux * lo, y: s1.a.y + uy * lo }
  const b: Pt = { x: s1.a.x + ux * hi, y: s1.a.y + uy * hi }
  return { a, b }
}

function ptNear(a: Pt, b: Pt, eps: number) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
}
function segMatch(s1: { a: Pt; b: Pt }, s2: { a: Pt; b: Pt }, eps: number) {
  return (
    (ptNear(s1.a, s2.a, eps) && ptNear(s1.b, s2.b, eps)) ||
    (ptNear(s1.a, s2.b, eps) && ptNear(s1.b, s2.a, eps))
  )
}
function sortedKey(a: Pt, b: Pt) {
  const [p, q] = a.x + a.y < b.x + b.y ? [a, b] : [b, a]
  return `${Math.round(p.x)},${Math.round(p.y)}|${Math.round(q.x)},${Math.round(q.y)}`
}

// ─────────────────────────────────────────────────────────────────────
// Image-based footprint extraction (Canny-lite + contour + simplify)
// Used as a fallback when Solar yields only bounding boxes.
// ─────────────────────────────────────────────────────────────────────

/** Perpendicular distance from point to segment (for Douglas–Peucker). */
function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const L2 = dx * dx + dy * dy
  if (L2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2
  const cx = a.x + t * dx, cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

function douglasPeucker(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice()
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true
      stack.push([s, idx], [idx, e])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/**
 * Extract a roof-like footprint polygon AND retain the Sobel edge magnitude
 * grid so a downstream ridge detector can run without re-decoding the image.
 *
 * Pure-TS pipeline: decode → grayscale → Sobel → Otsu threshold → flood-fill
 * connected component containing the image center → contour trace →
 * Douglas-Peucker simplify.
 *
 * Returns { footprint (image-pixel coords), mag (downsampled edge magnitude),
 * dW/dH (downsampled grid size), scale (to map back to image pixels) } or null.
 */
async function extractRoofFootprintAndEdges(
  imageUrl: string,
  imgW: number,
  imgH: number,
): Promise<
  | {
      footprint: Pt[]
      mag: Uint8Array
      blob: Uint8Array
      dW: number
      dH: number
      scaleX: number
      scaleY: number
    }
  | null
> {
  try {
    const resp = await fetch(imageUrl)
    if (!resp.ok) {
      console.warn('[footprint-extract] image fetch failed', resp.status)
      return null
    }
    const buf = new Uint8Array(await resp.arrayBuffer())

    let raster: DecodedRaster
    try {
      raster = await decodeRaster(buf, resp.headers.get('content-type'))
    } catch (e) {
      console.warn('[footprint-extract] raster decode failed', String(e))
      return null
    }
    const W = raster.width, H = raster.height
    const data = raster.data // RGBA

    // 1) Grayscale (luminance)
    const gray = new Uint8Array(W * H)
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) | 0
    }

    // Downsample 2x for speed
    const dW = Math.floor(W / 2), dH = Math.floor(H / 2)
    const ds = new Uint8Array(dW * dH)
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const sx = x * 2, sy = y * 2
        ds[y * dW + x] = (
          gray[sy * W + sx] +
          gray[sy * W + sx + 1] +
          gray[(sy + 1) * W + sx] +
          gray[(sy + 1) * W + sx + 1]
        ) >> 2
      }
    }

    // 2) Sobel edge magnitude
    const mag = new Uint8Array(dW * dH)
    let magMax = 1
    for (let y = 1; y < dH - 1; y++) {
      for (let x = 1; x < dW - 1; x++) {
        const i = y * dW + x
        const gx =
          -ds[i - dW - 1] - 2 * ds[i - 1] - ds[i + dW - 1] +
          ds[i - dW + 1] + 2 * ds[i + 1] + ds[i + dW + 1]
        const gy =
          -ds[i - dW - 1] - 2 * ds[i - dW] - ds[i - dW + 1] +
          ds[i + dW - 1] + 2 * ds[i + dW] + ds[i + dW + 1]
        const m = Math.min(255, Math.hypot(gx, gy) | 0)
        mag[i] = m
        if (m > magMax) magMax = m
      }
    }

    // 3) Otsu threshold on magnitude
    const hist = new Uint32Array(256)
    for (let i = 0; i < mag.length; i++) hist[mag[i]]++
    const total = mag.length
    let sumAll = 0
    for (let t = 0; t < 256; t++) sumAll += t * hist[t]
    let wB = 0, sumB = 0, varMax = 0, edgeT = 32
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue
      const wF = total - wB; if (!wF) break
      sumB += t * hist[t]
      const mB = sumB / wB, mF = (sumAll - sumB) / wF
      const v = wB * wF * (mB - mF) * (mB - mF)
      if (v > varMax) { varMax = v; edgeT = t }
    }
    edgeT = Math.max(20, Math.min(80, edgeT))

    const solid = new Uint8Array(dW * dH)
    for (let i = 0; i < mag.length; i++) solid[i] = mag[i] < edgeT ? 1 : 0

    // 4) Flood-fill connected component containing the image center.
    const cx0 = (dW / 2) | 0, cy0 = (dH / 2) | 0
    const visited = new Uint8Array(dW * dH)
    let seed = -1
    for (let r = 0; r < 30 && seed < 0; r++) {
      for (let dy = -r; dy <= r && seed < 0; dy++) {
        for (let dx = -r; dx <= r && seed < 0; dx++) {
          const x = cx0 + dx, y = cy0 + dy
          if (x < 0 || y < 0 || x >= dW || y >= dH) continue
          if (solid[y * dW + x]) seed = y * dW + x
        }
      }
    }
    if (seed < 0) {
      console.warn('[footprint-extract] no seed near center')
      return null
    }

    const stack = [seed]
    const blob = new Uint8Array(dW * dH)
    let count = 0
    while (stack.length) {
      const idx = stack.pop()!
      if (visited[idx]) continue
      visited[idx] = 1
      if (!solid[idx]) continue
      blob[idx] = 1; count++
      const x = idx % dW, y = (idx / dW) | 0
      if (x > 0) stack.push(idx - 1)
      if (x < dW - 1) stack.push(idx + 1)
      if (y > 0) stack.push(idx - dW)
      if (y < dH - 1) stack.push(idx + dW)
    }

    const totalArea = dW * dH
    const blobFrac = count / totalArea
    // Tightened upper bound: a single residential roof at z20 rarely exceeds
    // ~35% of the satellite tile. Anything larger almost always means the
    // flood-fill leaked into neighbors / road / tree canopy and would yield
    // an inflated sqft (e.g. 80k+ sqft "roofs").
    if (count < 400 || blobFrac < 0.02 || blobFrac > MAX_FOOTPRINT_FRAME_FRACTION) {
      console.warn(`[footprint-extract] implausible blob frac=${blobFrac.toFixed(3)} count=${count}`)
      return null
    }

    // 5) Trace contour with Moore-neighbor algorithm.
    let sx = -1, sy = -1
    outer: for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        if (blob[y * dW + x]) { sx = x; sy = y; break outer }
      }
    }
    if (sx < 0) return null

    const dirs = [
      [1, 0], [1, 1], [0, 1], [-1, 1],
      [-1, 0], [-1, -1], [0, -1], [1, -1],
    ]
    const isB = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < dW && y < dH && blob[y * dW + x] === 1

    const contour: Pt[] = [{ x: sx, y: sy }]
    let cx = sx, cy = sy, dir = 0
    const maxSteps = 8 * count
    for (let step = 0; step < maxSteps; step++) {
      let found = false
      for (let k = 0; k < 8; k++) {
        const nd = (dir + 6 + k) % 8
        const [ddx, ddy] = dirs[nd]
        const nx = cx + ddx, ny = cy + ddy
        if (isB(nx, ny)) {
          cx = nx; cy = ny; dir = nd
          contour.push({ x: cx, y: cy })
          found = true
          break
        }
      }
      if (!found) break
      if (cx === sx && cy === sy && contour.length > 4) break
    }

    if (contour.length < 8) {
      console.warn('[footprint-extract] contour too short', contour.length)
      return null
    }

    // 6) Simplify with Douglas–Peucker (~1% of image diagonal).
    const eps = Math.max(2, Math.hypot(dW, dH) * 0.01)
    const simp = douglasPeucker(contour, eps)
    const ring: Pt[] = []
    for (const p of simp) {
      const last = ring[ring.length - 1]
      if (!last || last.x !== p.x || last.y !== p.y) ring.push(p)
    }
    if (ring.length >= 4 && ring[0].x === ring[ring.length - 1].x &&
        ring[0].y === ring[ring.length - 1].y) {
      ring.pop()
    }
    if (ring.length < 4) return null

    const sxScale = imgW / dW, syScale = imgH / dH
    const footprint = ring.map((p) => ({ x: p.x * sxScale, y: p.y * syScale }))

    const footprintAreaFrac = shoelaceAreaPx(footprint) / Math.max(1, imgW * imgH)
    const touchesFrame = footprint.some((p) =>
      p.x <= FOOTPRINT_EDGE_MARGIN_PX ||
      p.y <= FOOTPRINT_EDGE_MARGIN_PX ||
      p.x >= imgW - FOOTPRINT_EDGE_MARGIN_PX ||
      p.y >= imgH - FOOTPRINT_EDGE_MARGIN_PX
    )
    if (touchesFrame || footprintAreaFrac > MAX_FOOTPRINT_FRAME_FRACTION) {
      console.warn(
        `[footprint-extract] rejected tile-frame footprint area_frac=${footprintAreaFrac.toFixed(3)} touches_frame=${touchesFrame}`,
      )
      return null
    }

    return { footprint, mag, blob, dW, dH, scaleX: sxScale, scaleY: syScale }
  } catch (e) {
    console.warn('[footprint-extract] error', String(e))
    return null
  }
}

/** Backwards-compat wrapper that returns just the footprint polygon. */
async function extractRoofFootprintFromImage(
  imageUrl: string,
  imgW: number,
  imgH: number,
): Promise<Pt[] | null> {
  const r = await extractRoofFootprintAndEdges(imageUrl, imgW, imgH)
  return r?.footprint ?? null
}

// ─────────────────────────────────────────────────────────────────────
// Ridge-first segmentation: Hough transform on Sobel edges constrained
// to the footprint blob, followed by recursive plane splitting along
// detected ridge axes.
// ─────────────────────────────────────────────────────────────────────

interface RidgeLine {
  /** Pixel-space endpoints (downsampled grid). */
  a: Pt
  b: Pt
  /** Hough vote count (proxy for support length). */
  votes: number
}

/**
 * Detect ridge candidates inside the footprint blob.
 *
 * Strategy:
 *   1. Mask edge magnitude to pixels inside the building blob (interior
 *      structure only — ignore footprint outline).
 *   2. Run a coarse Hough transform (rho/theta accumulator).
 *   3. Pick top-K peaks above a vote threshold, suppress neighbours.
 *   4. Trace each peak back to a (a,b) segment by finding the supporting
 *      edge pixels along that line.
 *
 * Coordinates are returned in IMAGE pixel space (already scaled up).
 */
function detectRidges(
  mag: Uint8Array,
  blob: Uint8Array,
  dW: number,
  dH: number,
  scaleX: number,
  scaleY: number,
): RidgeLine[] {
  // Erode blob slightly so the outline edges (which dominate Sobel response)
  // are excluded — we want INTERIOR ridges, not the perimeter.
  const inside = new Uint8Array(dW * dH)
  const erodeR = 3
  for (let y = erodeR; y < dH - erodeR; y++) {
    for (let x = erodeR; x < dW - erodeR; x++) {
      let allIn = true
      for (let dy = -erodeR; dy <= erodeR && allIn; dy++) {
        for (let dx = -erodeR; dx <= erodeR && allIn; dx++) {
          if (!blob[(y + dy) * dW + (x + dx)]) allIn = false
        }
      }
      if (allIn) inside[y * dW + x] = 1
    }
  }

  // Threshold edge mag for Hough voting: only strong interior edges.
  const interiorEdge: Pt[] = []
  let interiorMagMax = 0
  for (let i = 0; i < mag.length; i++) if (inside[i]) {
    if (mag[i] > interiorMagMax) interiorMagMax = mag[i]
  }
  const T = Math.max(40, (interiorMagMax * 0.45) | 0)
  for (let y = 0; y < dH; y++) {
    for (let x = 0; x < dW; x++) {
      const i = y * dW + x
      if (inside[i] && mag[i] >= T) interiorEdge.push({ x, y })
    }
  }
  if (interiorEdge.length < 30) {
    console.log(`[ridge-detect] insufficient interior edge pixels (${interiorEdge.length})`)
    return []
  }

  // Hough accumulator.
  const THETA_BINS = 90 // 2° per bin, 0..180°
  const diag = Math.hypot(dW, dH) | 0
  const RHO_BINS = diag * 2 + 1
  const acc = new Int32Array(THETA_BINS * RHO_BINS)
  const cosT = new Float32Array(THETA_BINS)
  const sinT = new Float32Array(THETA_BINS)
  for (let t = 0; t < THETA_BINS; t++) {
    const ang = (t / THETA_BINS) * Math.PI
    cosT[t] = Math.cos(ang)
    sinT[t] = Math.sin(ang)
  }
  for (const p of interiorEdge) {
    for (let t = 0; t < THETA_BINS; t++) {
      const rho = (p.x * cosT[t] + p.y * sinT[t]) | 0
      const ri = rho + diag
      if (ri < 0 || ri >= RHO_BINS) continue
      acc[t * RHO_BINS + ri]++
    }
  }

  // Vote threshold: a real ridge should be at least ~15% of the building's
  // shortest axis. The blob's bounding box gives us an estimate.
  let bbMinX = dW, bbMinY = dH, bbMaxX = 0, bbMaxY = 0
  for (let y = 0; y < dH; y++) {
    for (let x = 0; x < dW; x++) {
      if (blob[y * dW + x]) {
        if (x < bbMinX) bbMinX = x
        if (y < bbMinY) bbMinY = y
        if (x > bbMaxX) bbMaxX = x
        if (y > bbMaxY) bbMaxY = y
      }
    }
  }
  const bbShort = Math.min(bbMaxX - bbMinX, bbMaxY - bbMinY)
  const VOTE_MIN = Math.max(20, (bbShort * 0.4) | 0)

  // Find peaks with non-maximum suppression.
  type Peak = { t: number; r: number; v: number }
  const peaks: Peak[] = []
  for (let t = 0; t < THETA_BINS; t++) {
    for (let r = 0; r < RHO_BINS; r++) {
      const v = acc[t * RHO_BINS + r]
      if (v < VOTE_MIN) continue
      // Local max in 5x5 neighbourhood
      let isMax = true
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        for (let dr = -3; dr <= 3 && isMax; dr++) {
          if (dt === 0 && dr === 0) continue
          const nt = (t + dt + THETA_BINS) % THETA_BINS
          const nr = r + dr
          if (nr < 0 || nr >= RHO_BINS) continue
          if (acc[nt * RHO_BINS + nr] > v) isMax = false
        }
      }
      if (isMax) peaks.push({ t, r, v })
    }
  }
  peaks.sort((a, b) => b.v - a.v)
  const top = peaks.slice(0, 6)

  // For each peak, project supporting interior-edge pixels onto the line
  // and take the [min, max] along the line direction as the segment.
  const ridges: RidgeLine[] = []
  for (const pk of top) {
    const ang = (pk.t / THETA_BINS) * Math.PI
    const c = Math.cos(ang), s = Math.sin(ang)
    const rho = pk.r - diag
    // Direction along the line is (-sin, cos)
    const ux = -s, uy = c
    let lo = Infinity, hi = -Infinity
    let loPt: Pt | null = null, hiPt: Pt | null = null
    const PERP_TOL = 1.5
    for (const p of interiorEdge) {
      const dPerp = Math.abs(p.x * c + p.y * s - rho)
      if (dPerp > PERP_TOL) continue
      const along = p.x * ux + p.y * uy
      if (along < lo) { lo = along; loPt = p }
      if (along > hi) { hi = along; hiPt = p }
    }
    if (!loPt || !hiPt) continue
    const segLen = hi - lo
    // Reject ridge candidates that are too short (< 25% of building short axis).
    if (segLen < bbShort * 0.25) continue
    // Reject candidates whose midpoint is outside the blob (ridges must be inside).
    const mx = (loPt.x + hiPt.x) / 2 | 0
    const my = (loPt.y + hiPt.y) / 2 | 0
    if (mx < 0 || my < 0 || mx >= dW || my >= dH || !blob[my * dW + mx]) continue

    ridges.push({
      a: { x: loPt.x * scaleX, y: loPt.y * scaleY },
      b: { x: hiPt.x * scaleX, y: hiPt.y * scaleY },
      votes: pk.v,
    })
  }

  // Suppress nearly-collinear duplicates (theta within 6°, rho within 5% of diag).
  const out: RidgeLine[] = []
  for (const r of ridges) {
    const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y
    const ang = Math.atan2(dy, dx)
    let dup = false
    for (const o of out) {
      const ox = o.b.x - o.a.x, oy = o.b.y - o.a.y
      const oAng = Math.atan2(oy, ox)
      const dAng = Math.abs(((ang - oAng + Math.PI * 1.5) % Math.PI) - Math.PI / 2)
      if (dAng < (6 * Math.PI) / 180) {
        // similar orientation; check distance between midpoints
        const mxA = (r.a.x + r.b.x) / 2, myA = (r.a.y + r.b.y) / 2
        const mxB = (o.a.x + o.b.x) / 2, myB = (o.a.y + o.b.y) / 2
        if (Math.hypot(mxA - mxB, myA - myB) < Math.max(dW, dH) * 0.06 * Math.max(scaleX, scaleY)) {
          dup = true; break
        }
      }
    }
    if (!dup) out.push(r)
  }

  console.log(`[ridge-detect] found ${out.length} ridge candidates (votes: ${out.map((r) => r.votes).join(',')})`)
  return out
}

/** Build a single roof plane from an extracted footprint polygon. */
function planeFromFootprint(
  polyPx: Pt[],
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
  pitchHintRise: number | null,
  azimuthHint: number | null,
  source = 'image_footprint_extraction',
  planeIndex = 0,
): RoofPlane {
  const polyGeo = polyPx.map((p) =>
    pixelToLatLng(p.x, p.y, centerLat, centerLng, imgW, imgH, actualMpp),
  )
  const areaPxFlat = shoelaceAreaPx(polyPx)
  const area2dSqft = areaPxFlat * feetPerPixel * feetPerPixel
  const pmInfo =
    pitchHintRise != null
      ? pitchInfo(pitchHintRise)
      : { pitch_degrees: 0, pitch_multiplier: 1 }
  return {
    plane_index: planeIndex,
    source,
    polygon_px: polyPx,
    polygon_geojson: polyGeo,
    pitch: pitchHintRise,
    pitch_degrees: pmInfo.pitch_degrees,
    azimuth: azimuthHint,
    area_2d_sqft: area2dSqft,
    pitch_multiplier: pmInfo.pitch_multiplier,
    area_pitch_adjusted_sqft: area2dSqft * pmInfo.pitch_multiplier,
    confidence: source === 'image_footprint_extraction' ? 0.6 : 0.7,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Quality checks → status
// ─────────────────────────────────────────────────────────────────────

interface QC {
  check_name: string
  passed: boolean
  score: number
  details: any
}

/** Detects axis-aligned 4-corner rectangles. Google Solar boundingBox planes
 *  are always axis-aligned rectangles — that's the literal "two boxes" tell. */
function isAxisAlignedRectangle(poly: Pt[]): boolean {
  if (!poly || poly.length !== 4) return false
  const [a, b, c, d] = poly
  const horiz = (p: Pt, q: Pt) => Math.abs(p.y - q.y) < 0.5
  const vert = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 0.5
  return (
    (horiz(a, b) && vert(b, c) && horiz(c, d) && vert(d, a)) ||
    (vert(a, b) && horiz(b, c) && vert(c, d) && horiz(d, a))
  )
}

/** Structural overlay alignment 0..1: planes inside the image and centered. */
function computeOverlayAlignment(planes: RoofPlane[], imgW: number, imgH: number): number {
  if (!planes.length || imgW <= 0 || imgH <= 0) return 0
  let allInside = true
  let cx = 0, cy = 0, n = 0
  for (const p of planes) {
    for (const pt of p.polygon_px) {
      if (pt.x < 0 || pt.x > imgW || pt.y < 0 || pt.y > imgH) allInside = false
      cx += pt.x; cy += pt.y; n++
    }
  }
  if (n === 0) return 0
  cx /= n; cy /= n
  const dx = Math.abs(cx - imgW / 2) / imgW
  const dy = Math.abs(cy - imgH / 2) / imgH
  const offset = Math.sqrt(dx * dx + dy * dy)
  const centerScore = Math.max(0, 1 - offset / 0.25)
  const insideScore = allInside ? 1 : 0.4
  return Math.min(1, 0.6 * centerScore + 0.4 * insideScore)
}

const PLACEHOLDER_SOURCES = new Set(['google_solar_bbox', 'placeholder', 'perimeter_fallback'])
const FOOTPRINT_ONLY_SOURCES = new Set([
  'image_footprint_extraction',
  'mapbox_vector',
  'osm_buildings',
  'microsoft_buildings',
  'google_solar_aggregate',
])

function normalizeRoofMeasurementFootprintSource(source: string | null | undefined, solarOk: boolean): string {
  const s = String(source || '').toLowerCase()
  if (s === 'mapbox_vector') return 'mapbox_vector'
  if (s === 'osm_buildings') return 'osm'
  if (s === 'microsoft_buildings') return 'microsoft_buildings'
  if (s === 'esri_buildings') return 'esri_buildings'
  if (s.includes('google_solar') || s.includes('solar')) return 'google_solar_api'
  if (s === 'manual_trace' || s === 'manual_entry' || s === 'imported' || s === 'user_drawn') return s
  if (s.includes('image_footprint') || s.includes('ridge_split') || s === 'geometry_first_v2') return 'ai_detection'
  return solarOk ? 'google_solar_api' : 'ai_detection'
}

function lineGeoToWkt(points: GeoPt[]): string | null {
  if (!Array.isArray(points) || points.length < 2) return null
  const pairs = points
    .map((p) => `${Number(p.lng)} ${Number(p.lat)}`)
    .filter((pair) => !pair.includes('NaN'))
  return pairs.length >= 2 ? `LINESTRING(${pairs.join(', ')})` : null
}

function runQualityChecks(input: {
  geocoded: boolean
  geocodeType: string | null
  calibrated: boolean
  mapboxOk: boolean
  imageryOk?: boolean
  imagerySource?: string
  solarOk: boolean
  planes: RoofPlane[]
  edges: RoofEdge[]
  imgW: number
  imgH: number
  totalAreaSqft: number
  hasPitch: boolean
  hasPlaceholder: boolean
}): {
  checks: QC[]
  overall: number
  status: 'completed' | 'needs_review' | 'needs_internal_review'
  overlayAlignmentScore: number
  geometrySourceIsReal: boolean
  planesAreAllRectangles: boolean
  singlePlaneFallback: boolean
} {
  const checks: QC[] = []
  const push = (n: string, ok: boolean, s: number, d: any = {}) =>
    checks.push({ check_name: n, passed: ok, score: s, details: d })

  push('valid_geocode', input.geocoded, input.geocoded ? 1 : 0, { type: input.geocodeType })
  push('valid_calibration', input.calibrated, input.calibrated ? 1 : 0)
  const _imageryOk = input.imageryOk ?? input.mapboxOk
  push('imagery_available', _imageryOk, _imageryOk ? 1 : 0, { provider: input.imagerySource ?? (input.mapboxOk ? 'mapbox' : 'none') })
  push('google_solar_available', input.solarOk, input.solarOk ? 1 : 0.5, { note: 'optional' })
  push('roof_planes_exist', input.planes.length > 0, input.planes.length > 0 ? 1 : 0, {
    count: input.planes.length,
  })

  const allInside = input.planes.every((p) =>
    p.polygon_px.every((pt) => pt.x >= 0 && pt.x <= input.imgW && pt.y >= 0 && pt.y <= input.imgH),
  )
  push('footprint_inside_image', allInside, allInside ? 1 : 0)

  const noSelfInt = input.planes.every((p) => !hasSelfIntersection(p.polygon_px))
  push('no_self_intersections', noSelfInt, noSelfInt ? 1 : 0)

  const reasonable = input.totalAreaSqft >= 200 && input.totalAreaSqft <= MAX_AUTO_ROOF_AREA_SQFT
  push('area_reasonable', reasonable, reasonable ? 1 : 0, { sqft: input.totalAreaSqft })

  push('pitch_data_available', input.hasPitch, input.hasPitch ? 1 : 0)
  push('line_features_available', input.edges.length > 0, input.edges.length > 0 ? 1 : 0)

  const avgConf =
    input.planes.length > 0
      ? input.planes.reduce((s, p) => s + p.confidence, 0) / input.planes.length
      : 0
  push('avg_plane_confidence', avgConf >= 0.5, avgConf, { avg: avgConf })

  push('source_is_not_placeholder', !input.hasPlaceholder, input.hasPlaceholder ? 0 : 1)

  // ── HARD GEOMETRY-SOURCE GATE ─────────────────────────────────────
  // Reject any result whose only geometry comes from Solar bbox / placeholder /
  // perimeter fallback. These are not real facets.
  const realPlanes = input.planes.filter((p) => !PLACEHOLDER_SOURCES.has(String(p.source)))
  const geometrySourceIsReal = realPlanes.length > 0
  push('geometry_source_is_real', geometrySourceIsReal, geometrySourceIsReal ? 1 : 0, {
    real_plane_count: realPlanes.length,
    total_plane_count: input.planes.length,
  })

  // Reject the literal fake-facet case: multiple bbox/placeholder rectangles.
  // A single image-extracted rectangle can be a valid simple footprint fallback,
  // so it must not be treated as the old "two rectangles" failure mode.
  const rectCount = input.planes.filter((p) => isAxisAlignedRectangle(p.polygon_px)).length
  const rectangleSourcesAreSynthetic = input.planes.every((p) =>
    PLACEHOLDER_SOURCES.has(String(p.source)) || p.source === 'google_solar_bbox'
  )
  const planesAreAllRectangles =
    input.planes.length > 1 &&
    rectCount === input.planes.length &&
    rectangleSourcesAreSynthetic
  push('planes_are_not_all_rectangles', !planesAreAllRectangles, planesAreAllRectangles ? 0 : 1, {
    rect_count: rectCount,
    total: input.planes.length,
    synthetic_sources_only: rectangleSourcesAreSynthetic,
  })

  const overlayAlignmentScore = computeOverlayAlignment(input.planes, input.imgW, input.imgH)
  push(
    'overlay_alignment_score',
    overlayAlignmentScore >= 0.75,
    overlayAlignmentScore,
    { score: overlayAlignmentScore, threshold: 0.75 },
  )

  // Single-plane fallback (image-only footprint, no facet segmentation):
  // we recovered a real roof outline but cannot prove interior ridges/valleys.
  // Per spec: emit one plane using Solar pitch hint and downgrade to needs_review.
  // Never auto-complete this case — it must be reviewed internally before a
  // customer-ready report is produced.
  const singlePlaneFallback =
    input.planes.length === 1 &&
    FOOTPRINT_ONLY_SOURCES.has(String(input.planes[0].source))
  push('multi_facet_segmentation', !singlePlaneFallback, singlePlaneFallback ? 0.5 : 1, {
    note: singlePlaneFallback
      ? 'Single image-extracted footprint; no interior facets resolved.'
      : 'ok',
  })

  const overall = checks.reduce((s, c) => s + c.score, 0) / checks.length
  let status: 'completed' | 'needs_review' | 'needs_internal_review'
  // Absolute sanity cap on total roof area. A residential satellite tile at
  // z20 cannot legitimately produce >30k sqft of roof — anything beyond means
  // the footprint extractor leaked into neighbors / road / canopy.
  const areaWithinHardCap = input.totalAreaSqft > 0 && input.totalAreaSqft <= MAX_AUTO_ROOF_AREA_SQFT
  if (
    input.hasPlaceholder ||
    !input.calibrated ||
    !_imageryOk ||
    input.planes.length === 0 ||
    !geometrySourceIsReal ||
    planesAreAllRectangles ||
    !allInside ||
    !areaWithinHardCap
  ) {
    status = 'needs_internal_review'
  } else if (singlePlaneFallback || overlayAlignmentScore < 0.75) {
    // Real footprint, but no facet split — never auto-complete.
    status = 'needs_review'
  } else if (overall >= 0.85 && overlayAlignmentScore >= 0.85) {
    status = 'completed'
  } else if (overall >= 0.65) {
    status = 'needs_review'
  } else {
    status = 'needs_internal_review'
  }
  return {
    checks,
    overall,
    status,
    overlayAlignmentScore,
    geometrySourceIsReal,
    planesAreAllRectangles,
    singlePlaneFallback,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Property resolution from lead/project
// ─────────────────────────────────────────────────────────────────────

async function resolveProperty(
  supa: any,
  payload: {
    lead_id?: string | null
    project_id?: string | null
    pipelineEntryId?: string | null
    address?: string | null
    lat?: number | null
    lng?: number | null
  },
) {
  const leadId = payload.lead_id || payload.pipelineEntryId || null
  const projectId = payload.project_id || null
  let address = payload.address || null
  let lat = payload.lat ?? null
  let lng = payload.lng ?? null
  let tenantId: string | null = null
  let sourceType: 'lead' | 'project' | null = null
  let sourceId: string | null = null

  if (leadId) {
    sourceType = 'lead'
    sourceId = leadId
    const { data: lead } = await supa
      .from('pipeline_entries')
      .select('id, tenant_id, contact_id, metadata')
      .eq('id', leadId)
      .maybeSingle()
    if (lead) {
      tenantId = lead.tenant_id
      const verified = lead.metadata?.verified_address
      if (!address && verified?.formatted_address) address = verified.formatted_address
      if (lat == null && verified?.geometry?.location?.lat != null) lat = Number(verified.geometry.location.lat)
      if (lng == null && verified?.geometry?.location?.lng != null) lng = Number(verified.geometry.location.lng)
      if (lead.contact_id) {
        const { data: c } = await supa
          .from('contacts')
          .select(
            'address, address_line_1, city, state, zip_code, latitude, longitude',
          )
          .eq('id', lead.contact_id)
          .maybeSingle()
        if (c) {
          if (!address)
            address =
              c.address ||
              [c.address_line_1, c.city, c.state, c.zip_code]
                .filter(Boolean)
                .join(', ')
          if (lat == null && c.latitude != null) lat = Number(c.latitude)
          if (lng == null && c.longitude != null) lng = Number(c.longitude)
        }
      }
    }
  } else if (projectId) {
    sourceType = 'project'
    sourceId = projectId
    const { data: proj } = await supa
      .from('projects')
      .select('id, tenant_id, address, latitude, longitude')
      .eq('id', projectId)
      .maybeSingle()
    if (proj) {
      tenantId = proj.tenant_id
      if (!address) address = proj.address
      if (lat == null && proj.latitude != null) lat = Number(proj.latitude)
      if (lng == null && proj.longitude != null) lng = Number(proj.longitude)
    }
  }

  return { tenantId, sourceType, sourceId, leadId, projectId, address, lat, lng }
}

// ─────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const body = await req.json()
    // Backwards-compat: accept old (pipelineEntryId) and new (lead_id/project_id) shapes
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const resolved = await resolveProperty(supa, body)

    if (!resolved.tenantId || !resolved.sourceType || !resolved.sourceId) {
      return new Response(
        JSON.stringify({ error: 'lead_id or project_id required and must resolve' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const sourceButton = body.source_button || 'AI Measurement'
    const wasteFactor = Number(body.waste_factor_percent ?? 10)
    const pitchOverride = body.pitchOverride || body.pitch_override || null

    // 1) Insert measurement_jobs (UI polling) + ai_measurement_jobs (audit)
    const { data: aiJob, error: aiErr } = await supa
      .from('ai_measurement_jobs')
      .insert({
        tenant_id: resolved.tenantId,
        lead_id: resolved.leadId,
        project_id: resolved.projectId,
        source_record_type: resolved.sourceType,
        source_record_id: resolved.sourceId,
        source_button: sourceButton,
        property_address: resolved.address || body.address || 'Unknown Address',
        latitude: resolved.lat,
        longitude: resolved.lng,
        status: 'queued',
        status_message: 'Queued for geometry_first_v2',
        waste_factor_percent: wasteFactor,
        engine_version: ENGINE_VERSION,
      })
      .select('id')
      .single()
    if (aiErr) throw aiErr

    const { data: job, error: jobErr } = await supa
      .from('measurement_jobs')
      .insert({
        tenant_id: resolved.tenantId,
        pipeline_entry_id: resolved.leadId,
        lead_id: resolved.leadId,
        project_id: resolved.projectId,
        source_record_type: resolved.sourceType,
        source_record_id: resolved.sourceId,
        source_button: sourceButton,
        ai_measurement_job_id: aiJob.id,
        engine_version: ENGINE_VERSION,
        user_id: body.userId || null,
        status: 'queued',
        progress_message: 'Queued — geometry_first_v2',
        lat: resolved.lat,
        lng: resolved.lng,
        address: resolved.address || body.address || 'Unknown Address',
        pitch_override: pitchOverride,
      })
      .select('id')
      .single()
    if (jobErr) throw jobErr

    // 2) Background processing
    const run = async () => {
      const startIso = new Date().toISOString()
      try {
        await supa
          .from('measurement_jobs')
          .update({ status: 'processing', progress_message: 'Resolving property…', started_at: startIso, updated_at: startIso })
          .eq('id', job.id)
        await supa
          .from('ai_measurement_jobs')
          .update({ status: 'processing', status_message: 'Resolving property…', started_at: startIso, updated_at: startIso })
          .eq('id', aiJob.id)

        // 2a) Geocode if needed
        let lat = resolved.lat,
          lng = resolved.lng,
          geocodeType: string | null = lat != null && lng != null ? 'CLIENT_PROVIDED' : null
        let geocoded = lat != null && lng != null
        if ((lat == null || lng == null) && resolved.address) {
          const g = await geocodeAddress(resolved.address)
          if (g) {
            lat = g.lat
            lng = g.lng
            geocodeType = g.location_type
            geocoded = true
          }
        }
        if (lat == null || lng == null) throw new Error('Could not resolve coordinates for property')

        // 2b) Imagery + calibration (provider-agnostic: Mapbox → Google Static fallback)
        await supa.from('measurement_jobs').update({ progress_message: 'Pulling satellite imagery…' }).eq('id', job.id)
        const analysisZoom = 20
        const logicalW = 640
        const logicalH = 640
        const imagery = await fetchPreferredBaseImagery(lat, lng, analysisZoom, logicalW, logicalH)
        const imageryOk = !!imagery?.rgba?.length
        const imagerySource: 'mapbox' | 'google_static' | 'none' = imagery?.provider ?? 'none'
        // Back-compat shim: many downstream code paths reference `mb` and `mapboxOk`.
        const mb = imagery
          ? {
              image_url: imagery.imageUrl,
              logical_w: imagery.logicalWidth,
              logical_h: imagery.logicalHeight,
              actual_w: imagery.width,
              actual_h: imagery.height,
              raster_scale: imagery.rasterScale,
              zoom: imagery.zoom,
            }
          : null
        const mapboxOk = imagerySource === 'mapbox'
        const zoom = mb?.zoom ?? analysisZoom
        const rasterScale = mb?.raster_scale ?? 2
        const imgW = mb?.actual_w ?? logicalW * 2
        const imgH = mb?.actual_h ?? logicalH * 2
        const cal = calibrate(lat, zoom, rasterScale)
        const feetPerPixel = cal.feet_per_pixel_actual

        console.info('[ai-measurement][imagery]', {
          source: imagerySource,
          imageryOk,
          rasterW: imgW,
          rasterH: imgH,
          logicalW,
          logicalH,
          zoom: analysisZoom,
        })

        if (mb) {
          await supa.from('ai_measurement_images').insert({
            job_id: aiJob.id,
            source: imagerySource,
            image_url: mb.image_url,
            width: mb.actual_w,
            height: mb.actual_h,
            zoom: mb.zoom,
            meters_per_pixel: cal.meters_per_pixel_actual,
            feet_per_pixel: feetPerPixel,
            calibration: {
              meters_per_pixel_logical: cal.meters_per_pixel_logical,
              meters_per_pixel_actual: cal.meters_per_pixel_actual,
              feet_per_pixel_actual: feetPerPixel,
              raster_scale: rasterScale,
              logical_w: mb.logical_w,
              logical_h: mb.logical_h,
            },
            is_primary: true,
          })
        }

        await supa
          .from('ai_measurement_jobs')
          .update({
            latitude: lat,
            longitude: lng,
            geocode_location_type: geocodeType,
            logical_image_width: mb?.logical_w ?? null,
            logical_image_height: mb?.logical_h ?? null,
            actual_image_width: imgW,
            actual_image_height: imgH,
            raster_scale: rasterScale,
          })
          .eq('id', aiJob.id)

        // 2c) Google Solar
        await supa.from('measurement_jobs').update({ progress_message: 'Fetching Google Solar data…' }).eq('id', job.id)
        const solar = await fetchGoogleSolar(lat, lng)
        const solarOk = !!solar?.solarPotential?.roofSegmentStats?.length

        // 2d) Build planes
        let planes: RoofPlane[] = solarOk
          ? planesFromSolar(solar, lat, lng, imgW, imgH, cal.meters_per_pixel_actual, feetPerPixel)
          : []

        const onlyBboxPlanes =
          planes.length > 0 && planes.every((p) => p.source === 'google_solar_bbox')
        const allRectangles =
          planes.length > 0 && planes.every((p) => isAxisAlignedRectangle(p.polygon_px))
        const needsRealGeometry = planes.length === 0 || onlyBboxPlanes || allRectangles

        const solarAreaHintSqft =
          (Number(solar?.solarPotential?.wholeRoofStats?.areaMeters2 || 0) * 10.7639) ||
          (
            (Array.isArray(solar?.solarPotential?.roofSegmentStats)
              ? solar.solarPotential.roofSegmentStats
              : []
            ).reduce((s: number, seg: any) => s + Number(seg?.stats?.areaMeters2 || 0), 0) * 10.7639
          )
        let detectedRidgeLines: SplitLine[] = []

        if (needsRealGeometry) {
          const hint =
            planes.length > 0
              ? [...planes].sort((a, b) => b.area_pitch_adjusted_sqft - a.area_pitch_adjusted_sqft)[0]
              : null

          // First deterministic fallback: authoritative vector building footprints.
          const authoritative = await resolveAuthoritativeFootprint(lat, lng, solarAreaHintSqft)
          let extractedImageGeometry: Awaited<ReturnType<typeof extractRoofFootprintAndEdges>> | null = null
          if (mb?.image_url) {
            try {
              extractedImageGeometry = await extractRoofFootprintAndEdges(mb.image_url, imgW, imgH)
            } catch (err) {
              console.warn('[start-ai-measurement] image footprint pre-extract failed:', err)
            }
          }

          const selectedAuthoritative =
            authoritative && !(isLowDetailAuthoritativeFootprint(authoritative) && extractedImageGeometry?.footprint?.length >= 4)
              ? authoritative
              : null
          if (authoritative && !selectedAuthoritative) {
            console.log('[start-ai-measurement] rejected low-detail authoritative footprint; using image-traced roof edge geometry')
          }

          if (selectedAuthoritative) {
            const basePlane = planeFromAuthoritativeFootprint(
              selectedAuthoritative,
              lat,
              lng,
              imgW,
              imgH,
              cal.meters_per_pixel_actual,
              hint?.pitch ?? null,
              hint?.azimuth ?? null,
              0,
            )
            planes = [basePlane]
            console.log(
              `[start-ai-measurement] using authoritative footprint fallback: ${selectedAuthoritative.source}`
            )

            // Try to split the authoritative footprint into multiple planes using
            // image-derived ridge detection so we can recover ridge/hip/valley edges
            // (a single plane only yields perimeter eaves via topology).
            if (extractedImageGeometry || mb?.image_url) {
              try {
                const extracted = extractedImageGeometry ?? await extractRoofFootprintAndEdges(mb!.image_url, imgW, imgH)
                if (extracted) {
                  const rawRidges = detectRidges(
                    extracted.mag,
                    extracted.blob,
                    extracted.dW,
                    extracted.dH,
                    extracted.scaleX,
                    extracted.scaleY,
                  )
                  const ridges = filterStrongRidges(rawRidges)
                  const ridgeLines: SplitLine[] = ridges
                    .sort((a, b) => b.votes - a.votes)
                    .map((r) => ({ p1: r.a, p2: r.b, votes: r.votes }))
                  detectedRidgeLines = ridgeLines

                  if (ridgeLines.length > 0) {
                    const minPlaneAreaPx = Math.max(
                      25,
                      shoelaceAreaPx(basePlane.polygon_px) * 0.08,
                    )
                    const subPolys = buildRoofPlanes(basePlane.polygon_px, ridgeLines, {
                      minArea: minPlaneAreaPx,
                      minAreaRatio: 0.1,
                      maxPlanes: 10,
                    })
                    if (subPolys.length > 1) {
                      planes = subPolys.map((poly, idx) =>
                        planeFromFootprint(
                          poly,
                          lat,
                          lng,
                          imgW,
                          imgH,
                          cal.meters_per_pixel_actual,
                          feetPerPixel,
                          hint?.pitch ?? null,
                          hint?.azimuth ?? null,
                          'authoritative_footprint_ridge_split',
                          idx,
                        ),
                      )
                      console.log(
                        `[start-ai-measurement] authoritative footprint split with image ridges: ${ridges.length} ridges → ${planes.length} planes`,
                      )
                    } else {
                      console.log(
                        `[start-ai-measurement] ridge split produced ${subPolys.length} polys; keeping single authoritative plane`,
                      )
                    }
                  } else {
                    console.log(
                      `[start-ai-measurement] no strong ridges detected on authoritative footprint (raw=${rawRidges.length})`,
                    )
                  }
                }
              } catch (err) {
                console.warn('[start-ai-measurement] ridge split on authoritative footprint failed:', err)
              }
            }
          } else if (extractedImageGeometry || mb?.image_url) {
            // Secondary fallback only when no authoritative footprint is available:
            // image-derived footprint + optional pure-TS ridge split.
            await supa
              .from('measurement_jobs')
              .update({ progress_message: 'Extracting roof footprint + ridges from imagery…' })
              .eq('id', job.id)

            const extracted = extractedImageGeometry ?? await extractRoofFootprintAndEdges(mb!.image_url, imgW, imgH)
            if (extracted && extracted.footprint.length >= 4) {
              const rawRidges = detectRidges(
                extracted.mag,
                extracted.blob,
                extracted.dW,
                extracted.dH,
                extracted.scaleX,
                extracted.scaleY,
              )
              const ridges = filterStrongRidges(rawRidges)
              const ridgeLines: SplitLine[] = ridges
                .sort((a, b) => b.votes - a.votes)
                .map((r) => ({ p1: r.a, p2: r.b, votes: r.votes }))
              detectedRidgeLines = ridgeLines

              const minPlaneAreaPx = Math.max(25, shoelaceAreaPx(extracted.footprint) * 0.08)
              const subPolys =
                ridgeLines.length > 0
                  ? buildRoofPlanes(extracted.footprint, ridgeLines, {
                      minArea: minPlaneAreaPx,
                      minAreaRatio: 0.1,
                      maxPlanes: 10,
                    })
                  : [extracted.footprint]

              const isMultiPlane = subPolys.length > 1
              const planeSource = isMultiPlane
                ? 'image_footprint_ridge_split'
                : 'image_footprint_extraction'

              planes = subPolys.map((poly, idx) =>
                planeFromFootprint(
                  poly,
                  lat,
                  lng,
                  imgW,
                  imgH,
                  cal.meters_per_pixel_actual,
                  feetPerPixel,
                  hint?.pitch ?? null,
                  hint?.azimuth ?? null,
                  planeSource,
                  idx,
                ),
              )

              console.log(
                `[start-ai-measurement] image fallback used: footprint=${extracted.footprint.length}pts raw_ridges=${rawRidges.length} strong_ridges=${ridges.length} planes=${planes.length}`
              )
            } else {
              const aggregate = solarOk
                ? solarAggregatePlane(
                    solar,
                    lat,
                    lng,
                    imgW,
                    imgH,
                    cal.meters_per_pixel_actual,
                    hint?.pitch ?? null,
                    hint?.azimuth ?? null,
                  )
                : null
              if (aggregate) {
                planes = [aggregate]
                console.warn('[start-ai-measurement] authoritative/image extraction unavailable; publishing Google Solar aggregate as needs_review')
              } else {
                console.warn('[start-ai-measurement] no authoritative footprint and image extraction failed; keeping placeholder planes for QC reject')
              }
            }
          }
        }

        // 2e) Apply pitch override (single rise replaces per-plane pitch)
        if (pitchOverride) {
          const r = parseFloat(String(pitchOverride).split('/')[0])
          if (Number.isFinite(r)) {
            const pi = pitchInfo(r)
            for (const p of planes) {
              p.pitch = r
              p.pitch_degrees = pi.pitch_degrees
              p.pitch_multiplier = pi.pitch_multiplier
              p.area_pitch_adjusted_sqft = p.area_2d_sqft * pi.pitch_multiplier
            }
          }
        }

        // 2f) Edges from topology + perimeter fallback
        let edges: RoofEdge[] = edgesFromPlanes(
          planes, lat, lng, imgW, imgH, cal.meters_per_pixel_actual, feetPerPixel,
        )
        if (planes.length > 0 && !edges.some((e) => e.edge_type === 'ridge')) {
          const largest = [...planes].sort((a, b) => b.area_2d_sqft - a.area_2d_sqft)[0]
          const clippedDetected = detectedRidgeLines
            .map((line) => clipLineToPolygonSegment(largest.polygon_px, line))
            .filter((line): line is SplitLine => !!line)
            .sort((a, b) => polylineLengthPx([b.p1, b.p2]) - polylineLengthPx([a.p1, a.p2]))[0]
          const ridgeEdge = clippedDetected
            ? lineToRoofEdge(
                clippedDetected,
                'ridge',
                'image_detected_ridge',
                lat,
                lng,
                imgW,
                imgH,
                cal.meters_per_pixel_actual,
                feetPerPixel,
                0.68,
              )
            : synthesizeCentralRidgeFromFootprint(
                largest,
                lat,
                lng,
                imgW,
                imgH,
                cal.meters_per_pixel_actual,
                feetPerPixel,
              )
          if (ridgeEdge) {
            edges.push(ridgeEdge)
            console.log(`[start-ai-measurement] added ${ridgeEdge.source} because topology emitted no ridge`)
          }
        }
        if (edges.length === 0 && planes.length > 0) {
          // Use first (largest) plane perimeter as fallback eaves
          const largest = [...planes].sort((a, b) => b.area_2d_sqft - a.area_2d_sqft)[0]
          edges = edgesFromPerimeter(
            largest.polygon_px, lat, lng, imgW, imgH, cal.meters_per_pixel_actual, feetPerPixel,
          )
        }

        // 2g) Persist planes + edges
        if (planes.length > 0) {
          await supa.from('ai_roof_planes').insert(
            planes.map((p) => ({
              job_id: aiJob.id,
              plane_index: p.plane_index,
              source: p.source,
              polygon_px: p.polygon_px,
              polygon_geojson: p.polygon_geojson,
              pitch: p.pitch,
              pitch_degrees: p.pitch_degrees,
              azimuth: p.azimuth,
              area_2d_sqft: p.area_2d_sqft,
              pitch_multiplier: p.pitch_multiplier,
              area_pitch_adjusted_sqft: p.area_pitch_adjusted_sqft,
              confidence: p.confidence,
            })),
          )
        }
        if (edges.length > 0) {
          await supa.from('ai_roof_edges').insert(
            edges.map((e) => ({
              job_id: aiJob.id,
              edge_type: e.edge_type,
              source: e.source,
              line_px: e.line_px,
              line_geojson: e.line_geojson,
              length_px: e.length_px,
              length_ft: e.length_ft,
              confidence: e.confidence,
            })),
          )
        }

        // 2h) Aggregate results
        const totalArea2d = planes.reduce((s, p) => s + p.area_2d_sqft, 0)
        const totalAreaSloped = planes.reduce((s, p) => s + p.area_pitch_adjusted_sqft, 0)
        const exceedsPublishableArea = totalAreaSloped > MAX_AUTO_ROOF_AREA_SQFT || totalArea2d > MAX_AUTO_ROOF_AREA_SQFT
        const sumByEdge = (t: RoofEdge['edge_type']) =>
          edges.filter((e) => e.edge_type === t).reduce((s, e) => s + e.length_ft, 0)
        const ridge_ft = sumByEdge('ridge')
        const hip_ft = sumByEdge('hip')
        const valley_ft = sumByEdge('valley')
        const eave_ft = sumByEdge('eave')
        const rake_ft = sumByEdge('rake')
        const perimeter_ft = eave_ft + rake_ft

        // Dominant pitch (area-weighted)
        let dominantPitch: string | null = null
        if (planes.length > 0) {
          const buckets = new Map<number, number>()
          for (const p of planes) {
            if (p.pitch == null) continue
            const r = Math.round(p.pitch)
            buckets.set(r, (buckets.get(r) || 0) + p.area_2d_sqft)
          }
          if (buckets.size > 0) {
            const [r] = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0]
            dominantPitch = `${r}/12`
          }
        }
        if (!dominantPitch && pitchOverride) dominantPitch = pitchOverride
        if (!dominantPitch) dominantPitch = '6/12'

        const roofSquares = totalAreaSloped / 100
        const wasteSquares = roofSquares * (1 + wasteFactor / 100)

        const hasPlaceholder = planes.length === 0 // never publish placeholder

        // 2i) Quality checks
        const qc = runQualityChecks({
          geocoded,
          geocodeType,
          calibrated: imageryOk,
          mapboxOk,
          imageryOk,
          imagerySource,
          solarOk,
          planes,
          edges,
          imgW,
          imgH,
          totalAreaSqft: totalAreaSloped,
          hasPitch: planes.some((p) => p.pitch != null) || !!pitchOverride,
          hasPlaceholder,
        })

        await supa.from('ai_measurement_quality_checks').insert(
          qc.checks.map((c) => ({
            job_id: aiJob.id,
            check_name: c.check_name,
            passed: c.passed,
            score: c.score,
            details: c.details,
          })),
        )

        // Build a footprint WKT (union hull of all plane geo points) so the
        // frontend never prints "No WKT geometry available".
        let footprintWkt: string | null = null
        try {
          const allGeo: GeoPt[] = []
          for (const p of planes) {
            for (const g of (p.polygon_geojson as GeoPt[]) || []) allGeo.push(g)
          }
          if (allGeo.length >= 3) {
            // Simple convex-hull-ish: order points around centroid (good enough
            // for a coarse property footprint diagnostic — not load-bearing).
            const cx = allGeo.reduce((s, p) => s + p.lng, 0) / allGeo.length
            const cy = allGeo.reduce((s, p) => s + p.lat, 0) / allGeo.length
            const ordered = [...allGeo].sort(
              (a, b) => Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx),
            )
            const ring = [...ordered, ordered[0]]
              .map((p) => `${p.lng} ${p.lat}`)
              .join(', ')
            footprintWkt = `POLYGON((${ring}))`
          }
        } catch (_e) { /* non-fatal */ }

        const planeSources = Array.from(new Set(planes.map((p) => String(p.source))))
        const geometrySource =
          planeSources.length === 0
            ? 'none'
            : planeSources.every((s) => PLACEHOLDER_SOURCES.has(s))
            ? 'google_solar_bbox'
            : planeSources.length === 1
            ? planeSources[0]
            : 'mixed'

        const reportJson = {
          engine: ENGINE_VERSION,
          generated_at: new Date().toISOString(),
          property: { address: resolved.address, lat, lng, geocode_location_type: geocodeType },
          calibration: {
            zoom,
            raster_scale: rasterScale,
            meters_per_pixel_logical: cal.meters_per_pixel_logical,
            meters_per_pixel_actual: cal.meters_per_pixel_actual,
            feet_per_pixel_actual: feetPerPixel,
            image: { logical_w: mb?.logical_w, logical_h: mb?.logical_h, actual_w: imgW, actual_h: imgH },
          },
          planes,
          edges,
          totals: {
            total_area_2d_sqft: totalArea2d,
            total_area_pitch_adjusted_sqft: totalAreaSloped,
            roof_square_count: roofSquares,
            waste_factor_percent: wasteFactor,
            waste_adjusted_squares: wasteSquares,
            ridge_length_ft: ridge_ft,
            hip_length_ft: hip_ft,
            valley_length_ft: valley_ft,
            eave_length_ft: eave_ft,
            rake_length_ft: rake_ft,
            perimeter_length_ft: perimeter_ft,
            dominant_pitch: dominantPitch,
          },
          quality_checks: qc.checks,
          overall_score: qc.overall,
          final_status: qc.status,
          // ── Hard-gate geometry provenance fields (consumed by frontend & PDF function) ──
          geometry_source: geometrySource,
          overlay_alignment_score: qc.overlayAlignmentScore,
          is_placeholder: hasPlaceholder || !qc.geometrySourceIsReal,
          planes_are_all_rectangles: qc.planesAreAllRectangles,
          single_plane_fallback: qc.singlePlaneFallback,
          footprint_wkt: footprintWkt,
        }

        await supa.from('ai_measurement_results').insert({
          job_id: aiJob.id,
          total_area_2d_sqft: totalArea2d,
          total_area_pitch_adjusted_sqft: totalAreaSloped,
          roof_square_count: roofSquares,
          waste_factor_percent: wasteFactor,
          waste_adjusted_squares: wasteSquares,
          ridge_length_ft: ridge_ft,
          hip_length_ft: hip_ft,
          valley_length_ft: valley_ft,
          eave_length_ft: eave_ft,
          rake_length_ft: rake_ft,
          perimeter_length_ft: perimeter_ft,
          dominant_pitch: dominantPitch,
          pitch_breakdown: planes.map((p) => ({
            plane_index: p.plane_index,
            pitch: p.pitch,
            area_2d_sqft: p.area_2d_sqft,
          })),
          line_breakdown: { ridge_ft, hip_ft, valley_ft, eave_ft, rake_ft },
          plane_breakdown: planes.map((p) => ({
            plane_index: p.plane_index,
            area_2d_sqft: p.area_2d_sqft,
            area_pitch_adjusted_sqft: p.area_pitch_adjusted_sqft,
            pitch_degrees: p.pitch_degrees,
            azimuth: p.azimuth,
          })),
          confidence_score: qc.overall,
          report_json: reportJson,
        })

        // 2i.5) Generate EagleView-style diagram pages from measured geometry.
        // Hard rule: only when geometry passed quality checks (not needs_manual_measurement)
        // and we have real planes — never from placeholders.
        if (qc.status !== 'needs_internal_review' && planes.length > 0 && !hasPlaceholder) {
          try {
            const diagrams = generateRoofDiagrams({
              propertyAddress: resolved.address || 'Unknown property',
              planes: planes.map((p) => ({
                plane_index: p.plane_index,
                polygon_px: p.polygon_px as any,
                pitch: p.pitch,
                pitch_degrees: p.pitch_degrees,
                area_2d_sqft: p.area_2d_sqft,
                area_pitch_adjusted_sqft: p.area_pitch_adjusted_sqft,
                confidence: p.confidence,
              })),
              edges: edges.map((e) => ({
                edge_type: e.edge_type as any,
                line_px: e.line_px as any,
                length_ft: e.length_ft,
                confidence: e.confidence,
              })),
              totals: reportJson.totals,
              satelliteImageUrl: mb?.image_url || null,
              sourceImageWidth: imgW,
              sourceImageHeight: imgH,
            })

            if (diagrams.length > 0) {
              await supa.from('ai_measurement_diagrams').insert(
                diagrams.map((d) => ({
                  ai_measurement_job_id: aiJob.id,
                  lead_id: resolved.leadId,
                  project_id: resolved.projectId,
                  tenant_id: resolved.tenantId,
                  diagram_type: d.diagram_type,
                  title: d.title,
                  page_number: d.page_number,
                  svg_markup: d.svg_markup,
                  diagram_json: {
                    generated_from: 'ai_roof_planes_and_ai_roof_edges',
                    engine_version: `${ENGINE_VERSION}_diagrams`,
                    property_address: resolved.address,
                    totals: reportJson.totals,
                  },
                  width: 1000,
                  height: 1000,
                })),
              )
            }
          } catch (diagErr) {
            console.error('[start-ai-measurement] diagram generation failed', diagErr)
            // Non-fatal: do not block job completion on diagram rendering.
          }
        }

        await supa
          .from('ai_measurement_jobs')
          .update({
            status: qc.status,
            status_message:
              qc.status === 'completed'
                ? 'Geometry pipeline complete'
                : qc.status === 'needs_review'
                ? 'Result needs review'
                : 'Internal review required — automated roof geometry could not be verified',
            confidence_score: qc.overall,
            geometry_quality_score: qc.overall,
            measurement_quality_score: qc.overall,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', aiJob.id)

        // 2j) Block placeholder/failed from publishing
        if (qc.status === 'needs_internal_review' || exceedsPublishableArea) {
          const reason = exceedsPublishableArea
            ? `Rejected inflated geometry: ${Math.round(totalAreaSloped).toLocaleString()} sqft exceeds ${MAX_AUTO_ROOF_AREA_SQFT.toLocaleString()} sqft publish cap.`
            : 'Roof slopes could not be reliably segmented from satellite imagery. This property has been flagged for internal review.'
          await supa
            .from('measurement_jobs')
            .update({
              status: 'failed',
              progress_message: 'Roof geometry could not be verified automatically. Flagged for internal review — no customer-facing report will be generated.',
              error: reason,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
          return
        }

        // 2k) Publish customer-facing roof_measurements
        const roofId = crypto.randomUUID()
        const publishedFootprintSource = normalizeRoofMeasurementFootprintSource(
          planes[0]?.source || geometrySource,
          solarOk,
        )
        const footprintVerticesGeo = planes.length > 0
          ? planes[0].polygon_geojson.map((p) => ({ lat: p.lat, lng: p.lng }))
          : null
        const linearFeaturesWkt = edges
          .map((e) => ({
            type: e.edge_type,
            wkt: lineGeoToWkt(e.line_geojson),
            length_ft: e.length_ft,
            confidence: e.confidence,
            source: e.source,
          }))
          .filter((e) => e.wkt)
        const roofMeasurementPayload = {
          id: roofId,
          customer_id: resolved.leadId, // legacy column
          lead_id: resolved.leadId,
          project_id: resolved.projectId,
          source_record_type: resolved.sourceType,
          source_record_id: resolved.sourceId,
          source_button: sourceButton,
          ai_measurement_job_id: aiJob.id,
          engine_version: ENGINE_VERSION,
          tenant_id: resolved.tenantId,
          measured_by: body.userId || null,
          property_address: resolved.address || 'Unknown Address',
          gps_coordinates: { lat, lng },
          ai_detection_data: {
            source: publishedFootprintSource,
            slope_hints_source: solarOk ? 'google_solar_api' : null,
            geometry_source: geometrySource,
            engine: ENGINE_VERSION,
            planes: planes.length,
            edges: edges.length,
          },
          ai_model_version: ENGINE_VERSION,
          detection_timestamp: new Date().toISOString(),
          detection_confidence: qc.overall,
          total_area_flat_sqft: totalArea2d,
          total_area_adjusted_sqft: totalAreaSloped,
          total_squares: roofSquares,
          waste_factor_percent: wasteFactor,
          total_squares_with_waste: wasteSquares,
          predominant_pitch: dominantPitch,
          pitch_multiplier: planes[0]?.pitch_multiplier ?? 1,
          total_ridge_length: ridge_ft,
          total_hip_length: hip_ft,
          total_valley_length: valley_ft,
          total_eave_length: eave_ft,
          total_rake_length: rake_ft,
          facet_count: planes.length,
          footprint_source: publishedFootprintSource,
          footprint_vertices_geo: footprintVerticesGeo,
          linear_features_wkt: linearFeaturesWkt,
          perimeter_wkt: footprintWkt,
          detection_method: ENGINE_VERSION,
          target_lat: lat,
          target_lng: lng,
          mapbox_image_url: imagerySource === 'mapbox' ? mb?.image_url ?? null : null,
          google_maps_image_url: imagerySource === 'google_static' ? mb?.image_url ?? null : null,
          satellite_overlay_url: mb?.image_url ?? null,
          selected_image_source: imagerySource !== 'none' ? imagerySource : null,
          image_source: imagerySource !== 'none' ? imagerySource : null,
          analysis_zoom: zoom,
          analysis_image_size: {
            width: imgW,
            height: imgH,
            logicalWidth: mb?.logical_w ?? null,
            logicalHeight: mb?.logical_h ?? null,
            rasterScale,
          },
          image_bounds: computeImageBounds(lat, lng, zoom, mb?.logical_w ?? 640, mb?.logical_h ?? 640),
          measurement_confidence: qc.overall,
          requires_manual_review: qc.status === 'needs_review',
          validation_status: qc.status === 'completed' ? 'validated' : 'flagged',
          geometry_report_json: reportJson,
          geometry_quality_score: qc.overall,
          measurement_quality_score: qc.overall,
        }
        const { error: roofInsertError } = await supa.from('roof_measurements').insert(roofMeasurementPayload)
        if (roofInsertError) {
          throw new Error(`roof_measurements insert failed: ${roofInsertError.message}`)
        }

        // 2k.1) EagleView Strict 3% Validation Gate
        // If this lead/project has a vendor truth report, score the AI output
        // against it and persist auto_ship | review_required | reject decision.
        try {
          const { data: vendorRpt } = await supa
            .from('roof_vendor_reports')
            .select('id, parsed')
            .or(`lead_id.eq.${resolved.leadId},project_id.eq.${resolved.projectId ?? '00000000-0000-0000-0000-000000000000'}`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (vendorRpt?.parsed) {
            const measurement_data = {
              measurements: {
                area_sqft: totalAreaSloped,
                predominant_pitch: dominantPitch,
                lengths_ft: {
                  ridge: ridge_ft,
                  hip: hip_ft,
                  valley: valley_ft,
                  eave: eave_ft,
                  rake: rake_ft,
                },
              },
            }
            const gateResp = await supa.functions.invoke('score-roof-accuracy', {
              body: { measurement_data, vendor_report: vendorRpt },
            })
            const g = gateResp.data ?? {}
            if (g && g.decision) {
              await supa.from('roof_measurements').update({
                vendor_report_id: vendorRpt.id,
                gate_decision: g.decision,
                gate_reason: g.reason,
                gate_per_class: g.per_class ?? null,
                passes_strict_3pct: g.passes_strict_3pct ?? false,
                failed_strict: g.failed_strict ?? [],
                failed_loose: g.failed_loose ?? [],
                weighted_accuracy_score: g.weighted_accuracy_score ?? null,
                review_required: g.review_required ?? true,
                accuracy_compared_at: new Date().toISOString(),
                gate_evaluated_at: new Date().toISOString(),
                requires_manual_review: g.decision !== 'auto_ship',
              }).eq('id', roofId)
              console.log(`[start-ai-measurement] 3% gate → ${g.decision} (${g.reason})`)

              // Phase 6: emit learning event for the continuous-learning loop
              try {
                await supa.functions.invoke('measurement-learning-loop', {
                  body: {
                    action: 'record_event',
                    measurement_id: roofId,
                    tenant_id: resolved.tenantId,
                    event_type: g.decision === 'auto_ship' ? 'auto_ship' : (g.decision === 'reject' ? 'gate_failure' : 'vendor_truth_diff'),
                    source: 'start-ai-measurement',
                    gate_decision: g.decision,
                    per_class_errors: g.per_class ?? null,
                    area_error_pct: g.area_error_pct ?? null,
                    pitch_error_deg: g.pitch_error ?? null,
                    ridge_error_pct: g.ridge_error_pct ?? null,
                    hip_error_pct: g.hip_error_pct ?? null,
                    valley_error_pct: g.valley_error_pct ?? null,
                    eave_error_pct: g.eave_error_pct ?? null,
                    rake_error_pct: g.rake_error_pct ?? null,
                    weighted_score: g.weighted_accuracy_score ?? null,
                    payload: { vendor_report_id: vendorRpt.id, reason: g.reason },
                  },
                })
              } catch (mlErr) {
                console.warn('[start-ai-measurement] learning-loop emit failed:', (mlErr as Error).message)
              }
            }
          } else {
            console.log('[start-ai-measurement] 3% gate skipped: no vendor truth report on file')
          }
        } catch (gateErr) {
          console.warn('[start-ai-measurement] 3% gate evaluation failed:', (gateErr as Error).message)
        }

        // 2l) measurement_approvals smart tags
        await supa.from('measurement_approvals').insert({
          tenant_id: resolved.tenantId,
          pipeline_entry_id: resolved.leadId,
          lead_id: resolved.leadId,
          project_id: resolved.projectId,
          source_record_type: resolved.sourceType,
          source_record_id: resolved.sourceId,
          ai_measurement_job_id: aiJob.id,
          approved_at: new Date().toISOString(),
          saved_tags: {
            'roof.plan_area': totalArea2d,
            'roof.total_sqft': totalAreaSloped,
            'roof.squares': roofSquares,
            'roof.predominant_pitch': dominantPitch,
            'roof.faces_count': planes.length,
            'lf.ridge': ridge_ft,
            'lf.hip': hip_ft,
            'lf.valley': valley_ft,
            'lf.eave': eave_ft,
            'lf.rake': rake_ft,
            'lf.perimeter': perimeter_ft,
            source: ENGINE_VERSION,
            measurement_id: roofId,
            ai_measurement_job_id: aiJob.id,
            imported_at: new Date().toISOString(),
          },
          approval_notes: `geometry_first_v2 • ${Math.round(totalAreaSloped).toLocaleString()} sqft • ${qc.status}`,
        })

        // 2m) Mark CRM job complete
        await supa
          .from('measurement_jobs')
          .update({
            status: 'completed',
            progress_message:
              qc.status === 'completed'
                ? 'Measurement complete'
                : 'Measurement complete — review recommended',
            measurement_id: roofId,
            geocode_location_type: geocodeType,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
      } catch (err: any) {
        const msg = err?.message || String(err)
        console.error('[start-ai-measurement] failed:', msg)
        await supa
          .from('measurement_jobs')
          .update({
            status: 'failed',
            progress_message: 'Processing error',
            error: msg,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        await supa
          .from('ai_measurement_jobs')
          .update({
            status: 'failed',
            status_message: msg,
            failure_reason: msg,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', aiJob.id)
      }
    }

    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === 'function') {
      ;(globalThis as any).EdgeRuntime.waitUntil(run())
    } else {
      run().catch(console.error)
    }

    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        ai_measurement_job_id: aiJob.id,
        status: 'queued',
        engine: ENGINE_VERSION,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('start-ai-measurement error:', error?.message || error)
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
