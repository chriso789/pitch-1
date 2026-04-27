export type Point = { x: number; y: number }

export type Line = {
  p1: Point
  p2: Point
  votes?: number
}

export type SplitOptions = {
  minAreaRatio?: number
  minArea?: number
  maxPlanes?: number
  epsilon?: number
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function perpendicular(v: Point): Point {
  return { x: -v.y, y: v.x }
}

function getLineNormal(line: Line): Point {
  const dir = subtract(line.p2, line.p1)
  return perpendicular(dir)
}

function sideOfLine(p: Point, line: Line): number {
  const normal = getLineNormal(line)
  const v = subtract(p, line.p1)
  return dot(v, normal)
}

function polygonArea(poly: Point[]): number {
  if (poly.length < 3) return 0
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

function pointsEqual(a: Point, b: Point, epsilon: number): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

function cleanPolygon(poly: Point[], epsilon: number): Point[] {
  const out: Point[] = []
  for (const p of poly) {
    if (!out.length || !pointsEqual(out[out.length - 1], p, epsilon)) out.push(p)
  }
  if (out.length > 1 && pointsEqual(out[0], out[out.length - 1], epsilon)) out.pop()
  return out
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point, epsilon: number): boolean {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)
  return o1 * o2 < -epsilon && o3 * o4 < -epsilon
}

function hasSelfIntersection(poly: Point[], epsilon: number): boolean {
  if (poly.length < 4) return false
  for (let i = 0; i < poly.length; i++) {
    const a1 = poly[i]
    const a2 = poly[(i + 1) % poly.length]
    for (let j = i + 1; j < poly.length; j++) {
      if (j === i + 1 || (i === 0 && j === poly.length - 1)) continue
      const b1 = poly[j]
      const b2 = poly[(j + 1) % poly.length]
      if (segmentsIntersect(a1, a2, b1, b2, epsilon)) return true
    }
  }
  return false
}

function extendLineToCoverPolygon(polygon: Point[], line: Line): Line {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of polygon) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
  }
  const dx = line.p2.x - line.p1.x
  const dy = line.p2.y - line.p1.y
  const len = Math.hypot(dx, dy)
  if (len <= 1e-6) return line
  const ux = dx / len
  const uy = dy / len
  const reach = Math.hypot(maxX - minX, maxY - minY) * 2 + len
  return {
    p1: { x: line.p1.x - ux * reach, y: line.p1.y - uy * reach },
    p2: { x: line.p2.x + ux * reach, y: line.p2.y + uy * reach },
    votes: line.votes,
  }
}

export function intersectSegments(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d =
    (a2.x - a1.x) * (b2.y - b1.y) -
    (a2.y - a1.y) * (b2.x - b1.x)

  if (Math.abs(d) < 1e-6) return null

  const ua =
    ((b2.x - b1.x) * (a1.y - b1.y) -
      (b2.y - b1.y) * (a1.x - b1.x)) / d

  const ub =
    ((a2.x - a1.x) * (a1.y - b1.y) -
      (a2.y - a1.y) * (a1.x - b1.x)) / d

  if (ua < -1e-6 || ua > 1 + 1e-6 || ub < -1e-6 || ub > 1 + 1e-6) return null

  return {
    x: a1.x + ua * (a2.x - a1.x),
    y: a1.y + ua * (a2.y - a1.y),
  }
}

export function splitPolygonByLine(
  polygon: Point[],
  line: Line,
  options: SplitOptions = {},
): Point[][] {
  const epsilon = options.epsilon ?? 1e-6
  const minAreaRatio = options.minAreaRatio ?? 0.1
  const minArea = options.minArea ?? 1
  const input = cleanPolygon(polygon, epsilon)
  if (input.length < 3) return []

  const left: Point[] = []
  const right: Point[] = []
  const lineLength = Math.hypot(line.p2.x - line.p1.x, line.p2.y - line.p1.y)
  if (lineLength <= epsilon) return []
  const cutLine = extendLineToCoverPolygon(input, line)

  for (let i = 0; i < input.length; i++) {
    const curr = input[i]
    const next = input[(i + 1) % input.length]

    const currSide = sideOfLine(curr, line)
    const nextSide = sideOfLine(next, line)

    if (currSide >= -epsilon) left.push(curr)
    if (currSide <= epsilon) right.push(curr)

    if ((currSide > epsilon && nextSide < -epsilon) || (currSide < -epsilon && nextSide > epsilon)) {
      const intersection = intersectSegments(curr, next, cutLine.p1, cutLine.p2)
      if (intersection) {
        left.push(intersection)
        right.push(intersection)
      }
    }
  }

  const leftClean = cleanPolygon(left, epsilon)
  const rightClean = cleanPolygon(right, epsilon)
  if (leftClean.length < 3 || rightClean.length < 3) return []
  if (hasSelfIntersection(leftClean, epsilon) || hasSelfIntersection(rightClean, epsilon)) return []

  const originalArea = polygonArea(input)
  const leftArea = polygonArea(leftClean)
  const rightArea = polygonArea(rightClean)
  if (originalArea <= minArea) return []
  if (leftArea < minArea || rightArea < minArea) return []
  if (leftArea < originalArea * minAreaRatio || rightArea < originalArea * minAreaRatio) return []

  return [leftClean, rightClean]
}

export function filterStrongRidges<T extends { votes?: number }>(lines: T[]): T[] {
  if (!lines.length) return []
  const maxVotes = Math.max(...lines.map((l) => l.votes ?? 0))
  if (maxVotes <= 0) return []
  return lines.filter((l) => (l.votes ?? 0) > maxVotes * 0.5)
}

export function buildRoofPlanes(
  footprint: Point[],
  ridges: Line[],
  options: SplitOptions = {},
): Point[][] {
  const maxPlanes = options.maxPlanes ?? 10
  let planes: Point[][] = [cleanPolygon(footprint, options.epsilon ?? 1e-6)]

  for (const ridge of ridges) {
    if (planes.length >= maxPlanes) break
    const newPlanes: Point[][] = []

    for (const plane of planes) {
      if (newPlanes.length >= maxPlanes) {
        newPlanes.push(plane)
        continue
      }

      const split = splitPolygonByLine(plane, ridge, options)
      if (split.length === 2 && newPlanes.length + 2 <= maxPlanes) {
        newPlanes.push(...split)
      } else {
        newPlanes.push(plane)
      }
    }

    planes = newPlanes.slice(0, maxPlanes)
  }

  return planes.filter((p) => p.length >= 3)
}
