export type Pt = { x: number; y: number }

export type PlaneInput = {
  plane_index?: number | string
  id?: number | string
  polygon_px: Pt[]
  pitch?: number | null
  azimuthDeg?: number | null
  azimuth_degrees?: number | null
  azimuth?: number | null
  area_sqft?: number | null
  area_2d_sqft?: number | null
  plan_area_sqft?: number | null
  area_pitch_adjusted_sqft?: number | null
  roof_area_sqft?: number | null
  pitch_multiplier?: number | null
  slope_factor?: number | null
  source?: string
}

export type EdgeInput = {
  edge_type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unknown' | string
  line_px: Pt[]
  length_ft?: number | null
  adjacent_plane_ids?: string[]
  confidence?: number | null
  source?: string | null
  debug_reason?: string | null
}

type ImageContext = {
  url: string | null
  width: number
  height: number
  center_lat: number
  center_lng: number
  zoom: number
  meters_per_pixel: number
}

function planeId(p: PlaneInput, i: number): string {
  const raw = p.plane_index ?? p.id ?? i
  const n = Number(raw)
  if (Number.isFinite(n)) return String.fromCharCode(65 + n)
  return String(raw)
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function polygonAreaPx(poly: Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
}

function slopeFactorFromPitch(pitch?: number | null): number {
  const p = Number(pitch ?? 0)
  if (!Number.isFinite(p) || p <= 0) return 1
  return Math.sqrt(1 + Math.pow(p / 12, 2))
}

function edgeLengthFt(edge: EdgeInput, feetPerPixel: number): number {
  if (typeof edge.length_ft === 'number' && Number.isFinite(edge.length_ft)) {
    return edge.length_ft
  }
  if (!edge.line_px || edge.line_px.length < 2) return 0
  const a = edge.line_px[0]
  const b = edge.line_px[edge.line_px.length - 1]
  return dist(a, b) * feetPerPixel
}

function perimeterEdgesForPlane(plane: PlaneInput, pid: string, feetPerPixel: number) {
  const poly = plane.polygon_px || []
  const out = []

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const id = `${pid}-P${i}`

    out.push({
      id,
      plane_id: pid,
      plane: pid,
      type: 'perimeter',
      edge_type: 'perimeter',
      p1: a,
      p2: b,
      line_px: [a, b],
      points: [[a.x, a.y], [b.x, b.y]],
      length_ft: dist(a, b) * feetPerPixel,
      overlapsLayer2Id: null,
      attribute: 'perimeter',
    })
  }

  return out
}

function normalizeEdgeType(t: string): string {
  const v = String(t || '').toLowerCase()
  if (v.includes('ridge')) return 'ridge'
  if (v.includes('hip')) return 'hip'
  if (v.includes('valley')) return 'valley'
  if (v.includes('eave')) return 'eave'
  if (v.includes('rake')) return 'rake'
  return 'unknown'
}

function totalsFromEdges(edges: EdgeInput[], feetPerPixel: number) {
  const totals: Record<string, number> = {
    ridge: 0,
    hip: 0,
    valley: 0,
    eave: 0,
    rake: 0,
    unknown: 0,
  }

  for (const e of edges) {
    const type = normalizeEdgeType(e.edge_type)
    totals[type] = (totals[type] || 0) + edgeLengthFt(e, feetPerPixel)
  }

  return totals
}

export function buildPatentModelFromPlanes(args: {
  planes: PlaneInput[]
  edges: EdgeInput[]
  feetPerPixel: number
  source?: string
  address?: string | null
  image?: ImageContext
}) {
  const { planes, edges, feetPerPixel, source, address, image } = args

  if (!Array.isArray(planes) || planes.length === 0) {
    throw new Error('buildPatentModelFromPlanes: planes[] is empty')
  }

  const planeModels = planes.map((p, i) => {
    const id = planeId(p, i)
    const pitch = Number(p.pitch ?? 0)
    const slope_factor = p.slope_factor ?? p.pitch_multiplier ?? slopeFactorFromPitch(pitch)
    const plan_area_sqft =
      p.plan_area_sqft ??
      p.area_2d_sqft ??
      p.area_sqft ??
      polygonAreaPx(p.polygon_px || []) * feetPerPixel * feetPerPixel

    const roof_area_sqft =
      p.roof_area_sqft ??
      p.area_pitch_adjusted_sqft ??
      plan_area_sqft * slope_factor

    return {
      id,
      label: id,
      source_plane_index: p.plane_index ?? p.id ?? i,
      polygon_px: p.polygon_px,
      pitch,
      azimuthDeg: p.azimuthDeg ?? p.azimuth_degrees ?? p.azimuth ?? null,
      slope_factor,
      plan_area_sqft,
      roof_area_sqft,
      perimeter_ids: [] as string[],
      source: p.source ?? source ?? 'final_geometry',
    }
  })

  const idByOriginal = new Map<string, string>()
  planes.forEach((p, i) => {
    const id = planeModels[i].id
    idByOriginal.set(String(p.plane_index ?? p.id ?? i), id)
    idByOriginal.set(id, id)
  })

  const layer1_perimeter = planeModels.flatMap((p, i) => {
    const edgesForPlane = perimeterEdgesForPlane(
      { ...planes[i], polygon_px: p.polygon_px },
      p.id,
      feetPerPixel,
    )
    p.perimeter_ids = edgesForPlane.map((e) => e.id)
    return edgesForPlane
  })

  const layer2_structural = edges.map((e, i) => {
    const type = normalizeEdgeType(e.edge_type)
    const adjacent = (e.adjacent_plane_ids || []).map((x) => idByOriginal.get(String(x)) ?? String(x))
    const p1 = e.line_px?.[0] ?? null
    const p2 = e.line_px?.[e.line_px.length - 1] ?? null

    return {
      id: `S${i}`,
      type,
      edge_type: type,
      line_px: e.line_px,
      points: p1 && p2 ? [[p1.x, p1.y], [p2.x, p2.y]] : [],
      p1,
      p2,
      length_ft: edgeLengthFt(e, feetPerPixel),
      adjacent_plane_ids: adjacent,
      confidence: e.confidence ?? null,
      source: e.source ?? source ?? 'final_geometry',
      debug_reason: e.debug_reason ?? null,
      overlapsLayer1Id: null,
    }
  })

  const totals = totalsFromEdges(edges, feetPerPixel)
  const total_plan_area_sqft = planeModels.reduce((s, p) => s + Number(p.plan_area_sqft || 0), 0)
  const total_roof_area_sqft = planeModels.reduce((s, p) => s + Number(p.roof_area_sqft || 0), 0)
  const perimeter_ft = layer1_perimeter.reduce((s, p) => s + Number(p.length_ft || 0), 0)

  const predominant_pitch =
    planeModels.length > 0
      ? planeModels.reduce((s, p) => s + Number(p.pitch || 0) * Number(p.plan_area_sqft || 0), 0) /
        Math.max(1, total_plan_area_sqft)
      : null

  return {
    version: 'patent_model_v2',
    address: address ?? null,
    generated_at: new Date().toISOString(),
    source: source ?? 'final_geometry',

    // This is the critical field that prevents Plane A collapse.
    plane_count: planeModels.length,
    facet_count: planeModels.length,

    image: image ?? {
      url: null,
      width: 1000,
      height: 1000,
      center_lat: 0,
      center_lng: 0,
      zoom: 0,
      meters_per_pixel: feetPerPixel / 3.28084,
    },
    planes: planeModels,
    layer1_perimeter,
    layer2_structural,

    totals: {
      total_plan_area_sqft,
      total_roof_area_sqft,
      total_squares: total_roof_area_sqft / 100,
      predominant_pitch,
      ridge_ft: totals.ridge || 0,
      hip_ft: totals.hip || 0,
      valley_ft: totals.valley || 0,
      eave_ft: totals.eave || 0,
      rake_ft: totals.rake || 0,
      unknown_ft: totals.unknown || 0,
      hips_plus_ridges_ft: (totals.hip || 0) + (totals.ridge || 0),
      eaves_plus_rakes_ft: (totals.eave || 0) + (totals.rake || 0),

      // Backward-compatible fields consumed by existing report UI.
      footprint_sqft: total_plan_area_sqft,
      roof_area_sqft: total_roof_area_sqft,
      roofing_squares: total_roof_area_sqft / 100,
      slope_factor: total_plan_area_sqft > 0 ? total_roof_area_sqft / total_plan_area_sqft : 1,
      lengths_ft: {
        perimeter: perimeter_ft,
        ridge: totals.ridge || 0,
        hip: totals.hip || 0,
        valley: totals.valley || 0,
        eave: totals.eave || 0,
        rake: totals.rake || 0,
      },
    },

    imagery_qc: {
      passed: true,
      abnormalities: [],
      reshoot_requested: false,
    },

    debug: {
      built_from: 'planes_edges_not_overlay',
      input_plane_count: planes.length,
      input_edge_count: edges.length,
      edge_counts: edges.reduce((acc: Record<string, number>, e) => {
        const t = normalizeEdgeType(e.edge_type)
        acc[t] = (acc[t] || 0) + 1
        return acc
      }, {}),
    },
  }
}