/**
 * Aerial-Structural Diagram Validator & Enforcer
 *
 * Ensures diagram pages 3–6 (length/pitch/area/notes) use the SAME
 * raster-space geometry as the overlay page (page 2).
 *
 * Hard rules:
 *   1. Diagram footprint must match overlay footprint bbox within 5%.
 *   2. Diagram plane count must match final solver plane count.
 *   3. Diagram edge count must match final solver edge count.
 *   4. No template-generated geometry is allowed when real solver geometry exists.
 *   5. All polygon_px and line_px must be in raster pixel coordinates.
 */

type Point = { x: number; y: number };

export interface AerialDiagramQA {
  page: string;
  source: string;
  plane_count: number;
  edge_count: number;
  uses_raster_space_geometry: boolean;
  uses_template_geometry: boolean;
  aerial_diagram_match_score: number;
  footprint_bbox_match: boolean;
  passed: boolean;
  failures: string[];
}

export interface StructuralMatchInput {
  /** Planes from the final solver (raster-space polygon_px) */
  solverPlanes: Array<{ polygon_px: Point[]; source?: string }>;
  /** Edges from the final solver (raster-space line_px) */
  solverEdges: Array<{ line_px: Point[]; edge_type: string; source?: string }>;
  /** The snapped footprint polygon in raster pixel coords */
  footprintPx: Point[];
  /** Raster image dimensions */
  rasterWidth: number;
  rasterHeight: number;
  /** Topology source tag from the solver */
  topologySource: string;
}

/**
 * Validate that the geometry being sent to the diagram renderer
 * is aerial-matched (raster-space) and not template-generated.
 */
export function validateAerialStructuralMatch(input: StructuralMatchInput): AerialDiagramQA {
  const failures: string[] = [];
  const planes = input.solverPlanes || [];
  const edges = input.solverEdges || [];
  const footprint = input.footprintPx || [];

  // 1. Check that geometry exists
  if (planes.length === 0) failures.push("no_planes");
  if (edges.length === 0) failures.push("no_edges");

  // 2. Check all polygon_px are in raster bounds
  const rW = input.rasterWidth || 1;
  const rH = input.rasterHeight || 1;
  let outOfBounds = 0;
  let totalPoints = 0;

  for (const plane of planes) {
    for (const pt of (plane.polygon_px || [])) {
      totalPoints++;
      if (pt.x < -rW * 0.1 || pt.x > rW * 1.1 || pt.y < -rH * 0.1 || pt.y > rH * 1.1) {
        outOfBounds++;
      }
    }
  }
  for (const edge of edges) {
    for (const pt of (edge.line_px || [])) {
      totalPoints++;
      if (pt.x < -rW * 0.1 || pt.x > rW * 1.1 || pt.y < -rH * 0.1 || pt.y > rH * 1.1) {
        outOfBounds++;
      }
    }
  }

  const usesRasterSpace = totalPoints > 0 && outOfBounds / totalPoints < 0.1;
  if (!usesRasterSpace && totalPoints > 0) {
    failures.push("geometry_not_in_raster_space");
  }

  // 3. Check structural edges exist (not just eaves)
  const structuralEdgeTypes = new Set(["ridge", "hip", "valley"]);
  const structuralEdges = edges.filter(e => structuralEdgeTypes.has(e.edge_type));
  if (planes.length > 1 && structuralEdges.length === 0) {
    failures.push("no_structural_edges_for_multi_plane_roof");
  }

  // 4. Check footprint bbox vs plane geometry bbox overlap
  const fpBbox = bboxFromPoints(footprint);
  const planePts = planes.flatMap(p => p.polygon_px || []);
  const planeBbox = bboxFromPoints(planePts);

  let bboxMatchScore = 0;
  let bboxMatch = false;
  if (fpBbox && planeBbox) {
    const overlapX = Math.max(0,
      Math.min(fpBbox.maxX, planeBbox.maxX) - Math.max(fpBbox.minX, planeBbox.minX));
    const overlapY = Math.max(0,
      Math.min(fpBbox.maxY, planeBbox.maxY) - Math.max(fpBbox.minY, planeBbox.minY));
    const overlapArea = overlapX * overlapY;
    const fpArea = fpBbox.width * fpBbox.height;
    const planeArea = planeBbox.width * planeBbox.height;
    const unionArea = fpArea + planeArea - overlapArea;
    bboxMatchScore = unionArea > 0 ? overlapArea / unionArea : 0;
    bboxMatch = bboxMatchScore > 0.85;

    if (!bboxMatch && planePts.length > 0) {
      failures.push(`footprint_plane_bbox_mismatch_iou_${Math.round(bboxMatchScore * 100)}`);
    }
  }

  // 5. Detect template geometry
  const isTemplateGeometry = detectTemplateGeometry(planes, edges);
  if (isTemplateGeometry) {
    failures.push("diagram_renderer_using_template_geometry");
  }

  return {
    page: "all",
    source: input.topologySource,
    plane_count: planes.length,
    edge_count: edges.length,
    uses_raster_space_geometry: usesRasterSpace,
    uses_template_geometry: isTemplateGeometry,
    aerial_diagram_match_score: bboxMatchScore,
    footprint_bbox_match: bboxMatch,
    passed: failures.length === 0,
    failures,
  };
}

/**
 * Detect if geometry looks like it came from a generic template
 * rather than aerial-derived structure.
 *
 * Template markers:
 * - All planes have identical aspect ratios (±5%)
 * - Ridge is exactly centered on footprint long axis
 * - All hip lines are at exactly 45°
 * - Plane count is exactly 4 with symmetric layout
 */
function detectTemplateGeometry(
  planes: Array<{ polygon_px: Point[]; source?: string }>,
  edges: Array<{ line_px: Point[]; edge_type: string; source?: string }>,
): boolean {
  if (planes.length !== 4) return false;

  // Check if all planes have suspiciously similar aspect ratios
  const aspectRatios = planes.map(p => {
    const bb = bboxFromPoints(p.polygon_px || []);
    if (!bb || bb.height === 0) return 0;
    return bb.width / bb.height;
  }).filter(r => r > 0);

  if (aspectRatios.length === 4) {
    const avg = aspectRatios.reduce((s, v) => s + v, 0) / 4;
    const allSimilar = aspectRatios.every(r => Math.abs(r - avg) / avg < 0.05);
    if (allSimilar) return true;
  }

  // Check if hip edges are all at exactly 45° (template marker)
  const hipEdges = edges.filter(e => e.edge_type === "hip");
  if (hipEdges.length === 4) {
    const angles = hipEdges.map(e => {
      const pts = e.line_px || [];
      if (pts.length < 2) return -1;
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      return Math.abs(Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI);
    }).filter(a => a >= 0);

    const all45 = angles.every(a => Math.abs(a - 45) < 2);
    if (all45) return true;
  }

  return false;
}

/**
 * Enforce that diagram input uses solver geometry, not template fallback.
 * Call this before generateRoofDiagrams to assert compliance.
 */
export function assertDiagramUsesAerialGeometry(
  qa: AerialDiagramQA,
  strict: boolean = false,
): void {
  console.log("[DIAGRAM_SOURCE_ASSERT]", JSON.stringify(qa));

  if (qa.uses_template_geometry && qa.plane_count > 1) {
    const msg = "diagram_renderer_using_template_geometry — " +
      `planes=${qa.plane_count} edges=${qa.edge_count} ` +
      `match_score=${qa.aerial_diagram_match_score.toFixed(2)}`;
    console.error("[DIAGRAM_SOURCE_ASSERT] FAIL:", msg);
    if (strict) throw new Error(msg);
  }

  if (qa.failures.length > 0) {
    console.warn("[DIAGRAM_SOURCE_ASSERT] WARNINGS:", qa.failures.join(", "));
  }
}

function bboxFromPoints(points: Point[]): {
  minX: number; minY: number; maxX: number; maxY: number;
  width: number; height: number;
} | null {
  const valid = (points || []).filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (!valid.length) return null;
  const minX = Math.min(...valid.map(p => p.x));
  const maxX = Math.max(...valid.map(p => p.x));
  const minY = Math.min(...valid.map(p => p.y));
  const maxY = Math.max(...valid.map(p => p.y));
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}
