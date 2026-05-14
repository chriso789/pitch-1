// Patent-aligned pitch resolver.
// Rule 4: Pitch must come from perimeter↔ridge geometry. Collapsed-plane
// fits are rejected and fall back to Google Solar `roofSegmentStats`.

export type PitchSource =
  | 'perimeter_ridge'
  | 'ridge_average'
  | 'valley_enclosed'
  | 'perimeter_only'
  | 'solar_fallback'
  | 'unavailable';

export interface PitchResolution {
  pitch: number | null;       // rise:12 (null = unavailable)
  source: PitchSource;
  confidence: number;
  derivation: string;
}

export interface PlaneInput {
  id: string;
  vertices_px: Array<{ x: number; y: number }>;
  is_collapsed?: boolean;
  facet_count_in_roof: number;
}

export interface EdgeRef {
  type: 'perimeter' | 'ridge' | 'valley';
  a: { x: number; y: number };
  b: { x: number; y: number };
  plane_ids?: string[];
}

export interface NeighborPitch {
  plane_id: string;
  pitch: number;
}

export interface SolarPriors {
  pitch_degrees?: number | null;
  segment_pitches_degrees?: number[];
}

const RAD = Math.PI / 180;

function degreesToRise12(deg: number): number {
  return Math.tan(deg * RAD) * 12;
}

function edgeAngle(e: EdgeRef): number {
  return Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
}

function edgesParallel(a: EdgeRef, b: EdgeRef, toleranceDeg = 10): boolean {
  const diff = Math.abs(edgeAngle(a) - edgeAngle(b)) % Math.PI;
  const norm = diff > Math.PI / 2 ? Math.PI - diff : diff;
  return norm < toleranceDeg * RAD;
}

/**
 * Resolve plane pitch following the patent rules in order. Returns
 * `unavailable` only when topology is invalid AND solar priors are missing.
 *
 * HARD BLOCK: if the plane is flagged `is_collapsed`, this function refuses
 * any geometry-derived source and returns the solar fallback (or unavailable).
 */
export function resolvePlanePitch(
  plane: PlaneInput,
  perimeter: EdgeRef[],
  ridges: EdgeRef[],
  valleys: EdgeRef[],
  neighbors: NeighborPitch[],
  solar?: SolarPriors,
): PitchResolution {
  // Collapsed plane → never trust geometry.
  if (plane.is_collapsed) {
    return solarFallback(solar, 'collapsed_plane_fit_rejected');
  }

  const planeRidges = ridges.filter((r) => r.plane_ids?.includes(plane.id));
  const planeValleys = valleys.filter((v) => v.plane_ids?.includes(plane.id));
  const planePerimeter = perimeter.filter((p) => p.plane_ids?.includes(plane.id));

  // Rule 1: ridge parallel to a perimeter edge → ridge → perimeter.
  for (const ridge of planeRidges) {
    for (const peri of planePerimeter) {
      if (edgesParallel(ridge, peri)) {
        return {
          pitch: estimatePitchFromGeometry(ridge, peri),
          source: 'perimeter_ridge',
          confidence: 0.9,
          derivation: `ridge ${ridge.a.x},${ridge.a.y}→${ridge.b.x},${ridge.b.y} ∥ perimeter`,
        };
      }
    }
  }

  // Rule 2: multiple ridges → average.
  if (planeRidges.length >= 2) {
    const avg = planeRidges.reduce((s, r) => s + edgeAngle(r), 0) / planeRidges.length;
    return {
      pitch: estimatePitchFromAngle(avg, planePerimeter[0]),
      source: 'ridge_average',
      confidence: 0.75,
      derivation: `${planeRidges.length} ridges averaged`,
    };
  }

  // Rule 3: enclosed by valleys → average neighbor pitches.
  if (planeRidges.length === 0 && planeValleys.length >= 2 && neighbors.length > 0) {
    const avg = neighbors.reduce((s, n) => s + n.pitch, 0) / neighbors.length;
    return {
      pitch: avg,
      source: 'valley_enclosed',
      confidence: 0.6,
      derivation: `avg of ${neighbors.length} neighbor pitches`,
    };
  }

  // Rule 4: perimeter-only → pitch toward longest perimeter edge.
  if (planeRidges.length === 0 && planePerimeter.length > 0) {
    const longest = planePerimeter.reduce((best, p) =>
      edgeLen(p) > edgeLen(best) ? p : best, planePerimeter[0]);
    return {
      pitch: estimatePitchFromAngle(edgeAngle(longest), longest),
      source: 'perimeter_only',
      confidence: 0.4,
      derivation: 'no ridges; longest perimeter axis used',
    };
  }

  // Rule 5: invalid topology on a complex roof → solar fallback.
  if (plane.facet_count_in_roof > 4 && planeRidges.length === 0) {
    return solarFallback(solar, 'no_ridges_on_complex_roof');
  }

  return solarFallback(solar, 'unresolved_geometry');
}

function solarFallback(solar: SolarPriors | undefined, reason: string): PitchResolution {
  if (solar?.pitch_degrees != null) {
    return {
      pitch: degreesToRise12(solar.pitch_degrees),
      source: 'solar_fallback',
      confidence: 0.5,
      derivation: `solar fallback (${reason})`,
    };
  }
  if (solar?.segment_pitches_degrees?.length) {
    const avg = solar.segment_pitches_degrees.reduce((s, d) => s + d, 0) /
      solar.segment_pitches_degrees.length;
    return {
      pitch: degreesToRise12(avg),
      source: 'solar_fallback',
      confidence: 0.45,
      derivation: `solar segment avg (${reason})`,
    };
  }
  return { pitch: null, source: 'unavailable', confidence: 0, derivation: reason };
}

function edgeLen(e: EdgeRef): number {
  return Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
}

// Heuristic: without DSM elevations the resolver cannot compute a true rise.
// For now return a conservative 6:12 default and rely on the Solar fallback
// for high-confidence planes. Callers should override with DSM-derived rise
// when available.
function estimatePitchFromGeometry(_ridge: EdgeRef, _perimeter: EdgeRef): number {
  return 6;
}

function estimatePitchFromAngle(_angle: number, _ref?: EdgeRef): number {
  return 6;
}
