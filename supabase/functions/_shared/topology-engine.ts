// Triangulation-based topology engine.
//
// Drop-in fallback that converts a 2D footprint polygon into a planar graph
// of facets + classified edges. Used when the straight-skeleton engine
// fails to produce any interior edges (degenerate / very simple footprints).
//
// This is 2.5D inference — NOT true 3D reconstruction. It produces:
//   - planes (merged triangle fans)
//   - ridge candidates (centroid-to-centroid between adjacent planes)
//   - perimeter eaves vs rakes (axis heuristic)
//
// Pair with `straight-skeleton.ts` for the primary topology pass; this
// engine exists so that `synthesizePatentStructureFromFootprint` always
// returns at least *some* facet structure rather than a single plane.

export type Point = { x: number; y: number }
export type EdgeType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake'

export interface TopologyPlane {
  id: number
  polygon: Point[]
}

export interface TopologyEdge {
  p1: Point
  p2: Point
  type: EdgeType
}

export interface TopologyResult {
  planes: TopologyPlane[]
  edges: TopologyEdge[]
  facet_count: number
}

// ─── geometry helpers ────────────────────────────────────────────────────
function isConvex(a: Point, b: Point, c: Point): boolean {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const sign = (p1: Point, p2: Point, p3: Point) =>
    (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x)
  const b1 = sign(p, a, b) < 0
  const b2 = sign(p, b, c) < 0
  const b3 = sign(p, c, a) < 0
  return b1 === b2 && b2 === b3
}

// ─── ear clipping triangulation ──────────────────────────────────────────
function triangulate(poly: Point[]): Point[][] {
  const triangles: Point[][] = []
  const pts = [...poly]
  let guard = pts.length * pts.length

  while (pts.length >= 3 && guard-- > 0) {
    let earFound = false
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]
      const curr = pts[i]
      const next = pts[(i + 1) % pts.length]
      if (!isConvex(prev, curr, next)) continue

      let contains = false
      for (let j = 0; j < pts.length; j++) {
        if (j === i) continue
        const q = pts[j]
        if (q === prev || q === next) continue
        if (pointInTriangle(q, prev, curr, next)) {
          contains = true
          break
        }
      }
      if (!contains) {
        triangles.push([prev, curr, next])
        pts.splice(i, 1)
        earFound = true
        break
      }
    }
    if (!earFound) break
  }
  return triangles
}

// ─── triangle merge ──────────────────────────────────────────────────────
function shareEdge(a: Point[], b: Point[]): boolean {
  let count = 0
  for (const p1 of a) {
    for (const p2 of b) {
      if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 2) count++
    }
  }
  return count >= 2
}

function mergeTriangles(tris: Point[][]): TopologyPlane[] {
  const planes: TopologyPlane[] = []
  let id = 0
  for (const tri of tris) {
    let merged = false
    for (const plane of planes) {
      if (shareEdge(plane.polygon, tri)) {
        plane.polygon = [...plane.polygon, ...tri]
        merged = true
        break
      }
    }
    if (!merged) planes.push({ id: id++, polygon: [...tri] })
  }
  return planes
}

// ─── adjacency + ridges ──────────────────────────────────────────────────
interface GraphEdge { a: number; b: number }

function buildAdjacency(planes: TopologyPlane[]): GraphEdge[] {
  const edges: GraphEdge[] = []
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      if (shareEdge(planes[i].polygon, planes[j].polygon)) {
        edges.push({ a: planes[i].id, b: planes[j].id })
      }
    }
  }
  return edges
}

function centroid(poly: Point[]): Point {
  let x = 0, y = 0
  for (const p of poly) { x += p.x; y += p.y }
  return { x: x / poly.length, y: y / poly.length }
}

function buildRidges(planes: TopologyPlane[], graph: GraphEdge[]): TopologyEdge[] {
  const ridges: TopologyEdge[] = []
  const byId = new Map(planes.map((p) => [p.id, p]))
  for (const e of graph) {
    const pa = byId.get(e.a); const pb = byId.get(e.b)
    if (!pa || !pb) continue
    ridges.push({ p1: centroid(pa.polygon), p2: centroid(pb.polygon), type: 'ridge' })
  }
  return ridges
}

// ─── perimeter classification ────────────────────────────────────────────
function getPerimeterEdges(poly: Point[]): TopologyEdge[] {
  const edges: TopologyEdge[] = []
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i]
    const p2 = poly[(i + 1) % poly.length]
    const dy = p2.y - p1.y
    const isHorizontal = Math.abs(dy) < 2
    edges.push({ p1, p2, type: isHorizontal ? 'eave' : 'rake' })
  }
  return edges
}

// ─── main ────────────────────────────────────────────────────────────────
export function buildTopology(footprint: Point[]): TopologyResult {
  if (!footprint || footprint.length < 3) {
    return { planes: [], edges: [], facet_count: 0 }
  }
  const triangles = triangulate(footprint)
  const planes = mergeTriangles(triangles)
  const graph = buildAdjacency(planes)
  const ridges = buildRidges(planes, graph)
  const perimeter = getPerimeterEdges(footprint)
  return {
    planes,
    edges: [...ridges, ...perimeter],
    facet_count: planes.length,
  }
}
