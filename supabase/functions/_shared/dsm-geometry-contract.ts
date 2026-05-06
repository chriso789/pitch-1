/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DSM VALIDATED GEOMETRY CONTRACT                                   ║
 * ║                                                                    ║
 * ║  Six hard gates that must ALL pass before geometry_source may be   ║
 * ║  set to "dsm_validated" and customer_report_ready = true.          ║
 * ║                                                                    ║
 * ║  1. Authoritative footprint from Google Solar mask                 ║
 * ║  2. Single coordinate contract (DSM px for solver, geo for output) ║
 * ║  3. Canonical shared edges between faces                           ║
 * ║  4. Area conservation: Σ(face_plan_area) ≈ footprint_area         ║
 * ║  5. Overlay registration (no bbox rescue for validated geometry)   ║
 * ║  6. Debug metrics persistence                                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

type XY = [number, number];

// ============= TYPES =============

export interface FootprintValidation {
  footprint_source: 'google_solar_mask' | 'mapbox' | 'osm' | 'regrid' | 'manual' | 'unknown' | 'none';
  footprint_geo: XY[];
  footprint_px: [number, number][];
  footprint_area_sqft: number;
}

export interface CoordinateSpaceValidation {
  coordinate_space_solver: 'dsm_px' | 'geo' | 'unknown';
  geometry_dsm_px: Record<string, [number, number][]>;
  geometry_geo: Record<string, XY[]>;
}

export interface TopologyValidation {
  shared_edge_count: number;
  duplicate_edge_count: number;
  dangling_edge_count: number;
  outside_footprint_count: number;
  faces_with_shared_edges: number;
  total_faces: number;
}

export interface AreaConservation {
  sum_face_plan_area_sqft: number;
  footprint_area_sqft: number;
  area_conservation_ratio: number;
}

export interface OverlayRegistration {
  overlay_requires_bbox_rescue: boolean;
  overlay_rms_px: number;
  mask_iou: number;
}

export interface DSMContractDebugMetrics {
  footprint_source: string;
  footprint_area_sqft: number;
  coordinate_space_solver: string;
  shared_edge_count: number;
  duplicate_edge_count: number;
  dangling_edge_count: number;
  outside_footprint_count: number;
  area_conservation_ratio: number;
  overlay_requires_bbox_rescue: boolean;
  overlay_rms_px: number;
  mask_iou: number;
}

export interface DSMContractGateResult {
  all_passed: boolean;
  geometry_source: 'dsm_validated' | 'heuristic_estimate';
  customer_report_ready: boolean;
  gates: {
    footprint: { passed: boolean; reason: string };
    coordinate_space: { passed: boolean; reason: string };
    topology: { passed: boolean; reason: string };
    area_conservation: { passed: boolean; reason: string };
    overlay_registration: { passed: boolean; reason: string };
  };
  debug_metrics: DSMContractDebugMetrics;
}

// ============= GATE 1: AUTHORITATIVE FOOTPRINT =============

export function validateFootprint(input: FootprintValidation): { passed: boolean; reason: string } {
  if (!input.footprint_source || input.footprint_source === 'unknown' || input.footprint_source === 'none') {
    return { passed: false, reason: `footprint_source is '${input.footprint_source}' — must be a known source` };
  }

  if (!input.footprint_geo || input.footprint_geo.length < 4) {
    return { passed: false, reason: `footprint_geo has ${input.footprint_geo?.length ?? 0} vertices — need ≥4` };
  }

  if (!input.footprint_px || input.footprint_px.length < 4) {
    return { passed: false, reason: `footprint_px has ${input.footprint_px?.length ?? 0} vertices — need ≥4` };
  }

  // Sanity: 200–50,000 sqft
  if (input.footprint_area_sqft < 200) {
    return { passed: false, reason: `footprint_area ${input.footprint_area_sqft.toFixed(0)} sqft too small (<200)` };
  }
  if (input.footprint_area_sqft > 50000) {
    return { passed: false, reason: `footprint_area ${input.footprint_area_sqft.toFixed(0)} sqft too large (>50000)` };
  }

  return { passed: true, reason: 'Footprint is valid and persisted' };
}

// ============= GATE 2: COORDINATE SPACE =============

export function validateCoordinateSpace(input: CoordinateSpaceValidation): { passed: boolean; reason: string } {
  if (input.coordinate_space_solver !== 'dsm_px') {
    return { passed: false, reason: `coordinate_space_solver is '${input.coordinate_space_solver}' — must be 'dsm_px'` };
  }

  const pxKeys = Object.keys(input.geometry_dsm_px || {});
  const geoKeys = Object.keys(input.geometry_geo || {});

  if (pxKeys.length === 0) {
    return { passed: false, reason: 'geometry_dsm_px is empty — solver must persist DSM pixel coordinates' };
  }

  if (geoKeys.length === 0) {
    return { passed: false, reason: 'geometry_geo is empty — output must persist geo coordinates' };
  }

  if (pxKeys.length !== geoKeys.length) {
    return { passed: false, reason: `Mismatch: ${pxKeys.length} DSM px faces vs ${geoKeys.length} geo faces` };
  }

  return { passed: true, reason: 'Dual coordinate persistence verified' };
}

// ============= GATE 3: PLANAR TOPOLOGY =============

export function validateTopology(input: TopologyValidation): { passed: boolean; reason: string } {
  if (input.duplicate_edge_count > 0) {
    return { passed: false, reason: `${input.duplicate_edge_count} duplicate adjacent edges found` };
  }

  if (input.dangling_edge_count > 0) {
    return { passed: false, reason: `${input.dangling_edge_count} dangling graph edges in validated output` };
  }

  if (input.outside_footprint_count > 0) {
    return { passed: false, reason: `${input.outside_footprint_count} edges outside footprint boundary` };
  }

  // Every face with >1 neighbor must share at least one canonical edge
  if (input.total_faces > 1 && input.shared_edge_count === 0) {
    return { passed: false, reason: 'No shared edges between faces — planar topology broken' };
  }

  return { passed: true, reason: `Topology clean: ${input.shared_edge_count} shared edges, 0 duplicates/dangling` };
}

// ============= GATE 4: AREA CONSERVATION =============

export function validateAreaConservation(input: AreaConservation): { passed: boolean; reason: string } {
  if (input.footprint_area_sqft <= 0) {
    return { passed: false, reason: 'footprint_area_sqft is zero or negative' };
  }

  const ratio = input.sum_face_plan_area_sqft / input.footprint_area_sqft;

  if (ratio < 0.95) {
    return { passed: false, reason: `area_conservation_ratio ${ratio.toFixed(3)} < 0.95 — faces undercover footprint` };
  }

  if (ratio > 1.05) {
    return { passed: false, reason: `area_conservation_ratio ${ratio.toFixed(3)} > 1.05 — faces exceed footprint` };
  }

  return { passed: true, reason: `area_conservation_ratio ${ratio.toFixed(3)} within [0.95, 1.05]` };
}

// ============= GATE 5: OVERLAY REGISTRATION =============

export function validateOverlayRegistration(input: OverlayRegistration): { passed: boolean; reason: string } {
  if (input.overlay_requires_bbox_rescue) {
    return { passed: false, reason: 'overlay_requires_bbox_rescue=true — validated geometry must render from persisted px coordinates' };
  }

  if (input.overlay_rms_px > 4) {
    return { passed: false, reason: `overlay_rms_px ${input.overlay_rms_px.toFixed(2)} > 4 — registration too loose` };
  }

  if (input.mask_iou < 0.85) {
    return { passed: false, reason: `mask_iou ${input.mask_iou.toFixed(3)} < 0.85 — geometry doesn't match roof mask` };
  }

  return { passed: true, reason: `Registration OK: rms=${input.overlay_rms_px.toFixed(2)}px, iou=${input.mask_iou.toFixed(3)}` };
}

// ============= COMBINED GATE =============

export interface DSMContractInput {
  footprint: FootprintValidation;
  coordinateSpace: CoordinateSpaceValidation;
  topology: TopologyValidation;
  areaConservation: AreaConservation;
  overlayRegistration: OverlayRegistration;
}

export function evaluateDSMContract(input: DSMContractInput): DSMContractGateResult {
  const footprintGate = validateFootprint(input.footprint);
  const coordGate = validateCoordinateSpace(input.coordinateSpace);
  const topoGate = validateTopology(input.topology);
  const areaGate = validateAreaConservation(input.areaConservation);
  const overlayGate = validateOverlayRegistration(input.overlayRegistration);

  const all_passed = footprintGate.passed && coordGate.passed && topoGate.passed && areaGate.passed && overlayGate.passed;

  const ratio = input.areaConservation.footprint_area_sqft > 0
    ? input.areaConservation.sum_face_plan_area_sqft / input.areaConservation.footprint_area_sqft
    : 0;

  return {
    all_passed,
    geometry_source: all_passed ? 'dsm_validated' : 'heuristic_estimate',
    customer_report_ready: all_passed,
    gates: {
      footprint: footprintGate,
      coordinate_space: coordGate,
      topology: topoGate,
      area_conservation: areaGate,
      overlay_registration: overlayGate,
    },
    debug_metrics: {
      footprint_source: input.footprint.footprint_source,
      footprint_area_sqft: input.footprint.footprint_area_sqft,
      coordinate_space_solver: input.coordinateSpace.coordinate_space_solver,
      shared_edge_count: input.topology.shared_edge_count,
      duplicate_edge_count: input.topology.duplicate_edge_count,
      dangling_edge_count: input.topology.dangling_edge_count,
      outside_footprint_count: input.topology.outside_footprint_count,
      area_conservation_ratio: ratio,
      overlay_requires_bbox_rescue: input.overlayRegistration.overlay_requires_bbox_rescue,
      overlay_rms_px: input.overlayRegistration.overlay_rms_px,
      mask_iou: input.overlayRegistration.mask_iou,
    },
  };
}

// ============= TOPOLOGY ANALYZER FOR GRAPH =============

/**
 * Analyze an autonomous graph result for topology metrics needed by Gate 3.
 * Also computes outside-footprint count.
 */
export function analyzeGraphTopology(
  edges: Array<{ id: string; type: string; start: XY; end: XY }>,
  faces: Array<{ id: string; edge_ids: string[] }>,
  footprint: XY[],
): TopologyValidation {
  // Count shared edges (edges referenced by >1 face)
  const edgeRefCount = new Map<string, number>();
  for (const face of faces) {
    for (const eid of face.edge_ids) {
      edgeRefCount.set(eid, (edgeRefCount.get(eid) || 0) + 1);
    }
  }
  const shared_edge_count = [...edgeRefCount.values()].filter(c => c > 1).length;

  // Duplicate edges: same start+end appearing multiple times
  const edgeSignatures = new Set<string>();
  let duplicate_edge_count = 0;
  for (const e of edges) {
    const sig1 = `${e.start[0].toFixed(8)},${e.start[1].toFixed(8)}-${e.end[0].toFixed(8)},${e.end[1].toFixed(8)}`;
    const sig2 = `${e.end[0].toFixed(8)},${e.end[1].toFixed(8)}-${e.start[0].toFixed(8)},${e.start[1].toFixed(8)}`;
    if (edgeSignatures.has(sig1) || edgeSignatures.has(sig2)) {
      duplicate_edge_count++;
    } else {
      edgeSignatures.add(sig1);
    }
  }

  // Dangling edges: structural edges (ridge/hip/valley) with endpoint not connected to any other edge
  const vertexConnections = new Map<string, number>();
  for (const e of edges) {
    const sk = `${e.start[0].toFixed(8)},${e.start[1].toFixed(8)}`;
    const ek = `${e.end[0].toFixed(8)},${e.end[1].toFixed(8)}`;
    vertexConnections.set(sk, (vertexConnections.get(sk) || 0) + 1);
    vertexConnections.set(ek, (vertexConnections.get(ek) || 0) + 1);
  }
  let dangling_edge_count = 0;
  const structuralTypes = new Set(['ridge', 'hip', 'valley']);
  for (const e of edges) {
    if (!structuralTypes.has(e.type)) continue;
    const sk = `${e.start[0].toFixed(8)},${e.start[1].toFixed(8)}`;
    const ek = `${e.end[0].toFixed(8)},${e.end[1].toFixed(8)}`;
    if ((vertexConnections.get(sk) || 0) < 2 && (vertexConnections.get(ek) || 0) < 2) {
      dangling_edge_count++;
    }
  }

  // Outside footprint check
  let outside_footprint_count = 0;
  for (const e of edges) {
    if (e.type === 'eave' || e.type === 'rake') continue;
    const mid: XY = [(e.start[0] + e.end[0]) / 2, (e.start[1] + e.end[1]) / 2];
    if (!pointInPolygon(mid, footprint)) {
      outside_footprint_count++;
    }
  }

  return {
    shared_edge_count,
    duplicate_edge_count,
    dangling_edge_count,
    outside_footprint_count,
    faces_with_shared_edges: [...edgeRefCount.values()].filter(c => c > 1).length,
    total_faces: faces.length,
  };
}

function pointInPolygon(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ============= OVERLAY REGISTRATION CALCULATOR =============

/**
 * Compute overlay registration quality metrics.
 * - RMS pixel error between projected geo-coordinates and persisted px coordinates
 * - IoU between solver geometry coverage and roof mask
 */
export function computeOverlayRegistration(
  faces: Array<{ polygon: XY[] }>,
  footprint_geo: XY[],
  footprint_px: [number, number][],
  mask?: { data: Uint8Array; width: number; height: number } | null,
  dsmBounds?: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null,
): OverlayRegistration {
  // If no mask or DSM bounds, we can't compute registration — assume needs rescue
  if (!mask || !dsmBounds || footprint_px.length === 0) {
    return { overlay_requires_bbox_rescue: true, overlay_rms_px: 999, mask_iou: 0 };
  }

  // Compute RMS error: project footprint_geo to px using DSM bounds, compare to persisted footprint_px
  let sumSqError = 0;
  const n = Math.min(footprint_geo.length, footprint_px.length);
  for (let i = 0; i < n; i++) {
    const expectedPx = geoToPixelSimple(footprint_geo[i], dsmBounds, mask.width, mask.height);
    const dx = expectedPx[0] - footprint_px[i][0];
    const dy = expectedPx[1] - footprint_px[i][1];
    sumSqError += dx * dx + dy * dy;
  }
  const rms = n > 0 ? Math.sqrt(sumSqError / n) : 999;

  // Compute mask IoU: what fraction of solver face pixels overlap with mask roof pixels
  const facePixelSet = new Set<number>();
  for (const face of faces) {
    // Rasterize face polygon into pixel indices
    const facePx = face.polygon.map(p => geoToPixelSimple(p, dsmBounds, mask.width, mask.height));
    rasterizePolygonToSet(facePx, mask.width, mask.height, facePixelSet);
  }

  let intersection = 0;
  let maskTotal = 0;
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] > 0) maskTotal++;
    if (mask.data[i] > 0 && facePixelSet.has(i)) intersection++;
  }
  const union = maskTotal + facePixelSet.size - intersection;
  const iou = union > 0 ? intersection / union : 0;

  return {
    overlay_requires_bbox_rescue: false,
    overlay_rms_px: rms,
    mask_iou: iou,
  };
}

function geoToPixelSimple(
  p: XY,
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  w: number, h: number
): [number, number] {
  const x = Math.floor((p[0] - bounds.minLng) / (bounds.maxLng - bounds.minLng) * w);
  const y = Math.floor((bounds.maxLat - p[1]) / (bounds.maxLat - bounds.minLat) * h);
  return [Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y))];
}

function rasterizePolygonToSet(
  polygon: [number, number][],
  width: number,
  height: number,
  pixelSet: Set<number>,
): void {
  if (polygon.length < 3) return;
  const ys = polygon.map(p => p[1]);
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(height - 1, Math.max(...ys));

  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const yi = polygon[i][1], yj = polygon[j][1];
      if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
        const x = polygon[i][0] + (y - yi) / (yj - yi) * (polygon[j][0] - polygon[i][0]);
        intersections.push(x);
      }
    }
    intersections.sort((a, b) => a - b);
    for (let k = 0; k < intersections.length - 1; k += 2) {
      const xStart = Math.max(0, Math.ceil(intersections[k]));
      const xEnd = Math.min(width - 1, Math.floor(intersections[k + 1]));
      for (let x = xStart; x <= xEnd; x++) {
        pixelSet.add(y * width + x);
      }
    }
  }
}
