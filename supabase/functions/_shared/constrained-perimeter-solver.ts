/**
 * ConstrainedPerimeterSolver — perimeter-first checkpoint v1
 *
 * Wraps internal topology output and validates against the locked perimeter.
 * The perimeter polygon is read-only: any internal edge that escapes the
 * polygon, or any face vertex outside it, invalidates the entire internal
 * topology — the run falls back to perimeter_only.
 */

import {
  type PerimeterTopology,
  snapEdgesToPerimeter,
  checkInternalEdgeContainment,
} from "./perimeter-topology.ts";

type PxPt = { x: number; y: number };

export interface InternalGeometry {
  edges: Array<{ id: string; start_px: PxPt; end_px: PxPt; type?: string }>;
  faces: Array<{ id: string; vertices_px: PxPt[] }>;
}

export interface ConstraintResult {
  passed: boolean;
  topology_status: 'ok' | 'constraint_violation';
  violations: string[];
  edges_snapped: number;
  edges_outside: string[];
  faces_outside: string[];
  /** When passed=false, callers must set result_state='perimeter_only'. */
  fallback_to_perimeter_only: boolean;
}

const SNAP_TOLERANCE_PX = 4;

export function applyPerimeterConstraints(
  internal: InternalGeometry,
  perimeter: PerimeterTopology,
): ConstraintResult {
  const violations: string[] = [];

  // 1. Snap internal edge endpoints to perimeter nodes/edges (mutates in place).
  const beforeSnap = JSON.stringify(internal.edges.map(e => [e.start_px, e.end_px]));
  snapEdgesToPerimeter(internal.edges, perimeter, SNAP_TOLERANCE_PX);
  const afterSnap = JSON.stringify(internal.edges.map(e => [e.start_px, e.end_px]));
  const edgesSnapped = beforeSnap !== afterSnap ? internal.edges.length : 0;

  // 2. No internal edge midpoint may lie outside the perimeter polygon.
  const edgesOutside = checkInternalEdgeContainment(internal.edges, perimeter);
  if (edgesOutside.length > 0) {
    violations.push(`internal_edges_outside_perimeter:${edgesOutside.length}`);
  }

  // 3. No face vertex may lie outside perimeter.
  const ring = perimeter.perimeter_ring_px.slice(0, -1);
  const facesOutside: string[] = [];
  for (const face of internal.faces) {
    for (const v of face.vertices_px) {
      if (!pointInPolygon(v, ring)) {
        facesOutside.push(face.id);
        break;
      }
    }
  }
  if (facesOutside.length > 0) {
    violations.push(`face_vertices_outside_perimeter:${facesOutside.length}`);
  }

  const passed = violations.length === 0;

  console.log(`[CONSTRAINED_PERIMETER_SOLVER] ${passed ? 'PASS' : 'FAIL'}: snapped=${edgesSnapped}, edges_outside=${edgesOutside.length}, faces_outside=${facesOutside.length}`);

  return {
    passed,
    topology_status: passed ? 'ok' : 'constraint_violation',
    violations,
    edges_snapped: edgesSnapped,
    edges_outside: edgesOutside,
    faces_outside: facesOutside,
    fallback_to_perimeter_only: !passed,
  };
}

function pointInPolygon(pt: PxPt, polygon: PxPt[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
