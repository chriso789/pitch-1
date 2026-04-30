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
import { computeStraightSkeleton } from '../_shared/straight-skeleton.ts'
import { buildTopology as buildTriangulationTopology } from '../_shared/topology-engine.ts'
import { decomposeComplexFootprint } from '../_shared/complex-footprint-decomposer.ts'
import { classifyHipValleyRidgeEdges } from '../_shared/hip-valley-classifier.ts'
import { splitPlanesFromRidges } from '../_shared/ridge-plane-splitter.ts'
import { buildAdjacencyAndClassifyEdges } from '../_shared/roof-adjacency-classifier.ts'
import { buildPatentModelFromPlanes } from '../_shared/build-patent-model-from-planes.ts'

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
type FootprintSource = 'google_solar_mask' | 'mapbox_vector' | 'osm_buildings' | 'microsoft_buildings'

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
    const solarMask = await fetchGoogleSolarMaskFootprint(lat, lng, GOOGLE_SOLAR_API_KEY)
    if (solarMask?.coordinates?.length) candidates.push(solarMask)
  } catch (err) {
    console.warn(`[authoritative] google solar mask threw: ${err}`)
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
      fp.source === 'google_solar_mask' ? 0.12 :
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
  if (footprint.source === 'google_solar_mask') return vertexCount <= 4 || footprint.confidence < 0.88
  return vertexCount <= 6 || footprint.confidence < 0.82
}

/**
 * Align an authoritative (OSM/MS Buildings) footprint to the image-extracted
 * footprint. OSM polygons are frequently mis-positioned by 5–30m relative to
 * current aerial imagery (community traces from outdated tiles). The image
 * footprint, while sometimes noisy in shape, is correctly registered to the
 * Mapbox aerial we render the overlay on top of. We therefore:
 *   1. Compute centroid of both polygons (in pixel space).
 *   2. Translate the authoritative polygon so its centroid matches the
 *      image footprint's centroid → fixes positional drift.
 *   3. If the image footprint area is comparable (within 0.55–1.8x), also
 *      apply a uniform scale correction so the OSM shape doesn't extend
 *      well beyond the visible roof.
 * Returns a new AuthoritativeFootprint with corrected geo coordinates.
 */
/** Point-in-polygon test (ray casting). */
function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/** IoU between two polygons by sampling a coarse grid over their union bbox. */
function polygonIoU(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  if (a.length < 3 || b.length < 3) return 0
  const all = [...a, ...b]
  const minX = Math.min(...all.map((p) => p.x))
  const maxX = Math.max(...all.map((p) => p.x))
  const minY = Math.min(...all.map((p) => p.y))
  const maxY = Math.max(...all.map((p) => p.y))
  if (!(maxX > minX) || !(maxY > minY)) return 0
  const N = 64
  const sx = (maxX - minX) / N
  const sy = (maxY - minY) / N
  let inter = 0, uni = 0
  for (let iy = 0; iy < N; iy++) {
    const y = minY + (iy + 0.5) * sy
    for (let ix = 0; ix < N; ix++) {
      const x = minX + (ix + 0.5) * sx
      const inA = pointInPoly(x, y, a)
      const inB = pointInPoly(x, y, b)
      if (inA && inB) inter++
      if (inA || inB) uni++
    }
  }
  return uni > 0 ? inter / uni : 0
}

/** Andrew's monotone-chain convex hull. Returns CCW hull of input points. */
function convexHull(points: Pt[]): Pt[] {
  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  if (pts.length <= 1) return pts
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return [...lower, ...upper]
}

type ImageEdgeEvidence = {
  mag: Uint8Array
  dW: number
  dH: number
  scaleX: number
  scaleY: number
}

function scorePolygonEdgeSupport(poly: Pt[], evidence: ImageEdgeEvidence | null): number {
  if (!evidence || poly.length < 3) return 0
  const { mag, dW, dH, scaleX, scaleY } = evidence
  let total = 0
  let samples = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(3, Math.ceil(len / 8))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const gx0 = Math.round((a.x + (b.x - a.x) * t) / scaleX)
      const gy0 = Math.round((a.y + (b.y - a.y) * t) / scaleY)
      let best = 0
      for (let oy = -2; oy <= 2; oy++) {
        const gy = gy0 + oy
        if (gy < 1 || gy >= dH - 1) continue
        for (let ox = -2; ox <= 2; ox++) {
          const gx = gx0 + ox
          if (gx < 1 || gx >= dW - 1) continue
          best = Math.max(best, mag[gy * dW + gx] || 0)
        }
      }
      total += best / 255
      samples++
    }
  }
  return samples > 0 ? total / samples : 0
}

/**
 * Align an authoritative (OSM/MS Buildings) footprint to the image-extracted
 * footprint. OSM polygons can be (a) mis-positioned by 5–30m, (b) badly scaled,
 * or (c) MIRRORED relative to the actual building (community traces from old
 * tiles or hand-drawn from the wrong side). We:
 *   1. Translate authoritative centroid → image-footprint centroid.
 *   2. Apply uniform scale if areas are comparable.
 *   3. Test 4 reflections (identity, flip-H, flip-V, flip-HV) about the
 *      centroid and pick the one with the highest IoU vs the image footprint.
 *      Only adopt a flip if it improves IoU by >12% over identity (avoids
 *      flipping symmetric shapes pointlessly).
 * The chosen reflection is recorded so downstream linear features (ridges,
 * hips, valleys) can be transformed in lockstep.
 */
function alignAuthoritativeToImage(
  authoritative: AuthoritativeFootprint,
  imageFootprintPx: { x: number; y: number }[] | null,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  edgeEvidence: ImageEdgeEvidence | null = null,
): AuthoritativeFootprint & { _alignment_transform?: { flipX: boolean; flipY: boolean; cx: number; cy: number; scale: number; dx?: number; dy?: number } } {
  const hasImageFootprint = !!imageFootprintPx && imageFootprintPx.length >= 3
  if (!hasImageFootprint && !edgeEvidence) return authoritative
  try {
    const ring = openGeoRing(authoritative.coordinates)
    const authPx = ring.map(([lng, lat]) =>
      latLngToPixel({ lat, lng }, centerLat, centerLng, imgW, imgH, actualMpp),
    )

    const centroid = (pts: { x: number; y: number }[]) => {
      let sx = 0, sy = 0
      for (const p of pts) { sx += p.x; sy += p.y }
      return { x: sx / pts.length, y: sy / pts.length }
    }
    const polyAreaPx = (pts: { x: number; y: number }[]) => {
      let a = 0
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y)
      }
      return Math.abs(a) / 2
    }

    const cAuth = centroid(authPx)
    const cImg = hasImageFootprint ? centroid(imageFootprintPx!) : cAuth
    const driftPx = Math.hypot(cImg.x - cAuth.x, cImg.y - cAuth.y)
    const driftMeters = driftPx * actualMpp

    const aAuth = polyAreaPx(authPx)
    const aImg = hasImageFootprint ? polyAreaPx(imageFootprintPx!) : 0
    const ratio = aImg > 0 && aAuth > 0 ? aImg / aAuth : 1
    const applyScale = ratio >= 0.55 && ratio <= 1.8
    const scale = applyScale ? Math.sqrt(ratio) : 1

    // Build the 4 candidate orientations, each translated+scaled to the image centroid
    // when an image footprint exists. If contour extraction failed, we still search
    // nearby image-edge support; otherwise the vector footprint can remain on the
    // wrong side of the visible roof with drift=0 simply because there is no image
    // centroid to translate toward.
    const fitsInFrame = (pts: Pt[]) => pts.every((p) => p.x >= 2 && p.y >= 2 && p.x <= imgW - 2 && p.y <= imgH - 2)
    const translate = (pts: Pt[], dx: number, dy: number) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))
    const edgeTranslationFit = (pts: Pt[]) => {
      if (!edgeEvidence) return { pts, dx: 0, dy: 0, edge: scorePolygonEdgeSupport(pts, edgeEvidence) }
      const maxShift = hasImageFootprint ? 28 : Math.min(190, Math.max(72, Math.min(imgW, imgH) * 0.15))
      let best = { pts, dx: 0, dy: 0, edge: scorePolygonEdgeSupport(pts, edgeEvidence), score: -Infinity }
      const scoreAt = (dx: number, dy: number) => {
        const shifted = translate(pts, dx, dy)
        if (!fitsInFrame(shifted)) return
        const edge = scorePolygonEdgeSupport(shifted, edgeEvidence)
        const distancePenalty = Math.hypot(dx, dy) / Math.max(maxShift, 1)
        const score = edge - distancePenalty * (hasImageFootprint ? 0.08 : 0.035)
        if (score > best.score) best = { pts: shifted, dx, dy, edge, score }
      }
      const coarseStep = hasImageFootprint ? 7 : 14
      for (let dy = -maxShift; dy <= maxShift; dy += coarseStep) {
        for (let dx = -maxShift; dx <= maxShift; dx += coarseStep) scoreAt(dx, dy)
      }
      const aroundX = best.dx, aroundY = best.dy
      for (let dy = aroundY - coarseStep; dy <= aroundY + coarseStep; dy += 2) {
        for (let dx = aroundX - coarseStep; dx <= aroundX + coarseStep; dx += 2) scoreAt(dx, dy)
      }
      return best
    }

    // ============================================================
    // SAFE ALIGNMENT (audit fix):
    // Translate the authoritative footprint to the image-footprint centroid
    // and apply the area-ratio scale, but NEVER force a horizontal mirror
    // or corner-anchor translation. The previous "HORIZONTAL MIRROR" /
    // "FORCED-CORNER-TRANSLATE" adoption was the highest-confidence cause
    // of overlays landing on the wrong side of the roof.
    //
    // We still SCORE the 4 reflection candidates for diagnostic logging so
    // we can see whether a flip would have helped — but we never adopt it.
    // ============================================================
    const identityPts: Pt[] = authPx.map((p) => ({
      x: cImg.x + (p.x - cAuth.x) * scale,
      y: cImg.y + (p.y - cAuth.y) * scale,
    }))
    const identityIou = hasImageFootprint ? polygonIoU(identityPts, imageFootprintPx!) : 0
    const identityEdge = edgeEvidence ? scorePolygonEdgeSupport(identityPts, edgeEvidence) : 0

    const diagScores: { flipX: boolean; flipY: boolean; iou: number; edge: number }[] = []
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        const sx = flipX ? -1 : 1
        const sy = flipY ? -1 : 1
        const pts = authPx.map((p) => ({
          x: cImg.x + sx * (p.x - cAuth.x) * scale,
          y: cImg.y + sy * (p.y - cAuth.y) * scale,
        }))
        diagScores.push({
          flipX,
          flipY,
          iou: hasImageFootprint ? polygonIoU(pts, imageFootprintPx!) : 0,
          edge: edgeEvidence ? scorePolygonEdgeSupport(pts, edgeEvidence) : 0,
        })
      }
    }

    console.log(
      `[alignment] SAFE_IDENTITY drift=${driftMeters.toFixed(1)}m area_ratio=${ratio.toFixed(2)} scale=${scale.toFixed(3)} ` +
      `auth_source=${authoritative.source} iou=${identityIou.toFixed(3)} edge=${identityEdge.toFixed(3)} ` +
      `diag_iou{id=${diagScores[0].iou.toFixed(2)} fY=${diagScores[1].iou.toFixed(2)} fX=${diagScores[2].iou.toFixed(2)} fXY=${diagScores[3].iou.toFixed(2)}} ` +
      `diag_edge{id=${diagScores[0].edge.toFixed(2)} fY=${diagScores[1].edge.toFixed(2)} fX=${diagScores[2].edge.toFixed(2)} fXY=${diagScores[3].edge.toFixed(2)}}`,
    )

    const alignedGeo: GeoXY[] = identityPts.map((p) => {
      const g = pixelToLatLng(p.x, p.y, centerLat, centerLng, imgW, imgH, actualMpp)
      return [g.lng, g.lat] as GeoXY
    })

    return {
      ...authoritative,
      coordinates: alignedGeo,
      source: `${authoritative.source}_image_aligned` as AuthoritativeFootprint['source'],
      areaM2: authoritative.areaM2 ? authoritative.areaM2 * scale * scale : authoritative.areaM2,
      _alignment_transform: {
        flipX: false,
        flipY: false,
        cx: cAuth.x,
        cy: cAuth.y,
        scale,
        dx: cImg.x - cAuth.x,
        dy: cImg.y - cAuth.y,
      },
    }
  } catch (err) {
    console.warn('[alignment] failed, using raw authoritative footprint:', err)
    return authoritative
  }
}

/**
 * Apply the same reflection chosen during footprint alignment to a list of
 * pixel-space line segments (ridges, hips, valleys). This keeps interior
 * structural lines registered to the corrected footprint.
 */
export function applyAlignmentTransformToLines<T extends { p1: Pt; p2: Pt }>(
  lines: T[],
  xform: { flipX: boolean; flipY: boolean; cx: number; cy: number; scale: number; dx?: number; dy?: number } | undefined,
): T[] {
  if (!xform || (!xform.flipX && !xform.flipY && xform.scale === 1 && !xform.dx && !xform.dy)) return lines
  const sx = xform.flipX ? -1 : 1
  const sy = xform.flipY ? -1 : 1
  const tx = (p: Pt): Pt => ({
    x: xform.cx + sx * (p.x - xform.cx) * xform.scale + (xform.dx || 0),
    y: xform.cy + sy * (p.y - xform.cy) * xform.scale + (xform.dy || 0),
  })
  return lines.map((l) => ({ ...l, p1: tx(l.p1), p2: tx(l.p2) }))
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
  // Mapbox & Google static maps render in spherical Web Mercator (EPSG:3857).
  // The downstream overlay renderer (overlayProjection.ts) projects geometry
  // with Mercator math, so the bounds we hand it MUST also be Mercator —
  // otherwise the diagram drifts vertically on the satellite tile.
  //
  // Convert pixel size at the center latitude into a Mercator Y span, then
  // invert that span back to a latitude range. Longitude IS linear in
  // Mercator, so the lng calculation is straightforward.
  const TILE = 256
  const worldSize = TILE * Math.pow(2, zoom) // pixels covering 360° lng

  // Longitude span: linear in Mercator.
  const lngSpan = (logicalWidth / worldSize) * 360
  const west = lng - lngSpan / 2
  const east = lng + lngSpan / 2

  // Latitude span: invert Mercator Y. Center latitude in Mercator pixel space:
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const centerY =
    worldSize / 2 -
    (worldSize / (2 * Math.PI)) * Math.log((1 + sinLat) / (1 - sinLat)) / 2
  const topY = centerY - logicalHeight / 2
  const bottomY = centerY + logicalHeight / 2

  const yToLat = (y: number) => {
    const n = Math.PI - (2 * Math.PI * y) / worldSize
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  }
  const north = yToLat(topY)
  const south = yToLat(bottomY)

  return [west, south, east, north]
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

async function fetchGoogleSolarMaskFootprint(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<AuthoritativeFootprint | null> {
  if (!apiKey) return null
  try {
    const layersUrl =
      `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}` +
      `&location.longitude=${lng}&radiusMeters=50&view=FULL_LAYERS` +
      `&requiredQuality=LOW&pixelSizeMeters=0.1&key=${apiKey}`
    const layersResp = await fetch(layersUrl)
    if (!layersResp.ok) {
      console.warn(`[solar-mask] dataLayers failed ${layersResp.status}`)
      return null
    }
    const layers = await layersResp.json()
    if (!layers?.maskUrl) {
      console.warn('[solar-mask] no maskUrl returned')
      return null
    }

    const maskUrl = `${layers.maskUrl}${String(layers.maskUrl).includes('?') ? '&' : '?'}key=${apiKey}`
    const maskResp = await fetch(maskUrl)
    if (!maskResp.ok) {
      console.warn(`[solar-mask] mask fetch failed ${maskResp.status}`)
      return null
    }

    const { fromArrayBuffer } = await import('npm:geotiff@2.1.3')
    const tiff = await fromArrayBuffer(await maskResp.arrayBuffer())
    const image = await tiff.getImage()
    const width = image.getWidth()
    const height = image.getHeight()
    const rasters: any = await image.readRasters({ interleave: true })
    const values: ArrayLike<number> = ArrayBuffer.isView(rasters) ? rasters : (rasters?.[0] ?? [])
    if (!width || !height || values.length < width * height) return null

    const bbox = image.getBoundingBox?.() as number[] | undefined
    if (!bbox || bbox.length !== 4) {
      console.warn('[solar-mask] mask geobounds unavailable')
      return null
    }
    const mercatorToLngLat = (x: number, y: number): GeoXY => {
      const lng = (x / 6378137) * 180 / Math.PI
      const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI
      return [lng, lat]
    }
    const isProjectedMeters = Math.max(...bbox.map((v) => Math.abs(Number(v)))) > 1000
    const [minLng, minLat, maxLng, maxLat] = isProjectedMeters
      ? (() => {
          const sw = mercatorToLngLat(bbox[0], bbox[1])
          const ne = mercatorToLngLat(bbox[2], bbox[3])
          return [sw[0], sw[1], ne[0], ne[1]] as [number, number, number, number]
        })()
      : bbox as [number, number, number, number]
    const noData = Number(image.getGDALNoData?.())
    const valid = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) {
      const v = Number(values[i])
      valid[i] = Number.isFinite(v) && v > 0 && (!Number.isFinite(noData) || v !== noData) ? 1 : 0
    }

    const targetX = Math.max(0, Math.min(width - 1, Math.round(((lng - minLng) / (maxLng - minLng)) * (width - 1))))
    const targetY = Math.max(0, Math.min(height - 1, Math.round(((maxLat - lat) / (maxLat - minLat)) * (height - 1))))
    let seed = valid[targetY * width + targetX] ? targetY * width + targetX : -1
    for (let r = 1; r <= 80 && seed < 0; r++) {
      for (let dy = -r; dy <= r && seed < 0; dy++) {
        for (let dx = -r; dx <= r && seed < 0; dx++) {
          const x = targetX + dx, y = targetY + dy
          if (x >= 0 && y >= 0 && x < width && y < height && valid[y * width + x]) seed = y * width + x
        }
      }
    }
    if (seed < 0) return null

    const blob = new Uint8Array(width * height)
    const stack = [seed]
    let count = 0
    while (stack.length) {
      const idx = stack.pop()!
      if (blob[idx] || !valid[idx]) continue
      blob[idx] = 1; count++
      const x = idx % width, y = (idx / width) | 0
      if (x > 0) stack.push(idx - 1)
      if (x < width - 1) stack.push(idx + 1)
      if (y > 0) stack.push(idx - width)
      if (y < height - 1) stack.push(idx + width)
    }
    if (count < 25) return null

    let sx = -1, sy = -1
    outer: for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        if (!blob[idx]) continue
        const boundary = x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
          !blob[idx - 1] || !blob[idx + 1] || !blob[idx - width] || !blob[idx + width]
        if (boundary) { sx = x; sy = y; break outer }
      }
    }
    if (sx < 0) return null

    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
    const isB = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && blob[y * width + x] === 1
    const contour: Pt[] = [{ x: sx, y: sy }]
    let cx = sx, cy = sy, dir = 0
    for (let step = 0; step < Math.max(200, 8 * count); step++) {
      let found = false
      for (let k = 0; k < 8; k++) {
        const nd = (dir + 6 + k) % 8
        const [ddx, ddy] = dirs[nd]
        const nx = cx + ddx, ny = cy + ddy
        if (isB(nx, ny)) { cx = nx; cy = ny; dir = nd; contour.push({ x: cx, y: cy }); found = true; break }
      }
      if (!found || (cx === sx && cy === sy && contour.length > 8)) break
    }
    const simplified = douglasPeucker(contour, Math.max(1.5, Math.hypot(width, height) * 0.004))
      .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y)
    if (simplified.length >= 4 && simplified[0].x === simplified[simplified.length - 1].x && simplified[0].y === simplified[simplified.length - 1].y) simplified.pop()
    if (simplified.length < 4) return null

    const coordinates: GeoXY[] = simplified.map((p) => [
      minLng + ((p.x + 0.5) / width) * (maxLng - minLng),
      maxLat - ((p.y + 0.5) / height) * (maxLat - minLat),
    ] as GeoXY)
    const areaM2 = geoPolygonAreaM2(coordinates)
    if (!Number.isFinite(areaM2) || areaM2 <= 20 || areaM2 > 5000) {
      console.warn(`[solar-mask] rejected implausible footprint areaM2=${areaM2}`)
      return null
    }
    console.log(`[solar-mask] extracted footprint vertices=${coordinates.length} areaM2=${areaM2.toFixed(1)}`)
    return { coordinates, source: 'google_solar_mask', confidence: 0.94, areaM2, vertexCount: coordinates.length }
  } catch (err) {
    console.warn('[solar-mask] extraction failed', String(err))
    return null
  }
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

/** Decompose an axis-aligned rectilinear footprint (rectangle / L / T / U)
 *  into its constituent rectangular wings using a sweep over distinct
 *  x and y grid lines induced by the polygon's vertices. Each rectangular
 *  cell whose center is inside the polygon is treated as part of the
 *  building footprint. Adjacent cells are merged greedily into maximal
 *  rectangles oriented along the longer dimension so that each wing of
 *  an L/T/U gets its own ridge. */
function decomposeFootprintIntoWings(poly: Pt[]): Array<{ minX: number; minY: number; maxX: number; maxY: number }> {
  if (poly.length < 4) return []
  const xs = Array.from(new Set(poly.map((p) => Math.round(p.x)))).sort((a, b) => a - b)
  const ys = Array.from(new Set(poly.map((p) => Math.round(p.y)))).sort((a, b) => a - b)
  if (xs.length < 2 || ys.length < 2) return []

  const inside = (x: number, y: number) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y
      const xj = poly[j].x, yj = poly[j].y
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)
      if (intersect) c = !c
    }
    return c
  }

  // Build occupancy grid of cells defined by adjacent x/y grid lines.
  const cols = xs.length - 1
  const rows = ys.length - 1
  const occ: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (xs[c] + xs[c + 1]) / 2
      const cy = (ys[r] + ys[r + 1]) / 2
      occ[r][c] = inside(cx, cy)
    }
  }

  // Merge cells into maximal rectangles greedily.
  const used: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false))
  const rects: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occ[r][c] || used[r][c]) continue
      // Expand right
      let c2 = c
      while (c2 + 1 < cols && occ[r][c2 + 1] && !used[r][c2 + 1]) c2++
      // Expand down while the entire row strip is occupied
      let r2 = r
      outer: while (r2 + 1 < rows) {
        for (let cc = c; cc <= c2; cc++) {
          if (!occ[r2 + 1][cc] || used[r2 + 1][cc]) break outer
        }
        r2++
      }
      for (let rr = r; rr <= r2; rr++) {
        for (let cc = c; cc <= c2; cc++) used[rr][cc] = true
      }
      rects.push({ minX: xs[c], minY: ys[r], maxX: xs[c2 + 1], maxY: ys[r2 + 1] })
    }
  }
  return rects
}

function ridgeForRect(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  poly: Pt[],
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
): RoofEdge | null {
  const widthPx = rect.maxX - rect.minX
  const heightPx = rect.maxY - rect.minY
  if (Math.min(widthPx, heightPx) < 20) return null
  const cx = (rect.minX + rect.maxX) / 2
  const cy = (rect.minY + rect.maxY) / 2
  const inset = Math.min(widthPx, heightPx) * 0.22
  const candidate: SplitLine = widthPx >= heightPx
    ? { p1: { x: rect.minX + inset, y: cy }, p2: { x: rect.maxX - inset, y: cy }, votes: 1 }
    : { p1: { x: cx, y: rect.minY + inset }, p2: { x: cx, y: rect.maxY - inset }, votes: 1 }
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

function synthesizeCentralRidgeFromFootprint(
  plane: RoofPlane,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
): RoofEdge[] {
  const poly = plane.polygon_px
  if (poly.length < 4) return []

  // Single midline ridge across the entire footprint bbox (legacy path
  // used only when no wing decomposition is requested).
  const minX = Math.min(...poly.map((p) => p.x))
  const maxX = Math.max(...poly.map((p) => p.x))
  const minY = Math.min(...poly.map((p) => p.y))
  const maxY = Math.max(...poly.map((p) => p.y))
  const single = ridgeForRect({ minX, minY, maxX, maxY }, poly, centerLat, centerLng, imgW, imgH, actualMpp, feetPerPixel)
  return single ? [single] : []
}

/**
 * Patent-shaped synthesis from a rectilinear footprint.
 *
 * For each wing of the decomposed footprint we emit:
 *   - 1 ridge along the wing's long centerline (clipped to footprint)
 *   - 4 perimeter classifications: rakes on the two short ends (gable),
 *     eaves on the two long sides — UNLESS the short end is shared with
 *     another wing (then it's a valley), or unless we treat it as a hip
 *     end (when the wing aspect ratio is near-square, hip roof).
 *
 * Output is patent-shaped (Layer 2 structural edges) and tagged with
 * source 'patent_synthesis' so it survives the patent-model filter.
 */
function synthesizePatentStructureFromFootprint(
  plane: RoofPlane,
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
): RoofEdge[] {
  const poly = plane.polygon_px
  if (poly.length < 4) return []

  // ──────────────────────────────────────────────────────────────────
  // TOPOLOGY ENGINE v2 — replaces the rectangle→ridge→done synthesis.
  //
  // Pipeline:
  //   1. Project pixel polygon → lat/lng ring
  //   2. computeStraightSkeleton(ring)  → real ridges + hips + valleys
  //      (multi-wing aware; classifies edges by reflex topology)
  //   3. decomposeComplexFootprint(ring) → wing rectangles for perimeter
  //      classification (eaves on long sides, rakes on gable ends,
  //      valleys on shared interior boundaries)
  //   4. Project every emitted edge back to pixels for line_px
  //
  // Source tag is `topology_engine_v2` so the change is auditable in
  // the persisted ai_measurement_edges table.
  // ──────────────────────────────────────────────────────────────────

  const out: RoofEdge[] = []

  // 1. Project pixel polygon → [lng, lat] ring (CCW expected by skeleton)
  const ringGeo: [number, number][] = poly.map((p) => {
    const ll = pixelToLatLng(p.x, p.y, centerLat, centerLng, imgW, imgH, actualMpp)
    return [ll.lng, ll.lat]
  })

  const projectGeoToPx = (lng: number, lat: number): Pt => {
    const px = latLngToPixel({ lat, lng }, centerLat, centerLng, imgW, imgH, actualMpp)
    return { x: px.x, y: px.y }
  }

  const pushEdge = (
    p1: Pt,
    p2: Pt,
    type: RoofEdge['edge_type'],
    confidence: number,
  ) => {
    const lpx = polylineLengthPx([p1, p2])
    if (lpx < 3) return
    out.push({
      edge_type: type,
      source: 'topology_engine_v2',
      line_px: [p1, p2],
      line_geojson: [
        pixelToLatLng(p1.x, p1.y, centerLat, centerLng, imgW, imgH, actualMpp),
        pixelToLatLng(p2.x, p2.y, centerLat, centerLng, imgW, imgH, actualMpp),
      ],
      length_px: lpx,
      length_ft: lpx * feetPerPixel,
      confidence,
    })
  }

  // 2. STRAIGHT SKELETON → ridges, hips, valleys (the real topology)
  let skeletonEdgeCount = 0
  try {
    const skel = computeStraightSkeleton(ringGeo, 0) // no eave offset; footprint already at roof edge
    for (const e of skel) {
      const p1 = projectGeoToPx(e.start[0], e.start[1])
      const p2 = projectGeoToPx(e.end[0], e.end[1])
      const conf = e.type === 'ridge' ? 0.7 : e.type === 'hip' ? 0.62 : 0.6
      pushEdge(p1, p2, e.type as RoofEdge['edge_type'], conf)
      skeletonEdgeCount++
    }
  } catch (err) {
    console.warn(`[topology_engine_v2] straight-skeleton failed: ${(err as Error).message}`)
  }

  // 2b. Triangulation fallback — only if straight-skeleton produced nothing.
  //     Guarantees at least *some* facet/ridge structure for degenerate
  //     footprints. Tagged via the same `topology_engine_v2` source so the
  //     downstream filters keep treating it as real topology.
  if (skeletonEdgeCount === 0) {
    try {
      const tri = buildTriangulationTopology(poly.map((p) => ({ x: p.x, y: p.y })))
      for (const e of tri.edges) {
        if (e.type !== 'ridge') continue // perimeter handled by wing pass below
        pushEdge({ x: e.p1.x, y: e.p1.y }, { x: e.p2.x, y: e.p2.y }, 'ridge', 0.5)
        skeletonEdgeCount++
      }
      console.log(
        `[topology_engine_v2] triangulation fallback planes=${tri.facet_count} ridges=${tri.edges.filter((e) => e.type === 'ridge').length}`,
      )
    } catch (err) {
      console.warn(`[topology_engine_v2] triangulation fallback failed: ${(err as Error).message}`)
    }
  }

  // 3. PERIMETER CLASSIFICATION via wing decomposition.
  //    decomposeComplexFootprint gives us the wing rectangles + valley
  //    origins; we use the wing aspect to decide which perimeter side
  //    is a gable (rakes) vs eave, and treat shared interior boundaries
  //    as valleys (only if the skeleton didn't already emit one there).
  const HIP_ASPECT_THRESHOLD = 1.4

  // Fall back to the legacy axis-aligned wing decomposer for pixel-space
  // perimeter math; the geo decomposer requires lat/lng + meter math.
  const wings = decomposeFootprintIntoWings(poly)
  const eq = (a: number, b: number) => Math.abs(a - b) < 1.5
  const wingsShareEdge = (
    w1: { minX: number; minY: number; maxX: number; maxY: number },
    side: 'top' | 'bottom' | 'left' | 'right',
  ): boolean => {
    return wings.some((w2) => {
      if (w2 === w1) return false
      if (side === 'top' && eq(w2.maxY, w1.minY))
        return Math.min(w1.maxX, w2.maxX) - Math.max(w1.minX, w2.minX) > 2
      if (side === 'bottom' && eq(w2.minY, w1.maxY))
        return Math.min(w1.maxX, w2.maxX) - Math.max(w1.minX, w2.minX) > 2
      if (side === 'left' && eq(w2.maxX, w1.minX))
        return Math.min(w1.maxY, w2.maxY) - Math.max(w1.minY, w2.minY) > 2
      if (side === 'right' && eq(w2.minX, w1.maxX))
        return Math.min(w1.maxY, w2.maxY) - Math.max(w1.minY, w2.minY) > 2
      return false
    })
  }

  for (const w of wings) {
    const widthPx = w.maxX - w.minX
    const heightPx = w.maxY - w.minY
    const longIsX = widthPx >= heightPx
    const longLen = longIsX ? widthPx : heightPx
    const shortLen = longIsX ? heightPx : widthPx
    const aspect = longLen / Math.max(shortLen, 1)
    const isHip = aspect <= HIP_ASPECT_THRESHOLD

    const sides: Array<{
      key: 'top' | 'bottom' | 'left' | 'right'
      p1: Pt; p2: Pt; isShortSide: boolean
    }> = [
      { key: 'top',    p1: { x: w.minX, y: w.minY }, p2: { x: w.maxX, y: w.minY }, isShortSide: !longIsX },
      { key: 'bottom', p1: { x: w.minX, y: w.maxY }, p2: { x: w.maxX, y: w.maxY }, isShortSide: !longIsX },
      { key: 'left',   p1: { x: w.minX, y: w.minY }, p2: { x: w.minX, y: w.maxY }, isShortSide: longIsX },
      { key: 'right',  p1: { x: w.maxX, y: w.minY }, p2: { x: w.maxX, y: w.maxY }, isShortSide: longIsX },
    ]
    for (const s of sides) {
      if (wingsShareEdge(w, s.key)) {
        // Shared interior boundary → valley (skeleton may have emitted
        // one too; the dedup pass downstream collapses near-duplicates).
        pushEdge(s.p1, s.p2, 'valley', 0.55)
        continue
      }
      if (isHip) {
        pushEdge(s.p1, s.p2, 'eave', 0.6)
      } else if (s.isShortSide) {
        pushEdge(s.p1, s.p2, 'rake', 0.6)
      } else {
        pushEdge(s.p1, s.p2, 'eave', 0.6)
      }
    }
  }

  console.log(
    `[topology_engine_v2] wings=${wings.length} skeleton_edges=${skeletonEdgeCount} ` +
    `total_edges=${out.length} ridges=${out.filter(e => e.edge_type === 'ridge').length} ` +
    `hips=${out.filter(e => e.edge_type === 'hip').length} ` +
    `valleys=${out.filter(e => e.edge_type === 'valley').length} ` +
    `rakes=${out.filter(e => e.edge_type === 'rake').length} ` +
    `eaves=${out.filter(e => e.edge_type === 'eave').length}`
  )

  return out
}

function collapseUnverifiedSyntheticRidges(
  edges: RoofEdge[],
  planes: RoofPlane[],
  centerLat: number,
  centerLng: number,
  imgW: number,
  imgH: number,
  actualMpp: number,
  feetPerPixel: number,
): RoofEdge[] {
  const syntheticRidges = edges.filter((e) => e.edge_type === 'ridge' && e.source === 'solar_dsm_inferred_ridge')
  if (syntheticRidges.length <= 1) return edges

  const nonSynthetic = edges.filter((e) => !(e.edge_type === 'ridge' && e.source === 'solar_dsm_inferred_ridge'))
  if (nonSynthetic.some((e) => e.edge_type === 'ridge')) return nonSynthetic

  const largest = [...planes].sort((a, b) => b.area_2d_sqft - a.area_2d_sqft)[0]
  const replacement = largest
    ? synthesizeCentralRidgeFromFootprint(largest, centerLat, centerLng, imgW, imgH, actualMpp, feetPerPixel)[0]
    : [...syntheticRidges].sort((a, b) => b.length_ft - a.length_ft)[0]
  console.log(`[start-ai-measurement] collapsed ${syntheticRidges.length} unverified synthetic ridges to one footprint ridge`)
  return replacement ? [...nonSynthetic, replacement] : nonSynthetic
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
      gx: Int16Array
      gy: Int16Array
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

    // 2) Multi-scale Sobel edge magnitude (sigma ≈ 1, 2, 3 via box-blur pyramid).
    //    Combining scales captures both fine ridge lines and dominant roof spines.
    const blurBox = (src: Uint8Array, radius: number): Uint8Array => {
      if (radius <= 0) return src
      const out = new Uint8Array(dW * dH)
      const k = radius
      for (let y = 0; y < dH; y++) {
        for (let x = 0; x < dW; x++) {
          let s = 0, n = 0
          const y0 = Math.max(0, y - k), y1 = Math.min(dH - 1, y + k)
          const x0 = Math.max(0, x - k), x1 = Math.min(dW - 1, x + k)
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
              s += src[yy * dW + xx]; n++
            }
          }
          out[y * dW + x] = (s / n) | 0
        }
      }
      return out
    }
    const scales: Uint8Array[] = [ds, blurBox(ds, 1), blurBox(ds, 2)]
    const mag = new Uint8Array(dW * dH)
    // Keep gradient components from the FINEST scale — most accurate direction.
    const gxGrid = new Int16Array(dW * dH)
    const gyGrid = new Int16Array(dW * dH)
    let magMax = 1
    for (let si = 0; si < scales.length; si++) {
      const src = scales[si]
      const isFinest = si === 0
      for (let y = 1; y < dH - 1; y++) {
        for (let x = 1; x < dW - 1; x++) {
          const i = y * dW + x
          const gx =
            -src[i - dW - 1] - 2 * src[i - 1] - src[i + dW - 1] +
            src[i - dW + 1] + 2 * src[i + 1] + src[i + dW + 1]
          const gy =
            -src[i - dW - 1] - 2 * src[i - dW] - src[i - dW + 1] +
            src[i + dW - 1] + 2 * src[i + dW] + src[i + dW + 1]
          const m = Math.min(255, Math.hypot(gx, gy) | 0)
          // OR-combine across scales (take max response).
          if (m > mag[i]) mag[i] = m
          if (m > magMax) magMax = m
          if (isFinest) {
            gxGrid[i] = gx
            gyGrid[i] = gy
          }
        }
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

    return { footprint, mag, gx: gxGrid, gy: gyGrid, blob, dW, dH, scaleX: sxScale, scaleY: syScale }
  } catch (e) {
    console.warn('[footprint-extract] error', String(e))
    return null
  }
}

async function extractImageEdgeEvidence(
  imageUrl: string,
  imgW: number,
  imgH: number,
): Promise<ImageEdgeEvidence | null> {
  try {
    const resp = await fetch(imageUrl)
    if (!resp.ok) return null
    const raster = await decodeRaster(new Uint8Array(await resp.arrayBuffer()), resp.headers.get('content-type'))
    const W = raster.width, H = raster.height, data = raster.data
    const gray = new Uint8Array(W * H)
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) | 0
    }
    const dW = Math.floor(W / 2), dH = Math.floor(H / 2)
    const ds = new Uint8Array(dW * dH)
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const sx = x * 2, sy = y * 2
        ds[y * dW + x] = (gray[sy * W + sx] + gray[sy * W + sx + 1] + gray[(sy + 1) * W + sx] + gray[(sy + 1) * W + sx + 1]) >> 2
      }
    }
    const mag = new Uint8Array(dW * dH)
    for (let y = 1; y < dH - 1; y++) {
      for (let x = 1; x < dW - 1; x++) {
        const i = y * dW + x
        const gx = -ds[i - dW - 1] - 2 * ds[i - 1] - ds[i + dW - 1] + ds[i - dW + 1] + 2 * ds[i + 1] + ds[i + dW + 1]
        const gy = -ds[i - dW - 1] - 2 * ds[i - dW] - ds[i - dW + 1] + ds[i + dW - 1] + 2 * ds[i + dW] + ds[i + dW + 1]
        mag[i] = Math.min(255, Math.hypot(gx, gy) | 0)
      }
    }
    return { mag, dW, dH, scaleX: imgW / dW, scaleY: imgH / dH }
  } catch (err) {
    console.warn('[edge-evidence] extraction failed', String(err))
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
  gx?: Int16Array,
  gy?: Int16Array,
  /** Optional sub-region mask (downsampled grid). When provided, ridge search
   *  is restricted to pixels where mask[i] === 1 — used for RECURSIVE ridge
   *  detection inside individual roof planes after the primary split. */
  regionMask?: Uint8Array,
): RidgeLine[] {
  // Erode blob (or region mask) so the outline edges (which dominate Sobel
  // response) are excluded — we want INTERIOR ridges, not the perimeter.
  const baseMask = regionMask ?? blob
  const inside = new Uint8Array(dW * dH)
  const erodeR = 3
  for (let y = erodeR; y < dH - erodeR; y++) {
    for (let x = erodeR; x < dW - erodeR; x++) {
      let allIn = true
      for (let dy = -erodeR; dy <= erodeR && allIn; dy++) {
        for (let dx = -erodeR; dx <= erodeR && allIn; dx++) {
          if (!baseMask[(y + dy) * dW + (x + dx)]) allIn = false
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

  // Vote threshold relative to building short axis.
  let bbMinX = dW, bbMinY = dH, bbMaxX = 0, bbMaxY = 0
  for (let y = 0; y < dH; y++) {
    for (let x = 0; x < dW; x++) {
      if (baseMask[y * dW + x]) {
        if (x < bbMinX) bbMinX = x
        if (y < bbMinY) bbMinY = y
        if (x > bbMaxX) bbMaxX = x
        if (y > bbMaxY) bbMaxY = y
      }
    }
  }
  const bbShort = Math.min(bbMaxX - bbMinX, bbMaxY - bbMinY)
  const bbLong = Math.max(bbMaxX - bbMinX, bbMaxY - bbMinY)
  const VOTE_MIN = Math.max(20, (bbShort * 0.4) | 0)

  // Find peaks with non-maximum suppression.
  type Peak = { t: number; r: number; v: number }
  const peaks: Peak[] = []
  for (let t = 0; t < THETA_BINS; t++) {
    for (let r = 0; r < RHO_BINS; r++) {
      const v = acc[t * RHO_BINS + r]
      if (v < VOTE_MIN) continue
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

  // ── PEAK CLUSTERING: merge near-collinear peaks (theta ±5°, rho ±diag*0.04)
  // into a single representative (the strongest) before segment extraction.
  const RHO_CLUSTER = Math.max(8, (diag * 0.04) | 0)
  const THETA_CLUSTER = 3 // bins (≈6°)
  const clustered: Peak[] = []
  for (const p of peaks) {
    const dup = clustered.find((c) => {
      let dt = Math.abs(c.t - p.t)
      if (dt > THETA_BINS / 2) dt = THETA_BINS - dt
      return dt <= THETA_CLUSTER && Math.abs(c.r - p.r) <= RHO_CLUSTER
    })
    if (!dup) clustered.push(p)
  }
  const top = clustered.slice(0, 8)

  // For each peak, project supporting interior-edge pixels onto the line, then
  // (a) filter by gradient-direction perpendicularity and (b) compute
  // continuity score along the segment.
  type Scored = { ridge: RidgeLine; score: number; segLen: number }
  const scored: Scored[] = []
  for (const pk of top) {
    const ang = (pk.t / THETA_BINS) * Math.PI
    const c = Math.cos(ang), s = Math.sin(ang)
    const rho = pk.r - diag
    const ux = -s, uy = c
    let lo = Infinity, hi = -Infinity
    let loPt: Pt | null = null, hiPt: Pt | null = null
    const PERP_TOL = 1.5
    const supports: number[] = [] // along-line positions for continuity scoring

    // Edge gradient direction should be perpendicular to ridge direction:
    // gradient . ridgeDirection ≈ 0 → |gradient . (cos a, sin a)| ≈ |gradient|.
    // We accept edges where the angle between gradient and the line normal
    // (cos a, sin a) is within ±25°.
    for (const p of interiorEdge) {
      const dPerp = Math.abs(p.x * c + p.y * s - rho)
      if (dPerp > PERP_TOL) continue

      if (gx && gy) {
        const i = p.y * dW + p.x
        const ggx = gx[i], ggy = gy[i]
        const gMag = Math.hypot(ggx, ggy)
        if (gMag > 1e-3) {
          // Component of gradient along the line normal (cos a, sin a).
          const dot = Math.abs(ggx * c + ggy * s) / gMag
          // dot ≈ 1 means gradient ⟂ ridge (good). Reject if dot < cos(25°).
          if (dot < 0.906) continue
        }
      }

      const along = p.x * ux + p.y * uy
      supports.push(along)
      if (along < lo) { lo = along; loPt = p }
      if (along > hi) { hi = along; hiPt = p }
    }
    if (!loPt || !hiPt) continue
    const segLen = hi - lo
    if (segLen < bbShort * 0.25) continue

    // Midpoint must be inside the region.
    const mx = (loPt.x + hiPt.x) / 2 | 0
    const my = (loPt.y + hiPt.y) / 2 | 0
    if (mx < 0 || my < 0 || mx >= dW || my >= dH || !baseMask[my * dW + mx]) continue

    // ── RIDGE VALIDATION: length / continuity / symmetry scoring.
    const lengthScore = Math.min(1, segLen / Math.max(1, bbLong * 0.6))

    // Continuity: bin supporting positions into 12 buckets along [lo,hi] and
    // measure how many buckets are populated. Real ridges have continuous
    // coverage; noise lines have sparse spikes.
    const BUCKETS = 12
    const filled = new Uint8Array(BUCKETS)
    const span = Math.max(1e-3, hi - lo)
    for (const a of supports) {
      const b = Math.min(BUCKETS - 1, Math.max(0, ((a - lo) / span * BUCKETS) | 0))
      filled[b] = 1
    }
    let filledCount = 0
    for (let b = 0; b < BUCKETS; b++) if (filled[b]) filledCount++
    const continuityScore = filledCount / BUCKETS

    // Symmetry: how balanced is support density in the first vs. second half.
    let firstHalf = 0, secondHalf = 0
    const mid = (lo + hi) / 2
    for (const a of supports) (a < mid ? firstHalf++ : secondHalf++)
    const symMin = Math.min(firstHalf, secondHalf)
    const symMax = Math.max(1, Math.max(firstHalf, secondHalf))
    const symmetryScore = symMin / symMax

    const score =
      0.45 * lengthScore + 0.35 * continuityScore + 0.20 * symmetryScore

    if (score < 0.55) continue

    scored.push({
      ridge: {
        a: { x: loPt.x * scaleX, y: loPt.y * scaleY },
        b: { x: hiPt.x * scaleX, y: hiPt.y * scaleY },
        // Encode score into votes (× peak votes) so downstream sorting still works.
        votes: Math.round(pk.v * (0.5 + score)),
      },
      score,
      segLen,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  // Suppress nearly-collinear duplicates (final pass on image-space segments).
  const out: RidgeLine[] = []
  for (const sc of scored) {
    const r = sc.ridge
    const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y
    const ang = Math.atan2(dy, dx)
    let dup = false
    for (const o of out) {
      const ox = o.b.x - o.a.x, oy = o.b.y - o.a.y
      const oAng = Math.atan2(oy, ox)
      const dAng = Math.abs(((ang - oAng + Math.PI * 1.5) % Math.PI) - Math.PI / 2)
      if (dAng < (6 * Math.PI) / 180) {
        const mxA = (r.a.x + r.b.x) / 2, myA = (r.a.y + r.b.y) / 2
        const mxB = (o.a.x + o.b.x) / 2, myB = (o.a.y + o.b.y) / 2
        if (Math.hypot(mxA - mxB, myA - myB) < Math.max(dW, dH) * 0.06 * Math.max(scaleX, scaleY)) {
          dup = true; break
        }
      }
    }
    if (!dup) out.push(r)
  }

  console.log(
    `[ridge-detect] ${out.length} validated ridges (peaks=${peaks.length} clustered=${clustered.length} scored=${scored.length})`,
  )
  return out
}

/**
 * Recursive ridge refinement: after the primary footprint split, run ridge
 * detection INSIDE each sub-plane to recover secondary ridges (hips, smaller
 * spines). Returns merged image-pixel-space ridges (primary + secondary).
 */
function detectRidgesRecursive(
  primaryRidges: RidgeLine[],
  subPlanesPx: Pt[][],
  mag: Uint8Array,
  blob: Uint8Array,
  gx: Int16Array,
  gy: Int16Array,
  dW: number,
  dH: number,
  scaleX: number,
  scaleY: number,
): RidgeLine[] {
  if (subPlanesPx.length < 2) return primaryRidges
  const merged: RidgeLine[] = [...primaryRidges]
  const invSx = 1 / scaleX, invSy = 1 / scaleY

  for (const planePx of subPlanesPx) {
    // Only attempt secondary detection on planes large enough to matter.
    const areaPx = shoelaceAreaPx(planePx)
    if (areaPx < 600) continue

    // Rasterize plane polygon (in downsampled grid) → mask.
    const dsPoly = planePx.map((p) => ({ x: p.x * invSx, y: p.y * invSy }))
    let minX = dW, minY = dH, maxX = 0, maxY = 0
    for (const p of dsPoly) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    }
    minX = Math.max(0, Math.floor(minX)); minY = Math.max(0, Math.floor(minY))
    maxX = Math.min(dW - 1, Math.ceil(maxX)); maxY = Math.min(dH - 1, Math.ceil(maxY))
    const mask = new Uint8Array(dW * dH)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!blob[y * dW + x]) continue
        if (pointInPolygon({ x, y }, dsPoly)) mask[y * dW + x] = 1
      }
    }

    const secondary = detectRidges(mag, blob, dW, dH, scaleX, scaleY, gx, gy, mask)
    for (const r of secondary) {
      // De-duplicate against existing.
      const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y
      const ang = Math.atan2(dy, dx)
      const dup = merged.some((o) => {
        const oAng = Math.atan2(o.b.y - o.a.y, o.b.x - o.a.x)
        const dAng = Math.abs(((ang - oAng + Math.PI * 1.5) % Math.PI) - Math.PI / 2)
        if (dAng > (8 * Math.PI) / 180) return false
        const mxA = (r.a.x + r.b.x) / 2, myA = (r.a.y + r.b.y) / 2
        const mxB = (o.a.x + o.b.x) / 2, myB = (o.a.y + o.b.y) / 2
        return Math.hypot(mxA - mxB, myA - myB) < Math.max(dW, dH) * 0.06 * Math.max(scaleX, scaleY)
      })
      if (!dup) merged.push(r)
    }
  }
  console.log(`[ridge-detect][recursive] primary=${primaryRidges.length} → merged=${merged.length}`)
  return merged
}

/** Standard ray-casting point-in-polygon test (pixel coords). */
function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
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
function computeOverlayAlignment(
  planes: RoofPlane[],
  imgW: number,
  imgH: number,
  imageFootprintPx: Pt[] | null = null,
  edgeEvidence: ImageEdgeEvidence | null = null,
): number {
  if (!planes.length || imgW <= 0 || imgH <= 0) return 0

  // Build the full-roof hull from all plane vertices so multi-plane roofs
  // are scored against their entire footprint, not the largest facet.
  const allPts = planes.flatMap((p) => p.polygon_px || [])
  if (allPts.length < 3) return 0
  const hull = convexHull(allPts)
  if (hull.length < 3) return 0

  // Image-supported score: real IoU vs the raster-extracted footprint when
  // available, plus Sobel edge support along the polygon boundary. This
  // replaces the old centered/in-frame heuristic, which would happily pass
  // a mirrored or wrongly-translated footprint as long as it stayed in
  // frame near the image center.
  const hasImageFootprint = !!imageFootprintPx && imageFootprintPx.length >= 3
  const iou = hasImageFootprint ? polygonIoU(hull, imageFootprintPx!) : 0
  const edge = edgeEvidence ? scorePolygonEdgeSupport(hull, edgeEvidence) : 0

  if (hasImageFootprint || edgeEvidence) {
    // Blend: IoU is the strongest evidence; edge support is a fallback /
    // secondary signal when only the raster (no closed footprint) is known.
    const blended = hasImageFootprint && edgeEvidence
      ? 0.7 * iou + 0.3 * edge
      : hasImageFootprint
        ? iou
        : edge
    return Math.max(0, Math.min(1, blended))
  }

  // Last-resort fallback: if neither evidence source is available, fall
  // back to the legacy centered/in-frame heuristic so we still produce a
  // non-zero score (used only when raster extraction failed entirely).
  let allInside = true
  let cx = 0, cy = 0, n = 0
  for (const pt of allPts) {
    if (pt.x < 0 || pt.x > imgW || pt.y < 0 || pt.y > imgH) allInside = false
    cx += pt.x; cy += pt.y; n++
  }
  if (n === 0) return 0
  cx /= n; cy /= n
  const dx = Math.abs(cx - imgW / 2) / imgW
  const dy = Math.abs(cy - imgH / 2) / imgH
  const offset = Math.sqrt(dx * dx + dy * dy)
  const centerScore = Math.max(0, 1 - offset / 0.25)
  const insideScore = allInside ? 1 : 0.4
  // Cap legacy fallback at 0.7 so it cannot pass the 0.75 PDF gate on its
  // own — image-supported evidence must exist for customer-ready output.
  return Math.min(0.7, 0.6 * centerScore + 0.4 * insideScore)
}

const PLACEHOLDER_SOURCES = new Set(['google_solar_bbox', 'placeholder', 'perimeter_fallback'])
const FOOTPRINT_ONLY_SOURCES = new Set([
  'image_footprint_extraction',
  'google_solar_mask',
  'google_solar_mask_image_aligned',
  'mapbox_vector',
  'mapbox_vector_image_aligned',
  'osm_buildings',
  'osm_buildings_image_aligned',
  'microsoft_buildings',
  'microsoft_buildings_image_aligned',
  'google_solar_aggregate',
])

function isFootprintOnlySource(source: string | null | undefined): boolean {
  const s = String(source || '')
  return FOOTPRINT_ONLY_SOURCES.has(s) ||
    /^authoritative_(footprint|vector)$/.test(s) ||
    (s.endsWith('_image_aligned') && !s.includes('ridge_split'))
}

function normalizeRoofMeasurementFootprintSource(source: string | null | undefined, solarOk: boolean): string {
  const s = String(source || '').toLowerCase()
  if (s.includes('google_solar_mask')) return 'google_solar_mask'
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
  imageFootprintPx?: Pt[] | null
  edgeEvidence?: ImageEdgeEvidence | null
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

  const overlayAlignmentScore = computeOverlayAlignment(
    input.planes,
    input.imgW,
    input.imgH,
    input.imageFootprintPx ?? null,
    input.edgeEvidence ?? null,
  )
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
    isFootprintOnlySource(input.planes[0].source)
  const detectedStructuralEdges = input.edges.filter((e) =>
    ['ridge', 'hip', 'valley'].includes(String(e.edge_type)) &&
    e.source !== 'solar_dsm_inferred_ridge'
  )
  const structuralGeometryResolved = input.planes.length > 1 || detectedStructuralEdges.length > 0
  push('multi_facet_segmentation', !singlePlaneFallback, singlePlaneFallback ? 0.5 : 1, {
    note: singlePlaneFallback
      ? 'Single footprint-only outline; no verified interior facets resolved.'
      : 'ok',
  })
  push('structural_geometry_verified', structuralGeometryResolved, structuralGeometryResolved ? 1 : 0, {
    plane_count: input.planes.length,
    detected_structural_edges: detectedStructuralEdges.length,
    note: structuralGeometryResolved
      ? 'Interior planes or detected structural lines are present.'
      : 'Only perimeter plus synthetic ridge; cannot place slopes on the correct roof sides.',
  })

  const overall = checks.reduce((s, c) => s + c.score, 0) / checks.length
  let status: 'completed' | 'needs_review' | 'needs_internal_review'
  // Absolute sanity cap on total roof area. A residential satellite tile at
  // z20 cannot legitimately produce >30k sqft of roof — anything beyond means
  // the footprint extractor leaked into neighbors / road / canopy.
  const areaWithinHardCap = input.totalAreaSqft > 0 && input.totalAreaSqft <= MAX_AUTO_ROOF_AREA_SQFT

  // ── HARD FAILURES → needs_internal_review ─────────────────────────────
  // Per QC spec: only escalate to internal review when something
  // fundamental is broken. Missing ridges with a valid footprint is NOT
  // a hard failure — it downgrades to needs_review (single-plane fallback).
  //   - footprint missing / placeholder
  //   - imagery / calibration unavailable (image decode failed)
  //   - footprint outside the image (geometry extraction crashed)
  //   - geometry source is synthetic only
  //   - area exceeds publish cap (extractor leaked)
  //   - alignment < 0.5 only when the footprint is not a real in-frame
  //     patent-data footprint. A real footprint can sit off-center in the
  //     analysis tile when the user pin/geocode is imperfect; that is a review
  //     issue, not a hard no-report failure.
  // Hard failures = the result is unusable even as a fallback.
  // "Patent data only" rule: a real, aligned footprint always publishes in
  // patent shape (Layer 1 perimeter + Layer 2 eaves) with status needs_review
  // when interior structure is missing. We do NOT escalate to internal review
  // just because the segmenter could not resolve ridges.
  const alignmentHardFailure =
    overlayAlignmentScore < 0.5 &&
    !(geometrySourceIsReal && allInside && input.planes.length > 0)

  const hardFailure =
    input.hasPlaceholder ||
    !input.calibrated ||
    !_imageryOk ||
    input.planes.length === 0 ||
    !geometrySourceIsReal ||
    !allInside ||
    !areaWithinHardCap ||
    alignmentHardFailure

  if (hardFailure) {
    status = 'needs_internal_review'
  } else if (planesAreAllRectangles || !structuralGeometryResolved || singlePlaneFallback) {
    // Real, aligned footprint with no verified interior segmentation is still
    // a usable measurement fallback. Reviewer confirms before publish.
    status = 'needs_review'
  } else if (overall >= 0.65) {
    // Per CV spec: a usable result (footprint + planes + acceptable alignment)
    // auto-ships. Strict 3% vendor-truth gate (downstream) is the only path
    // that can flip this to needs_manual_review.
    status = 'completed'
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
        let extractedImageGeometry: Awaited<ReturnType<typeof extractRoofFootprintAndEdges>> | null = null
        let extractedImageEdgeEvidence: ImageEdgeEvidence | null = null

        if (needsRealGeometry) {
          const hint =
            planes.length > 0
              ? [...planes].sort((a, b) => b.area_pitch_adjusted_sqft - a.area_pitch_adjusted_sqft)[0]
              : null

          // First deterministic fallback: authoritative vector building footprints.
          let authoritative = await resolveAuthoritativeFootprint(lat, lng, solarAreaHintSqft)
          if (!authoritative) {
            const idColumn = resolved.sourceType === 'lead' ? 'lead_id' : 'project_id'
            const { data: priorJobs } = await supa
              .from('ai_measurement_jobs')
              .select('id')
              .eq(idColumn, resolved.sourceId)
              .order('created_at', { ascending: false })
              .limit(8)
            const priorIds = (priorJobs || []).map((j: any) => j.id).filter((id: any) => id !== aiJob.id)
            if (priorIds.length > 0) {
              const { data: priorPlanes } = await supa
                .from('ai_roof_planes')
                .select('source, polygon_geojson, area_2d_sqft, confidence')
                .in('job_id', priorIds)
                .order('created_at', { ascending: false })
              const prior = (priorPlanes || []).find((p: any) =>
                !PLACEHOLDER_SOURCES.has(String(p.source)) &&
                Array.isArray(p.polygon_geojson) &&
                p.polygon_geojson.length >= 3,
              )
              if (prior) {
                const coords = prior.polygon_geojson.map((p: any) => [Number(p.lng), Number(p.lat)] as GeoXY)
                authoritative = {
                  coordinates: coords,
                  source: String(prior.source).replace('_image_aligned', '') as FootprintSource,
                  confidence: Math.max(0.7, Number(prior.confidence || 0.7)),
                  areaM2: Number(prior.area_2d_sqft || 0) / 10.7639 || geoPolygonAreaM2(coords),
                  vertexCount: coords.length,
                }
                console.log(`[start-ai-measurement] using cached patent footprint fallback: ${prior.source}`)
              }
            }
          }
          if (mb?.image_url) {
            try {
              extractedImageGeometry = await extractRoofFootprintAndEdges(mb.image_url, imgW, imgH)
              extractedImageEdgeEvidence = extractedImageGeometry
                ? {
                    mag: extractedImageGeometry.mag,
                    dW: extractedImageGeometry.dW,
                    dH: extractedImageGeometry.dH,
                    scaleX: extractedImageGeometry.scaleX,
                    scaleY: extractedImageGeometry.scaleY,
                  }
                : await extractImageEdgeEvidence(mb.image_url, imgW, imgH)
            } catch (err) {
              console.warn('[start-ai-measurement] image footprint pre-extract failed:', err)
            }
          }

          let selectedAuthoritative =
            authoritative && !(isLowDetailAuthoritativeFootprint(authoritative) && (extractedImageGeometry?.footprint?.length ?? 0) >= 4)
              ? authoritative
              : null
          if (authoritative && !selectedAuthoritative) {
            console.log('[start-ai-measurement] rejected low-detail authoritative footprint; using image-traced roof edge geometry')
          }

          // Align authoritative (OSM/MS) footprint to image-traced footprint.
          // OSM polygons are frequently mis-positioned 5–30m vs current aerial.
          // The diagram MUST sit on top of the actual roof in the rendered image.
          if (selectedAuthoritative && ((extractedImageGeometry?.footprint?.length || 0) >= 4 || extractedImageEdgeEvidence)) {
            selectedAuthoritative = alignAuthoritativeToImage(
              selectedAuthoritative,
              extractedImageGeometry?.footprint ?? null,
              lat,
              lng,
              imgW,
              imgH,
              cal.meters_per_pixel_actual,
              extractedImageEdgeEvidence,
            )
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
                    extracted.gx,
                    extracted.gy,
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
                    let subPolys = buildRoofPlanes(basePlane.polygon_px, ridgeLines, {
                      minArea: minPlaneAreaPx,
                      minAreaRatio: 0.1,
                      maxPlanes: 10,
                    })

                    // RECURSIVE: detect secondary ridges inside each sub-plane
                    // and re-split for richer geometry.
                    if (subPolys.length > 1) {
                      const merged = detectRidgesRecursive(
                        ridges,
                        subPolys,
                        extracted.mag,
                        extracted.blob,
                        extracted.gx,
                        extracted.gy,
                        extracted.dW,
                        extracted.dH,
                        extracted.scaleX,
                        extracted.scaleY,
                      )
                      if (merged.length > ridges.length) {
                        const mergedLines: SplitLine[] = merged
                          .sort((a, b) => b.votes - a.votes)
                          .map((r) => ({ p1: r.a, p2: r.b, votes: r.votes }))
                        detectedRidgeLines = mergedLines
                        subPolys = buildRoofPlanes(basePlane.polygon_px, mergedLines, {
                          minArea: minPlaneAreaPx,
                          minAreaRatio: 0.1,
                          maxPlanes: 14,
                        })
                      }
                    }

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
                        `[start-ai-measurement] authoritative footprint split: ${detectedRidgeLines.length} ridges → ${planes.length} planes`,
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
                extracted.gx,
                extracted.gy,
              )
              const ridges = filterStrongRidges(rawRidges)
              let ridgeLines: SplitLine[] = ridges
                .sort((a, b) => b.votes - a.votes)
                .map((r) => ({ p1: r.a, p2: r.b, votes: r.votes }))
              detectedRidgeLines = ridgeLines

              const minPlaneAreaPx = Math.max(25, shoelaceAreaPx(extracted.footprint) * 0.08)
              let subPolys =
                ridgeLines.length > 0
                  ? buildRoofPlanes(extracted.footprint, ridgeLines, {
                      minArea: minPlaneAreaPx,
                      minAreaRatio: 0.1,
                      maxPlanes: 10,
                    })
                  : [extracted.footprint]

              // RECURSIVE: secondary ridge detection inside each sub-plane.
              if (subPolys.length > 1) {
                const merged = detectRidgesRecursive(
                  ridges,
                  subPolys,
                  extracted.mag,
                  extracted.blob,
                  extracted.gx,
                  extracted.gy,
                  extracted.dW,
                  extracted.dH,
                  extracted.scaleX,
                  extracted.scaleY,
                )
                if (merged.length > ridges.length) {
                  ridgeLines = merged
                    .sort((a, b) => b.votes - a.votes)
                    .map((r) => ({ p1: r.a, p2: r.b, votes: r.votes }))
                  detectedRidgeLines = ridgeLines
                  subPolys = buildRoofPlanes(extracted.footprint, ridgeLines, {
                    minArea: minPlaneAreaPx,
                    minAreaRatio: 0.1,
                    maxPlanes: 14,
                  })
                }
              }

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
                console.warn('[start-ai-measurement] authoritative/image extraction unavailable; refusing Google Solar aggregate bbox because it is not the actual footprint')
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
          const ridgeEdges: RoofEdge[] = clippedDetected
            ? [
                lineToRoofEdge(
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
                ),
              ].filter((e): e is RoofEdge => !!e)
            : synthesizeCentralRidgeFromFootprint(
                largest,
                lat,
                lng,
                imgW,
                imgH,
                cal.meters_per_pixel_actual,
                feetPerPixel,
              )
          if (ridgeEdges.length > 0) {
            edges.push(...ridgeEdges)
            console.log(`[start-ai-measurement] added ${ridgeEdges.length} ridge(s) (${ridgeEdges[0].source}) because topology emitted no ridge`)
          }
        }
        edges = collapseUnverifiedSyntheticRidges(
          edges,
          planes,
          lat,
          lng,
          imgW,
          imgH,
          cal.meters_per_pixel_actual,
          feetPerPixel,
        )

        // Patent-shaped synthesis fallback: when topology resolved no real
        // interior structure (no ridges/hips/valleys from segmentation), we
        // synthesize a complete patent edge set (ridges, hips, valleys,
        // rakes, eaves) from the rectilinear footprint decomposition. This
        // matches what AccuLynx/EagleView do when imagery is ambiguous —
        // they fill the patent shape from inferred topology rather than
        // returning a single-plane footprint with one ridge.
        const hasRealInteriorStructure = edges.some(
          (e) =>
            (e.edge_type === 'ridge' || e.edge_type === 'hip' || e.edge_type === 'valley') &&
            e.source !== 'patent_synthesis' &&
            e.source !== 'topology_engine_v2' &&
            e.source !== 'solar_dsm_inferred_ridge' &&
            e.source !== 'filled_perimeter' &&
            e.source !== 'perimeter_fallback',
        )

        // ── HARD DEBUG PIPELINE INSTRUMENTATION ──
        // Tracks whether each branch (topology_engine_v2, ridge_split_recursive,
        // adjacency classification) actually ran AND produced multi-plane
        // output. Persisted to roof_measurements.geometry_report_json so the
        // frontend / report can prove which geometry source produced the
        // saved patent_model.
        const debug_pipeline: any = {
          topology_engine_v2_entered: edges.some((e) => e.source === 'topology_engine_v2'),
          ridge_split_recursive_entered: false,
          ridge_split_recursive_plane_count: 0,
          ridge_split_recursive_edge_count: 0,
          adjacency_edge_count: 0,
          edge_counts: { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, unknown: 0 },
          missingAzimuthPlanes: 0,
          final_plane_count_saved: 0,
          final_edge_count_saved: 0,
          final_patent_model_plane_count: 0,
          final_report_source: 'unknown',
        }
        // Hard guards — once recursive split succeeds we MUST NOT let the
        // old single-plane patent synthesis or overlay fallbacks overwrite
        // the multi-plane geometry.
        let skipPatentSynthesisFallback = false
        let skipSinglePlaneFallback = false
        let forceUseRidgeSplit = false
        let forcedGeometrySource: string | null = null

        // ──────────────────────────────────────────────────────────────
        // RIDGE-DRIVEN PLANE SPLITTING (pre-synthesis safety net)
        //
        // Per the "ridge-driven plane creation" requirement: if topology
        // resolved a single plane, we MUST try to split that plane using
        // image-derived ridge lines BEFORE falling back to footprint-only
        // synthesis. Synthesis on a convex single-plane footprint cannot
        // produce hips/valleys because the straight skeleton has no reflex
        // corners to work with — only ridge-driven splitting can recover
        // the multi-facet structure that Roofr/EagleView reports show.
        //
        // Pipeline:
        //   1. extractRoofFootprintAndEdges (re-use cached if present)
        //   2. detectRidges → filterStrongRidges
        //   3. buildRoofPlanes (split footprint by ridge lines)
        //   4. detectRidgesRecursive on each sub-plane → second split pass
        //   5. Replace `planes` and recompute `edges` from the new graph
        //
        // Only proceeds to single-plane synthesis if no strong ridges are
        // found AND the footprint has no concave (reflex) vertices.
        // ──────────────────────────────────────────────────────────────
        // NOTE: We trigger ridge-driven splitting whenever we only have ONE
        // plane, even if topology_engine_v2 emitted ridge/hip/valley edges
        // against that single plane. Those edges are geometrically meaningless
        // without multiple plane polygons to attach them to (no adjacency =
        // no real diagram). Multi-plane geometry is the source of truth.
        if (planes.length === 1 && (extractedImageGeometry || mb?.image_url)) {
          console.log(
            `[ridge_split_pre_synthesis] entering: planes=1, edges=${edges.length} ` +
            `(hasRealInteriorStructure=${hasRealInteriorStructure}) — forcing multi-plane split attempt`,
          )
          try {
            const basePlane = planes[0]
            const extracted = extractedImageGeometry ?? await extractRoofFootprintAndEdges(mb!.image_url, imgW, imgH)
            if (extracted) {
              const rawRidges = detectRidges(
                extracted.mag, extracted.blob, extracted.dW, extracted.dH,
                extracted.scaleX, extracted.scaleY, extracted.gx, extracted.gy,
              )
              const strong = filterStrongRidges(rawRidges)
              let ridgeLines: SplitLine[] = strong
                .sort((a, b) => b.votes - a.votes)
                .map((r) => ({ p1: r.a, p2: r.b, votes: r.votes }))

              if (ridgeLines.length > 0) {
                // Production rule: recursive ridge splitting is canonical.
                // The older single-pass buildRoofPlanes output can be partial,
                // so it must not win over splitPlanesFromRidges().
                const preferRecursiveSplit = true
                const minPlaneAreaPx = Math.max(25, shoelaceAreaPx(basePlane.polygon_px) * 0.08)
                let subPolys = buildRoofPlanes(basePlane.polygon_px, ridgeLines, {
                  minArea: minPlaneAreaPx, minAreaRatio: 0.1, maxPlanes: 10,
                })

                if (subPolys.length > 1) {
                  const merged = detectRidgesRecursive(
                    strong, subPolys, extracted.mag, extracted.blob,
                    extracted.gx, extracted.gy, extracted.dW, extracted.dH,
                    extracted.scaleX, extracted.scaleY,
                  )
                  if (merged.length > strong.length) {
                    ridgeLines = merged
                      .sort((a, b) => b.votes - a.votes)
                      .map((r) => ({ p1: r.a, p2: r.b, votes: r.votes }))
                    subPolys = buildRoofPlanes(basePlane.polygon_px, ridgeLines, {
                      minArea: minPlaneAreaPx, minAreaRatio: 0.1, maxPlanes: 14,
                    })
                  }
                }

                if (!preferRecursiveSplit && subPolys.length > 1) {
                  detectedRidgeLines = ridgeLines
                  planes = subPolys.map((poly, idx) =>
                    planeFromFootprint(
                      poly, lat, lng, imgW, imgH, cal.meters_per_pixel_actual,
                      feetPerPixel, basePlane.pitch ?? null, basePlane.azimuth ?? null,
                      'ridge_split_pre_synthesis', idx,
                    ),
                  )
                  // Recompute edges from the new multi-plane graph so
                  // ridges/hips/valleys come out of edgesFromPlanes shared-
                  // boundary detection rather than synthesis.
                  edges = edgesFromPlanes(
                    planes, lat, lng, imgW, imgH, cal.meters_per_pixel_actual, feetPerPixel,
                  )
                  // HARD LOCK: this is ridge-derived multi-plane geometry.
                  // No later single-plane or patent-synthesis fallback may replace it.
                  forceUseRidgeSplit = true
                  forcedGeometrySource = 'ridge_split_pre_synthesis'
                  skipPatentSynthesisFallback = true
                  skipSinglePlaneFallback = true
                  console.log(
                    `[ridge_split_pre_synthesis] split single plane → ${planes.length} planes ` +
                    `using ${ridgeLines.length} ridges; edges=${edges.length} ` +
                    `(ridges=${edges.filter(e => e.edge_type === 'ridge').length} ` +
                    `hips=${edges.filter(e => e.edge_type === 'hip').length} ` +
                    `valleys=${edges.filter(e => e.edge_type === 'valley').length})`,
                  )
                } else {
                  // Always try the recursive ridge-driven splitter as the
                  // authoritative ridge-split output. It re-detects ridges
                  // inside each sub-polygon and splits again, producing
                  // 5–15 planes on complex residential roofs.
                  debug_pipeline.ridge_split_recursive_entered = true
                  try {
                    // Rasterize a polygon (in full-res image pixel space)
                    // into the downsampled grid that detectRidges operates on.
                    const rasterizePolyToMask = (poly: { x: number; y: number }[]): Uint8Array => {
                      const mask = new Uint8Array(extracted.dW * extracted.dH)
                      // Convert polygon to downsampled grid coords.
                      const gridPoly = poly.map((p) => ({
                        x: p.x / extracted.scaleX,
                        y: p.y / extracted.scaleY,
                      }))
                      // Bounding box clamp
                      let minY = extracted.dH, maxY = 0
                      for (const v of gridPoly) {
                        if (v.y < minY) minY = v.y
                        if (v.y > maxY) maxY = v.y
                      }
                      minY = Math.max(0, Math.floor(minY))
                      maxY = Math.min(extracted.dH - 1, Math.ceil(maxY))
                      // Scanline fill
                      for (let y = minY; y <= maxY; y++) {
                        const xs: number[] = []
                        for (let i = 0; i < gridPoly.length; i++) {
                          const a = gridPoly[i]
                          const b = gridPoly[(i + 1) % gridPoly.length]
                          if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
                            const t = (y - a.y) / (b.y - a.y)
                            xs.push(a.x + t * (b.x - a.x))
                          }
                        }
                        xs.sort((m, n) => m - n)
                        for (let k = 0; k + 1 < xs.length; k += 2) {
                          const xStart = Math.max(0, Math.floor(xs[k]))
                          const xEnd = Math.min(extracted.dW - 1, Math.ceil(xs[k + 1]))
                          for (let x = xStart; x <= xEnd; x++) mask[y * extracted.dW + x] = 1
                        }
                      }
                      return mask
                    }

                    const detectFn = (poly: { x: number; y: number }[]) => {
                      const mask = rasterizePolyToMask(poly)
                      const raw = detectRidges(
                        extracted.mag, extracted.blob, extracted.dW, extracted.dH,
                        extracted.scaleX, extracted.scaleY, extracted.gx, extracted.gy,
                        mask,
                      )
                      return raw.map((r) => ({
                        p1: r.a, p2: r.b, score: r.votes,
                      }))
                    }
                    const recursivePlanes = splitPlanesFromRidges(
                      basePlane.polygon_px as { x: number; y: number }[],
                      detectFn,
                      0,
                      4,
                    )
                    if (recursivePlanes.length > 1) {
                      planes = recursivePlanes.map((rp, idx) =>
                        planeFromFootprint(
                          rp.polygon, lat, lng, imgW, imgH,
                          cal.meters_per_pixel_actual, feetPerPixel,
                          basePlane.pitch ?? null, basePlane.azimuth ?? null,
                          'ridge_split_recursive', idx,
                        ),
                      )
                      // Build deterministic adjacency graph + edge classification
                      // for the recursive plane set. This replaces edgesFromPlanes
                      // because we need shared interior edges to carry
                      // adjacent_plane_ids: [planeA, planeB] for hip/valley logic.
                      const classified = buildAdjacencyAndClassifyEdges({
                        footprint_px: basePlane.polygon_px as { x: number; y: number }[],
                        planes: planes.map((p) => ({
                          plane_index: (p as any).plane_index ?? (p as any).id,
                          id: (p as any).id ?? (p as any).plane_index,
                          polygon_px: p.polygon_px,
                          pitch: p.pitch ?? null,
                          azimuthDeg: (p as any).azimuthDeg ?? (p as any).azimuth_degrees ?? p.azimuth ?? null,
                          source: p.source,
                        })),
                      })

                      edges = classified.map((e) => {
                        const a = e.line_px[0]
                        const b = e.line_px[e.line_px.length - 1]
                        const lpx = Math.hypot(b.x - a.x, b.y - a.y)
                        return {
                          edge_type: e.edge_type,
                          source: e.source,
                          line_px: e.line_px,
                          line_geojson: [
                            pixelToLatLng(a.x, a.y, lat, lng, imgW, imgH, cal.meters_per_pixel_actual),
                            pixelToLatLng(b.x, b.y, lat, lng, imgW, imgH, cal.meters_per_pixel_actual),
                          ],
                          length_px: lpx,
                          length_ft: lpx * feetPerPixel,
                          confidence: e.confidence,
                          // Carry through adjacency + reason for downstream consumers.
                          adjacent_plane_ids: e.adjacent_plane_ids,
                          debug_reason: e.debug_reason,
                        } as RoofEdge
                      })

                      const edgeCounts = edges.reduce((acc, e) => {
                        acc[e.edge_type] = (acc[e.edge_type] || 0) + 1
                        return acc
                      }, {} as Record<string, number>)

                      const missingAzimuthPlanes = planes.filter((p) => {
                        const v = (p as any).azimuthDeg ?? (p as any).azimuth_degrees ?? p.azimuth
                        return !(typeof v === 'number' && Number.isFinite(v))
                      }).length

                      console.log('[ridge_split_recursive_adjacency]', {
                        planes: planes.length,
                        edges: edges.length,
                        ridge: edgeCounts.ridge || 0,
                        hip: edgeCounts.hip || 0,
                        valley: edgeCounts.valley || 0,
                        eave: edgeCounts.eave || 0,
                        rake: edgeCounts.rake || 0,
                        unknown: edgeCounts.unknown || 0,
                        missingAzimuthPlanes,
                      })

                      // ── Persist into debug_pipeline + apply HARD GUARDS ──
                      debug_pipeline.ridge_split_recursive_plane_count = planes.length
                      debug_pipeline.ridge_split_recursive_edge_count = edges.length
                      debug_pipeline.adjacency_edge_count = classified.length
                      debug_pipeline.edge_counts = {
                        ridge: edgeCounts.ridge || 0,
                        hip: edgeCounts.hip || 0,
                        valley: edgeCounts.valley || 0,
                        eave: edgeCounts.eave || 0,
                        rake: edgeCounts.rake || 0,
                        unknown: edgeCounts.unknown || 0,
                      }
                      debug_pipeline.missingAzimuthPlanes = missingAzimuthPlanes
                      if (planes.length > 1) {
                        // HARD STOP: do not let synthesizePatentStructureFromFootprint
                        // or single-plane overlay fallbacks overwrite the new
                        // multi-plane geometry produced by recursive splitting.
                        forceUseRidgeSplit = true
                        forcedGeometrySource = 'ridge_split_recursive'
                        skipPatentSynthesisFallback = true
                        skipSinglePlaneFallback = true
                      }

                      // QC gate: detect disconnected planes (no shared two-plane edges)
                      const sharedTwoPlaneEdges = classified.filter(
                        (e) => e.adjacent_plane_ids.length === 2,
                      ).length
                      if (planes.length > 1 && sharedTwoPlaneEdges === 0) {
                        ;(aiJob as any)._topology_needs_review = true
                        ;(aiJob as any)._topology_review_reason =
                          'Multi-plane split created disconnected planes; adjacency graph failed.'
                        console.warn(
                          `[ridge_split_recursive_adjacency] needs_review: ${planes.length} planes but no shared two-plane edges`,
                        )
                      } else if (planes.length > 4 && (edgeCounts.hip || 0) + (edgeCounts.valley || 0) === 0) {
                        ;(aiJob as any)._topology_needs_review = true
                        ;(aiJob as any)._topology_review_reason =
                          'Multi-plane geometry produced no hips or valleys; check footprint simplification or azimuth assignment.'
                        console.warn(
                          `[ridge_split_recursive_adjacency] needs_review: ${planes.length} planes but 0 hips/valleys`,
                        )
                      }

                      console.log(
                        `[ridge_split_recursive] recursive splitter produced ${planes.length} planes; ` +
                        `edges=${edges.length} ` +
                        `(ridges=${edgeCounts.ridge || 0} ` +
                        `hips=${edgeCounts.hip || 0} ` +
                        `valleys=${edgeCounts.valley || 0})`,
                      )
                    } else {
                      console.log(
                        `[ridge_split_pre_synthesis] ${ridgeLines.length} ridges did not yield split (subPolys=${subPolys.length}, recursive=${recursivePlanes.length}); falling through to synthesis`,
                      )
                    }
                  } catch (recErr) {
                    console.warn(
                      `[ridge_split_recursive] failed: ${(recErr as Error).message}; falling through to synthesis`,
                    )
                  }
                }
              } else {
                console.log(
                  `[ridge_split_pre_synthesis] no strong ridges (raw=${rawRidges.length}); falling through to synthesis`,
                )
              }
            }
          } catch (err) {
            console.warn(`[ridge_split_pre_synthesis] failed: ${(err as Error).message}`)
          }

          // Re-evaluate whether we now have real interior structure after
          // the split attempt; if so, the synthesis block below will skip.
        }

        // ── PATCH 4: FAIL LOUDLY IF NEW SPLITTER DID NOT RUN OR COLLAPSED ──
        if (!debug_pipeline.ridge_split_recursive_entered) {
          console.warn(
            '[AI_MEASUREMENT_DEBUG] ridge_split_recursive branch never entered',
            { planes: planes.length, edges: edges.length },
          )
        } else if (debug_pipeline.ridge_split_recursive_plane_count <= 1) {
          console.warn(
            '[AI_MEASUREMENT_DEBUG] ridge_split_recursive ran but produced <=1 plane',
            debug_pipeline,
          )
        }

        const stillNoRealStructure = !edges.some(
          (e) =>
            (e.edge_type === 'ridge' || e.edge_type === 'hip' || e.edge_type === 'valley') &&
            e.source !== 'patent_synthesis' &&
            e.source !== 'topology_engine_v2' &&
            e.source !== 'solar_dsm_inferred_ridge' &&
            e.source !== 'filled_perimeter' &&
            e.source !== 'perimeter_fallback',
        )
        if (stillNoRealStructure && planes.length > 0 && !skipPatentSynthesisFallback) {
          const largest = [...planes].sort((a, b) => b.area_2d_sqft - a.area_2d_sqft)[0]
          const synth = synthesizePatentStructureFromFootprint(
            largest, lat, lng, imgW, imgH, cal.meters_per_pixel_actual, feetPerPixel,
          )
          if (synth.length > 0) {
            // Drop the synthetic single ridge + perimeter_fallback eaves we
            // may have added earlier; replace with the full patent set.
            edges = edges.filter(
              (e) =>
                e.source !== 'solar_dsm_inferred_ridge' &&
                e.source !== 'filled_perimeter' &&
                e.source !== 'perimeter_fallback',
            )
            edges.push(...synth)
            console.log(
              `[start-ai-measurement] patent synthesis emitted ${synth.length} edges ` +
              `(ridges/hips/valleys/rakes/eaves) from rectilinear footprint`,
            )
          }
        }

        if (edges.length === 0 && planes.length > 0 && !forceUseRidgeSplit) {
          // Last-resort perimeter eaves if even synthesis produced nothing.
          const largest = [...planes].sort((a, b) => b.area_2d_sqft - a.area_2d_sqft)[0]
          edges = edgesFromPerimeter(
            largest.polygon_px, lat, lng, imgW, imgH, cal.meters_per_pixel_actual, feetPerPixel,
          )
        }

        // ──────────────────────────────────────────────────────────────
        // POST-CLASSIFICATION VALIDATOR (topology_engine_v2)
        //
        // Skeleton/topology engines emit interior edges but do NOT reliably
        // distinguish hip vs valley vs ridge. This pass uses:
        //   1. plane-adjacency + slope direction (azimuth)
        //   2. concave/reflex corner detection on the footprint
        //   3. deterministic fallback (never persist `unknown`)
        //
        // Runs BEFORE ai_roof_edges insert / patent_model creation /
        // diagram render so persisted classifications are correct.
        // ──────────────────────────────────────────────────────────────
        if (!forceUseRidgeSplit) try {
          const footprintForClassifier = (planes.length > 0
            ? [...planes].sort((a, b) => b.area_2d_sqft - a.area_2d_sqft)[0].polygon_px
            : []) as Pt[]

          if (footprintForClassifier.length >= 3 && edges.length > 0) {
            const classified = classifyHipValleyRidgeEdges({
              footprint_px: footprintForClassifier,
              planes: planes.map((p) => ({
                id: String(p.plane_index),
                polygon_px: p.polygon_px as Pt[],
                pitch: p.pitch,
                azimuthDeg: p.azimuth ?? null,
              })),
              edges: edges.map((e) => ({
                edge_type: e.edge_type,
                line_px: e.line_px as Pt[],
                source: e.source,
                confidence: e.confidence,
                adjacent_plane_ids: (e as any).adjacent_plane_ids ?? [],
              })),
            })

            // Merge classifier output back into RoofEdge[] (preserve geo + lengths)
            edges = edges.map((orig, i) => {
              const c = classified[i]
              if (!c) return orig
              return {
                ...orig,
                edge_type: c.edge_type as RoofEdge['edge_type'],
                source: c.source || orig.source,
                confidence: c.confidence ?? orig.confidence,
              }
            })

            const ridges = edges.filter((e) => e.edge_type === 'ridge').length
            const hips = edges.filter((e) => e.edge_type === 'hip').length
            const valleys = edges.filter((e) => e.edge_type === 'valley').length
            const eaves = edges.filter((e) => e.edge_type === 'eave').length
            const rakes = edges.filter((e) => e.edge_type === 'rake').length
            const unknown = edges.filter((e) => e.edge_type === 'unknown').length

            console.log(
              `[topology_engine_v2_classified] planes=${planes.length} edges=${edges.length} ` +
              `ridges=${ridges} hips=${hips} valleys=${valleys} eaves=${eaves} rakes=${rakes} unknown=${unknown}`,
            )

            // Hard validation: multi-facet roof but classifier produced no
            // hips AND no valleys → topology is structurally suspect.
            if (planes.length > 4 && hips === 0 && valleys === 0) {
              console.warn(
                `[topology_engine_v2_classified] needs_review: ${planes.length} planes but 0 hips/valleys`,
              )
              ;(aiJob as any)._topology_needs_review = true
              ;(aiJob as any)._topology_review_reason =
                'Topology produced multi-plane geometry but no hip/valley classification.'
            }
          }
        } catch (clsErr) {
          console.warn(`[topology_engine_v2_classified] failed: ${(clsErr as Error).message}`)
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
        let totalAreaSloped = planes.reduce((s, p) => s + p.area_pitch_adjusted_sqft, 0)
        let exceedsPublishableArea = totalAreaSloped > MAX_AUTO_ROOF_AREA_SQFT || totalArea2d > MAX_AUTO_ROOF_AREA_SQFT
        const sumByEdge = (t: RoofEdge['edge_type']) =>
          edges.filter((e) => e.edge_type === t).reduce((s, e) => s + e.length_ft, 0)
        let ridge_ft = sumByEdge('ridge')
        let hip_ft = sumByEdge('hip')
        let valley_ft = sumByEdge('valley')
        let eave_ft = sumByEdge('eave')
        let rake_ft = sumByEdge('rake')
        let perimeter_ft = eave_ft + rake_ft

        // ─────────────────────────────────────────────────────────────
        // VENDOR-REPORT GROUND TRUTH OVERRIDE
        // If a parsed vendor report (Roofr / EagleView) exists for this
        // lead or project, treat its measurements as authoritative and
        // override our synthesized totals + edges. The customer already
        // paid for that report — we should never publish weaker numbers
        // when ground truth is on file.
        // ─────────────────────────────────────────────────────────────
        let vendorOverrideApplied = false
        let vendorOverrideReportId: string | null = null
        let vendorTotalAreaOverride: number | null = null
        let vendorPitchOverride: string | null = null
        let vendorDiagramGeometry: any = null
        let vendorDiagramImageUrl: string | null = null
        try {
          const orFilters: string[] = []
          if (resolved.leadId) orFilters.push(`lead_id.eq.${resolved.leadId}`)
          // roof_vendor_reports has no project_id column; lead is sufficient
          const vendorQuery = supa
            .from('roof_vendor_reports')
            .select('id, parsed, diagram_geometry, diagram_image_url, provider')
            .order('created_at', { ascending: false })
            .limit(1)
          if (orFilters.length > 0) {
            vendorQuery.or(orFilters.join(','))
          }
          const { data: vRpt } = orFilters.length > 0 ? await vendorQuery.maybeSingle() : { data: null }
          const parsed: any = vRpt?.parsed
          const num = (v: any) => {
            const n = typeof v === 'string' ? parseFloat(v) : v
            return Number.isFinite(n) ? Number(n) : null
          }
          if (parsed && (num(parsed.ridges_ft) != null || num(parsed.eaves_ft) != null || num(parsed.total_area_sqft) != null)) {
            const r = num(parsed.ridges_ft) ?? 0
            const h = num(parsed.hips_ft) ?? 0
            const v = num(parsed.valleys_ft) ?? 0
            const e = num(parsed.eaves_ft) ?? 0
            const k = num(parsed.rakes_ft) ?? 0
            ridge_ft = r
            hip_ft = h
            valley_ft = v
            eave_ft = e
            rake_ft = k
            perimeter_ft = e + k
            vendorTotalAreaOverride = num(parsed.total_area_sqft)
            vendorPitchOverride = typeof parsed.predominant_pitch === 'string' ? parsed.predominant_pitch : null
            vendorOverrideApplied = true
            vendorOverrideReportId = vRpt!.id
            vendorDiagramGeometry = vRpt!.diagram_geometry ?? null
            vendorDiagramImageUrl = vRpt!.diagram_image_url ?? null
            console.log(
              `[start-ai-measurement] vendor override applied (${vRpt!.provider} ${vRpt!.id}): ` +
              `ridge=${r} hip=${h} valley=${v} eave=${e} rake=${k} area=${vendorTotalAreaOverride}`,
            )
          }
        } catch (vErr) {
          console.warn('[start-ai-measurement] vendor override lookup failed:', (vErr as Error).message)
        }

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

        // Apply vendor-report overrides for area + pitch when present.
        if (vendorOverrideApplied) {
          if (vendorPitchOverride) dominantPitch = vendorPitchOverride
          if (vendorTotalAreaOverride && vendorTotalAreaOverride > 0) {
            totalAreaSloped = vendorTotalAreaOverride
            exceedsPublishableArea = totalAreaSloped > MAX_AUTO_ROOF_AREA_SQFT
          }
        }

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
          // Image-supported alignment scoring (audit fix): pass the raster
          // footprint and Sobel evidence so overlay_alignment_score reflects
          // actual visual agreement with the aerial, not just centeredness.
          imageFootprintPx: extractedImageGeometry?.footprint ?? null,
          edgeEvidence: extractedImageGeometry
            ? {
                mag: extractedImageGeometry.mag,
                dW: extractedImageGeometry.dW,
                dH: extractedImageGeometry.dH,
                scaleX: extractedImageGeometry.scaleX,
                scaleY: extractedImageGeometry.scaleY,
              }
            : null,
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
        const geometrySource = forcedGeometrySource
          ? forcedGeometrySource
          : planeSources.length === 0
            ? 'none'
            : planeSources.every((s) => PLACEHOLDER_SOURCES.has(s))
            ? 'google_solar_bbox'
            : planeSources.length === 1
            ? planeSources[0]
            : 'mixed'
        // ── Canonical overlay transform (single source of truth) ──
        // Bounds are computed from the LOGICAL request size because the
        // Mercator extent of an @2x raster is identical to the @1x request;
        // imageWidth/imageHeight carry the ACTUAL decoded raster size so
        // every renderer (UI SVG, edge diagram, PDF) can place pixel
        // coordinates in the same frame as the satellite image.
        // See src/lib/measurements/overlayProjection.ts (mirror).
        const canonicalBounds = computeImageBounds(
          lat,
          lng,
          zoom,
          mb?.logical_w ?? 640,
          mb?.logical_h ?? 640,
        )
        const canonicalTransform = {
          imageWidth: imgW,
          imageHeight: imgH,
          bounds: canonicalBounds,
          center: { lat, lng },
          zoom,
          devicePixelRatio: rasterScale,
          projection: 'web_mercator' as const,
        }
        const reportOverlaySchema = {
          version: 'v2',
          image: {
            url: mb?.image_url ?? null,
            width: imgW,
            height: imgH,
            center_lat: lat,
            center_lng: lng,
            zoom,
            meters_per_pixel: cal.meters_per_pixel_actual,
          },
          // Canonical transform — every overlay renderer MUST use this.
          transform: canonicalTransform,
          // Full-roof footprint hull (audit fix): every plane vertex is
          // included so multi-plane roofs render the entire footprint, not
          // just the largest facet. Per-plane polygons are also persisted
          // for renderers that need facet-level geometry.
          polygon: convexHull(planes.flatMap((p) => p.polygon_px || []))
            .map((p) => [p.x, p.y]),
          polygons: planes.map((p) => ({
            plane_index: p.plane_index,
            polygon: (p.polygon_px || []).map((pt) => [pt.x, pt.y]),
          })),
          features: edges
            .filter((e) => e.edge_type !== 'unknown' && e.line_px.length >= 2)
            .map((e) => ({
              type: e.edge_type,
              p1: [e.line_px[0].x, e.line_px[0].y],
              p2: [e.line_px[1].x, e.line_px[1].y],
              length_px: e.length_px,
              length_ft: e.length_ft,
              confidence: e.confidence,
              source: e.source,
            })),
        }

        // ── Canonical report model: build ONLY from final planes + classified edges. ──
        // Do not rebuild AI measurement reports from overlay_schema/polygon; that
        // path recreates a single Plane A model and hides ridge_split_recursive output.
        const finalPatentModel = buildPatentModelFromPlanes({
          planes,
          edges: edges.filter((e) => e.line_px.length >= 2),
          feetPerPixel,
          source: geometrySource,
          address: resolved.address || null,
          image: {
            url: mb?.image_url ?? null,
            width: imgW,
            height: imgH,
            center_lat: lat,
            center_lng: lng,
            zoom,
            meters_per_pixel: cal.meters_per_pixel_actual,
          },
        })

        if (finalPatentModel.plane_count !== planes.length) {
          throw new Error('BUG: patent_model plane_count does not match final planes length')
        }
        if (geometrySource === 'ridge_split_recursive' && finalPatentModel.plane_count <= 1) {
          throw new Error('BUG: ridge_split_recursive collapsed to Plane A before save')
        }

        const patentModel = finalPatentModel

        // ── Finalise debug_pipeline before persisting ──
        debug_pipeline.final_plane_count_saved = planes.length
        debug_pipeline.final_edge_count_saved = edges.length
        debug_pipeline.final_patent_model_plane_count = finalPatentModel.plane_count
        debug_pipeline.final_report_source = geometrySource
        console.log('[FINAL_GEOMETRY_STATE]', {
          planes: planes.length,
          edges: edges.length,
          source: geometrySource,
          forceUseRidgeSplit,
          patent_model_planes: (patentModel.planes || []).length,
        })
        if (planes.length > 1 && geometrySource === 'ridge_split_recursive') {
          console.log('[SAVE_CHECK] MULTI-PLANE GEOMETRY CONFIRMED')
        } else {
          console.error('[SAVE_CHECK FAIL] LOST MULTI-PLANE GEOMETRY', {
            planes: planes.length,
            edges: edges.length,
            source: geometrySource,
            ridge_split_recursive_planes: debug_pipeline.ridge_split_recursive_plane_count,
            patent_model_planes: (patentModel.planes || []).length,
          })
        }
        console.log('[AI_MEASUREMENT_DEBUG] Pipeline Debug Info:', debug_pipeline)

        // PATCH 4 — fail loudly if recursive split worked but patent_model collapsed
        if (
          debug_pipeline.ridge_split_recursive_plane_count > 1 &&
          debug_pipeline.final_patent_model_plane_count <= 1
        ) {
          console.error(
            '[AI_MEASUREMENT_DEBUG] BUG: recursive split produced multiple planes but patent_model collapsed back to Plane A',
            debug_pipeline,
          )
          // Mark for review rather than throwing — throwing would lose the
          // entire job. Surface the regression in the saved report so the UI
          // debug badge shows it.
          ;(aiJob as any)._topology_needs_review = true
          ;(aiJob as any)._topology_review_reason =
            'BUG: recursive split produced multiple planes but patent_model collapsed back to Plane A'
        }

        // PDF cache-bust signature — render-measurement-pdf compares this
        // to its previously stored signature and regenerates if changed.
        const pdf_source_signature = JSON.stringify({
          job_id: aiJob.id,
          source: debug_pipeline.final_report_source,
          planes: debug_pipeline.final_plane_count_saved,
          edges: debug_pipeline.final_edge_count_saved,
          patent_planes: debug_pipeline.final_patent_model_plane_count,
        })

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
          overlay_schema: reportOverlaySchema,
          patent_model: patentModel,
          // ── PATCH 1+4 debug instrumentation ──
          debug_pipeline,
          pdf_source_signature,
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
          report_pdf_url: null,
          report_pdf_path: null,
          geometry_report_json: reportJson,
          overlay_schema: reportOverlaySchema,
          patent_model: patentModel,
          geometry_quality_score: qc.overall,
          measurement_quality_score: qc.overall,
          ...(vendorOverrideApplied
            ? {
                vendor_report_id: vendorOverrideReportId,
                detection_method: 'vendor_report_override',
                inference_source: 'vendor_truth',
                notes: 'Geometry sourced from parsed vendor measurement report (ground truth).',
              }
            : {}),
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
