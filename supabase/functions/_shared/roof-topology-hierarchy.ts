/**
 * RoofTopologyHierarchy v1 — Authoritative Structural Backbone
 *
 * This is the SINGLE canonical representation that ALL downstream consumers
 * (diagram, overlay, PDF, materials, learning) read. It replaces the ad-hoc
 * plane arrays and merge artifacts that previously drifted between solver branches.
 *
 * Architecture (per audit recommendations):
 *   Fix #1: RoofTopologyHierarchy — authoritative state object
 *   Fix #2: Assembly decomposition engine
 *   Fix #3: Formalized edge classification evidence model
 *
 * The hierarchy has four levels:
 *   1. TopologyNode  — graph vertices with stable IDs and connection info
 *   2. TopologyEdge  — structural lines with FULL classification evidence
 *   3. TopologyFace  — roof planes with provenance and provisional state
 *   4. RoofAssembly  — sub-roof systems (gables, dormers, transitions)
 *
 * COORDINATE-SPACE CONTRACT:
 *   - geometry_dsm_px: all pixel-space geometry for internal processing
 *   - geometry_geo: all geo-coordinate geometry for persistence/display
 *   - The hierarchy stores BOTH and keeps them in sync
 */

// ═══════════════════════════════════════════════════════════════════
// FIX #3: FORMALIZED EDGE CLASSIFICATION EVIDENCE
// ═══════════════════════════════════════════════════════════════════

export type EdgeClassificationType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unclassified';
export type ProvisionalReason = 'marginal_plane_rms' | 'low_connectivity' | 'assembly_boundary' | 'weak_dsm_signal' | 'deferred_structural';

/**
 * Full evidence record for each structural edge classification.
 * This is the "evidence-backed classification layer" the audit requires.
 * Aurora's graph patent: typed edges derive from graph relations and face logic.
 */
export interface EdgeClassificationEvidence {
  /** Unique ID of the raw DSM edge(s) that produced this structural edge */
  raw_edge_id: string;
  /** If this edge was merged from multiple raw edges, their IDs */
  supporting_raw_edge_ids: string[];
  /** Number of faces adjacent to this edge (0, 1, or 2) */
  adjacent_face_count: number;
  /** Face ID on the "left" side (looking from start→end) */
  left_face_id: string | null;
  /** Face ID on the "right" side */
  right_face_id: string | null;
  /** Plane normal of left face [nx, ny, nz] (from DSM plane fit) */
  left_plane_normal: [number, number, number] | null;
  /** Plane normal of right face */
  right_plane_normal: [number, number, number] | null;
  /** Downslope direction of left face [dx, dy] in DSM pixel space */
  left_downslope_vector: [number, number] | null;
  /** Downslope direction of right face */
  right_downslope_vector: [number, number] | null;
  /** Dihedral angle between adjacent planes (degrees) */
  angle_between_planes_deg: number | null;
  /** DSM elevation samples along the edge [start→end] */
  edge_height_profile: number[];
  /** Along-edge elevation gradient (m per pixel). Ridges ≈0, hips >0 */
  along_edge_gradient: number | null;
  /** Convexity sign: +1 = convex (ridge), -1 = concave (valley), 0 = flat/unknown */
  convexity_sign: number;
  /** Classification method that produced the final type */
  classification_method: 'face_adjacency_planes' | 'dsm_perpendicular_profile' | 'dsm_along_edge_gradient' | 'footprint_boundary' | 'dsm_proximity_fallback' | 'unresolved';
  /** Confidence in the classification (0-1) */
  classification_confidence: number;
  /** Whether the edge is on the footprint boundary */
  on_footprint_boundary: boolean;
  /** Structural tier from hierarchy clustering */
  structural_tier: 'primary' | 'secondary' | 'tertiary' | null;
  /** DSM prominence score at edge midpoint */
  dsm_prominence: number | null;
}

// ═══════════════════════════════════════════════════════════════════
// FIX #1: TOPOLOGY HIERARCHY TYPES
// ═══════════════════════════════════════════════════════════════════

type XY = [number, number];
type PxPt = { x: number; y: number };

export interface TopologyNode {
  id: string;
  /** Position in geo coordinates [lng, lat] */
  position_geo: XY;
  /** Position in DSM pixel space */
  position_px: PxPt;
  /** Structural type inferred from connected edges */
  type: 'eave_corner' | 'ridge_endpoint' | 'valley_intersection' | 'hip_intersection' | 'assembly_junction';
  /** IDs of edges connected to this node */
  connected_edge_ids: string[];
  /** Degree = number of connected edges */
  degree: number;
  /** If this is a junction between assemblies */
  is_assembly_boundary: boolean;
}

export interface TopologyEdge {
  id: string;
  /** Classified type */
  type: EdgeClassificationType;
  /** Start vertex ID */
  start_node_id: string;
  /** End vertex ID */
  end_node_id: string;
  /** Geo coordinates */
  start_geo: XY;
  end_geo: XY;
  /** Pixel coordinates */
  start_px: PxPt;
  end_px: PxPt;
  /** Length in feet */
  length_ft: number;
  /** Length in pixels */
  length_px: number;
  /** IDs of faces this edge borders */
  face_ids: string[];
  /** Assembly this edge belongs to */
  assembly_id: string | null;
  /** Evidence source */
  source: 'dsm' | 'solar_segments' | 'skeleton' | 'fused' | 'perimeter' | 'footprint';
  /** Overall confidence score (0-1) */
  confidence: number;
  /** FULL classification evidence record (Fix #3) */
  classification_evidence: EdgeClassificationEvidence;

  // ── Provisional lifecycle ──
  /** Whether this edge is provisional (not yet fully validated) */
  provisional: boolean;
  /** Why it was made provisional */
  provisional_reason: ProvisionalReason | null;
  /** Score supporting provisional retention */
  provisional_support_score: number;
  /** Pipeline stage at which provisional status expires */
  provisional_expiry_stage: 'clustering' | 'face_extraction' | 'refinement' | 'final_validation' | null;
  /** Why it was retained through expiry */
  provisional_retain_reason: string | null;
  /** Why it was released (if it was) */
  provisional_release_reason: string | null;

  // ── Lineage ──
  /** Which refinement round introduced/modified this edge */
  refinement_round: number;
  /** Edge IDs from a previous round that seeded this edge */
  refinement_origin_edge_ids: string[];
}

export interface TopologyFace {
  id: string;
  /** Human label (A, B, C, ...) */
  label: string;
  /** Closed polygon in geo coordinates */
  polygon_geo: XY[];
  /** Closed polygon in pixel space */
  polygon_px: PxPt[];
  /** Plan-view area in sqft */
  plan_area_sqft: number;
  /** Sloped roof area in sqft */
  roof_area_sqft: number;
  /** Pitch in degrees */
  pitch_degrees: number;
  /** Azimuth in degrees */
  azimuth_degrees: number;
  /** IDs of edges bounding this face */
  edge_ids: string[];
  /** Assembly this face belongs to */
  assembly_id: string | null;

  // ── Plane fit evidence ──
  /** RMS error of DSM plane fit (meters) */
  plane_rms: number | null;
  /** Plane normal vector [nx, ny, nz] */
  plane_normal: [number, number, number] | null;
  /** Downslope direction [dx, dy] in pixel space */
  downslope_vector: [number, number] | null;
  /** Plane slope in x direction (dz/dx in meters/pixel) */
  plane_slope_x: number | null;
  /** Plane slope in y direction (dz/dy in meters/pixel) */
  plane_slope_y: number | null;

  // ── Provisional lifecycle ──
  provisional: boolean;
  provisional_reason: ProvisionalReason | null;
  plane_fit_quality: 'strict' | 'marginal' | 'no_dsm';

  // ── Lineage ──
  /** How this face was created */
  face_seed_type: 'planar_cycle' | 'refinement_split' | 'assembly_decomposition';
  /** Which refinement round produced this face */
  refinement_round: number;
  /** Face IDs from a previous round that this face was split from */
  refinement_origin_face_ids: string[];
}

// ═══════════════════════════════════════════════════════════════════
// FIX #2: ASSEMBLY DECOMPOSITION
// ═══════════════════════════════════════════════════════════════════

export type AssemblyType = 'main_body' | 'cross_gable' | 'dormer' | 'wing' | 'garage' | 'porch' | 'transition' | 'unknown';

export interface RoofAssembly {
  /** Unique assembly ID */
  id: string;
  /** Parent assembly ID (null for root/main body) */
  parent_id: string | null;
  /** Hierarchy level: 0 = main body, 1 = primary wing, 2 = dormer, etc. */
  level: number;
  /** Structural type */
  type: AssemblyType;
  /** Bounding box in pixel space */
  bbox_px: { minX: number; minY: number; maxX: number; maxY: number };
  /** Bounding box in geo coordinates */
  bbox_geo: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  /** IDs of faces in this assembly */
  face_ids: string[];
  /** IDs of edges in this assembly */
  edge_ids: string[];
  /** IDs of nodes in this assembly */
  node_ids: string[];
  /** Confidence that this assembly is correctly identified */
  confidence: number;
  /** Evidence that supports this assembly's existence */
  evidence: AssemblyEvidence;
}

export interface AssemblyEvidence {
  /** How the assembly was detected */
  detection_method: 'ridge_chain' | 'valley_chain' | 'footprint_reflex' | 'solar_segment_cluster' | 'elevation_region' | 'manual';
  /** Number of solar segments that match this assembly */
  solar_segment_matches: number;
  /** Reflex corner indices that seed this assembly */
  reflex_corner_indices: number[];
  /** DSM elevation region ID(s) covered by this assembly */
  elevation_region_ids: number[];
  /** Mean elevation in this assembly region (meters) */
  mean_elevation_m: number | null;
  /** Primary ridge chain that defines this assembly (edge IDs) */
  primary_ridge_chain: string[];
  /** Valley chains bounding this assembly (edge IDs) */
  boundary_valley_chains: string[][];
}

// ═══════════════════════════════════════════════════════════════════
// THE HIERARCHY: SINGLE AUTHORITATIVE STATE
// ═══════════════════════════════════════════════════════════════════

export interface RoofTopologyHierarchy {
  /** Schema version */
  version: 'topology-v1';
  /** Timestamp of creation */
  created_at: string;

  // ── Core graph ──
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  faces: TopologyFace[];
  assemblies: RoofAssembly[];

  // ── Provenance ──
  /** Source of the topology */
  topology_source: 'autonomous_dsm_graph_solver';
  /** Coordinate spaces used */
  coordinate_space_solver: 'dsm_px';
  coordinate_space_export: 'geo';

  // ── Solve context ──
  /** Footprint used for this solve (geo coordinates) */
  footprint_geo: XY[];
  /** Footprint in pixel space */
  footprint_px: PxPt[];
  /** Footprint area in sqft */
  footprint_area_sqft: number;
  /** Solar segment stats used as priors */
  solar_segment_priors: SolarSegmentPrior[];

  // ── Phase 0: Perimeter contract ──
  /** Whether Phase 0 perimeter gate passed */
  perimeter_gate_passed: boolean;
  /** Perimeter source used */
  perimeter_source: string | null;
  /** Perimeter eave total (ft) */
  perimeter_eave_ft: number;
  /** Perimeter rake total (ft) */
  perimeter_rake_ft: number;
  /** Perimeter area (sqft) */
  perimeter_area_sqft: number;

  // ── Quality metrics ──
  metrics: TopologyMetrics;

  // ── Refinement history ──
  /** Number of refinement rounds applied */
  refinement_rounds_applied: number;
  /** Summary of each refinement round */
  refinement_history: RefinementRound[];
}

export interface SolarSegmentPrior {
  /** Index in the original solar segments array */
  index: number;
  pitch_degrees: number;
  azimuth_degrees: number;
  area_sqft: number;
  center_geo: XY | null;
  /** Which assembly this segment was matched to */
  matched_assembly_id: string | null;
  /** Which face this segment was matched to */
  matched_face_id: string | null;
  /** Match quality score */
  match_score: number;
}

export interface TopologyMetrics {
  // ── Face metrics ──
  face_count: number;
  provisional_face_count: number;
  strict_face_count: number;
  expected_min_faces: number;
  expected_face_reasoning: string;

  // ── Edge metrics ──
  total_edge_count: number;
  ridge_count: number;
  valley_count: number;
  hip_count: number;
  eave_count: number;
  rake_count: number;
  ridge_ft: number;
  valley_ft: number;
  hip_ft: number;
  eave_ft: number;
  rake_ft: number;

  // ── Coverage ──
  coverage_ratio: number;
  area_conservation_ratio: number;
  max_plane_area_ratio: number;
  largest_plane_sqft: number;

  // ── Assembly ──
  assembly_count: number;

  // ── Topology quality ──
  topology_fidelity_score: number;
  topology_fidelity: 'high' | 'medium' | 'low';
  ridge_valley_presence_pass: boolean;

  // ── Provisional lifecycle ──
  provisional_edges_total: number;
  provisional_edges_retained: number;
  provisional_edges_released: number;

  // ── Publication gate ──
  customer_report_ready: boolean;
  customer_report_block_reason: string | null;
}

export interface RefinementRound {
  round: number;
  /** What triggered this refinement */
  trigger: 'undersegmented' | 'oversized_plane' | 'assembly_split' | 'provisional_resolution';
  /** Edges reintroduced in this round */
  edges_reintroduced: number;
  /** Faces before this round */
  faces_before: number;
  /** Faces after this round */
  faces_after: number;
  /** Whether the refinement was accepted */
  accepted: boolean;
  /** Why it was accepted/rejected */
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════
// TOPOLOGY EVIDENCE INPUT (normalized solver contract)
// ═══════════════════════════════════════════════════════════════════

export interface TopologyEvidence {
  footprint_geo: XY[];
  footprint_px: PxPt[];
  footprint_area_sqft: number;
  raster_context: {
    width: number;
    height: number;
    bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
    meters_per_pixel: number;
  };
  dsm_edges: RawStructuralEdge[];
  skeleton_edges: RawStructuralEdge[];
  solar_segments: SolarSegmentInput[];
  boundary_edges: {
    eaves: Array<{ start_geo: XY; end_geo: XY; start_px: PxPt; end_px: PxPt }>;
    rakes: Array<{ start_geo: XY; end_geo: XY; start_px: PxPt; end_px: PxPt }>;
  };
  /** DSM grid for plane fitting and elevation queries */
  dsm_grid: any | null;
  /** Masked DSM for edge detection */
  masked_dsm: any | null;
  /** Registration state */
  registration: {
    rms_px: number;
    max_error_px: number;
    coverage_ratio: number;
    center_error_px: number;
    publish_allowed: boolean;
  } | null;
}

export interface RawStructuralEdge {
  id: string;
  start_geo: XY;
  end_geo: XY;
  start_px: PxPt;
  end_px: PxPt;
  type: 'ridge' | 'valley' | 'hip';
  score: number;
  source: 'dsm' | 'skeleton';
  length_ft: number;
  length_px: number;
}

export interface SolarSegmentInput {
  index: number;
  pitch_degrees: number;
  azimuth_degrees: number;
  area_sqft: number;
  center_geo: XY | null;
  bbox_geo: { sw: XY; ne: XY } | null;
  plane_height_m: number | null;
}

// ═══════════════════════════════════════════════════════════════════
// ASSEMBLY DECOMPOSITION ENGINE (Fix #2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect roof assemblies from evidence.
 *
 * Strategy (per audit):
 *   1. Detect major roof body from longest ridge chain
 *   2. Detect secondary roof systems via valley boundaries
 *   3. Detect local dormers/transitions from reflex corners
 *   4. Build ridge/valley graph per assembly
 *   5. Merge assemblies hierarchically
 *
 * NOT: one giant global planar solve.
 */
export function detectAssemblies(
  edges: TopologyEdge[],
  faces: TopologyFace[],
  footprint_geo: XY[],
  footprint_px: PxPt[],
  solar_segments: SolarSegmentInput[],
  dsm_grid: any | null,
): RoofAssembly[] {
  const assemblies: RoofAssembly[] = [];
  if (faces.length === 0) return assemblies;

  // Step 1: Identify reflex corners in footprint (L/T/U shaped roofs)
  const reflexIndices: number[] = [];
  const n = footprint_geo.length;
  for (let i = 0; i < n; i++) {
    const prev = footprint_geo[(i - 1 + n) % n];
    const curr = footprint_geo[i];
    const next = footprint_geo[(i + 1) % n];
    const cross = (prev[0] - curr[0]) * (next[1] - curr[1]) - (prev[1] - curr[1]) * (next[0] - curr[0]);
    if (cross < 0) reflexIndices.push(i);
  }

  // Step 2: Build adjacency from shared edges between faces
  const faceAdjacency = new Map<string, Set<string>>();
  for (const face of faces) {
    faceAdjacency.set(face.id, new Set());
  }
  for (const edge of edges) {
    if (edge.face_ids.length === 2) {
      const [f1, f2] = edge.face_ids;
      faceAdjacency.get(f1)?.add(f2);
      faceAdjacency.get(f2)?.add(f1);
    }
  }

  // Step 3: Find ridge chains (connected sequences of ridge edges)
  const ridgeEdges = edges.filter(e => e.type === 'ridge');
  const ridgeChains = findEdgeChains(ridgeEdges);

  // Step 4: Find valley chains (these are assembly boundaries)
  const valleyEdges = edges.filter(e => e.type === 'valley');
  const valleyChains = findEdgeChains(valleyEdges);

  // Step 5: Group faces into assemblies
  // Simple strategy: use elevation regions from DSM + valley boundaries
  if (faces.length <= 4 && reflexIndices.length === 0) {
    // Simple roof — single assembly
    const allFaceIds = faces.map(f => f.id);
    const allEdgeIds = edges.map(e => e.id);
    const allNodeIds = [...new Set(edges.flatMap(e => [e.start_node_id, e.end_node_id]))];
    assemblies.push(createAssembly(
      'asm-0', null, 0, 'main_body',
      allFaceIds, allEdgeIds, allNodeIds,
      faces, footprint_px, footprint_geo,
      { detection_method: 'ridge_chain', solar_segment_matches: solar_segments.length, reflex_corner_indices: [], elevation_region_ids: [0], mean_elevation_m: null, primary_ridge_chain: ridgeChains[0]?.map(e => e.id) || [], boundary_valley_chains: [] },
      0.9
    ));
  } else if (valleyChains.length > 0 && faces.length > 4) {
    // Complex roof — use valley chains to split into assemblies
    const assigned = new Set<string>();
    let asmIdx = 0;

    // Find face groups separated by valleys
    const valleyFaceIds = new Set<string>();
    for (const chain of valleyChains) {
      for (const vedge of chain) {
        for (const fid of vedge.face_ids) valleyFaceIds.add(fid);
      }
    }

    // BFS from each unassigned face, stopping at valley edges
    const valleyEdgeIds = new Set(valleyEdges.map(e => e.id));
    
    for (const face of faces) {
      if (assigned.has(face.id)) continue;
      const group: string[] = [];
      const queue = [face.id];
      assigned.add(face.id);

      while (queue.length > 0) {
        const fid = queue.shift()!;
        group.push(fid);
        const neighbors = faceAdjacency.get(fid) || new Set();
        for (const nid of neighbors) {
          if (assigned.has(nid)) continue;
          // Check if the shared edge is a valley (assembly boundary)
          const sharedEdge = edges.find(e =>
            e.face_ids.includes(fid) && e.face_ids.includes(nid)
          );
          if (sharedEdge && valleyEdgeIds.has(sharedEdge.id)) {
            // Valley boundary — don't cross into next assembly
            continue;
          }
          assigned.add(nid);
          queue.push(nid);
        }
      }

      if (group.length > 0) {
        const groupEdgeIds = edges
          .filter(e => e.face_ids.some(fid => group.includes(fid)))
          .map(e => e.id);
        const groupNodeIds = [...new Set(
          edges.filter(e => groupEdgeIds.includes(e.id))
            .flatMap(e => [e.start_node_id, e.end_node_id])
        )];

        const asmType: AssemblyType = asmIdx === 0 ? 'main_body' :
          group.length <= 2 ? 'dormer' :
          group.length <= 4 ? 'cross_gable' : 'wing';

        const matchingRidgeChain = ridgeChains.find(chain =>
          chain.some(e => e.face_ids.some(fid => group.includes(fid)))
        );

        const boundaryValleys = valleyChains.filter(chain =>
          chain.some(ve => ve.face_ids.some(fid => group.includes(fid)))
        );

        assemblies.push(createAssembly(
          `asm-${asmIdx}`, asmIdx === 0 ? null : 'asm-0', asmIdx === 0 ? 0 : 1, asmType,
          group, groupEdgeIds, groupNodeIds,
          faces.filter(f => group.includes(f.id)), footprint_px, footprint_geo,
          {
            detection_method: valleyChains.length > 0 ? 'valley_chain' : 'ridge_chain',
            solar_segment_matches: 0,
            reflex_corner_indices: reflexIndices,
            elevation_region_ids: [],
            mean_elevation_m: null,
            primary_ridge_chain: matchingRidgeChain?.map(e => e.id) || [],
            boundary_valley_chains: boundaryValleys.map(c => c.map(e => e.id)),
          },
          0.7
        ));
        asmIdx++;
      }
    }
  } else {
    // Moderate complexity — single assembly with reflex corners noted
    const allFaceIds = faces.map(f => f.id);
    const allEdgeIds = edges.map(e => e.id);
    const allNodeIds = [...new Set(edges.flatMap(e => [e.start_node_id, e.end_node_id]))];
    assemblies.push(createAssembly(
      'asm-0', null, 0, 'main_body',
      allFaceIds, allEdgeIds, allNodeIds,
      faces, footprint_px, footprint_geo,
      {
        detection_method: reflexIndices.length > 0 ? 'footprint_reflex' : 'ridge_chain',
        solar_segment_matches: solar_segments.length,
        reflex_corner_indices: reflexIndices,
        elevation_region_ids: [0],
        mean_elevation_m: null,
        primary_ridge_chain: ridgeChains[0]?.map(e => e.id) || [],
        boundary_valley_chains: [],
      },
      0.8
    ));
  }

  // Assign assembly_id to faces and edges
  for (const asm of assemblies) {
    for (const fid of asm.face_ids) {
      const face = faces.find(f => f.id === fid);
      if (face) face.assembly_id = asm.id;
    }
    for (const eid of asm.edge_ids) {
      const edge = edges.find(e => e.id === eid);
      if (edge) edge.assembly_id = asm.id;
    }
  }

  return assemblies;
}

/**
 * Find connected chains of edges (sequences where endpoints connect).
 */
function findEdgeChains(edges: TopologyEdge[]): TopologyEdge[][] {
  if (edges.length === 0) return [];

  const chains: TopologyEdge[][] = [];
  const used = new Set<string>();

  for (const seed of edges) {
    if (used.has(seed.id)) continue;
    const chain: TopologyEdge[] = [seed];
    used.add(seed.id);

    // Extend forward from end
    let current = seed;
    let searching = true;
    while (searching) {
      searching = false;
      for (const candidate of edges) {
        if (used.has(candidate.id)) continue;
        if (candidate.start_node_id === current.end_node_id ||
            candidate.end_node_id === current.end_node_id) {
          chain.push(candidate);
          used.add(candidate.id);
          current = candidate;
          searching = true;
          break;
        }
      }
    }

    // Extend backward from start
    current = seed;
    searching = true;
    while (searching) {
      searching = false;
      for (const candidate of edges) {
        if (used.has(candidate.id)) continue;
        if (candidate.start_node_id === current.start_node_id ||
            candidate.end_node_id === current.start_node_id) {
          chain.unshift(candidate);
          used.add(candidate.id);
          current = candidate;
          searching = true;
          break;
        }
      }
    }

    chains.push(chain);
  }

  return chains;
}

function createAssembly(
  id: string,
  parent_id: string | null,
  level: number,
  type: AssemblyType,
  face_ids: string[],
  edge_ids: string[],
  node_ids: string[],
  faces: TopologyFace[],
  footprint_px: PxPt[],
  footprint_geo: XY[],
  evidence: AssemblyEvidence,
  confidence: number,
): RoofAssembly {
  // Compute bounding boxes from face polygons
  const allPxPts = faces.flatMap(f => f.polygon_px);
  const allGeoPts = faces.flatMap(f => f.polygon_geo);

  const bbox_px = allPxPts.length > 0 ? {
    minX: Math.min(...allPxPts.map(p => p.x)),
    minY: Math.min(...allPxPts.map(p => p.y)),
    maxX: Math.max(...allPxPts.map(p => p.x)),
    maxY: Math.max(...allPxPts.map(p => p.y)),
  } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const bbox_geo = allGeoPts.length > 0 ? {
    minLng: Math.min(...allGeoPts.map(p => p[0])),
    minLat: Math.min(...allGeoPts.map(p => p[1])),
    maxLng: Math.max(...allGeoPts.map(p => p[0])),
    maxLat: Math.max(...allGeoPts.map(p => p[1])),
  } : { minLng: 0, minLat: 0, maxLng: 0, maxLat: 0 };

  return {
    id, parent_id, level, type,
    bbox_px, bbox_geo,
    face_ids, edge_ids, node_ids,
    confidence,
    evidence,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SOLAR SEGMENT PRIORS (Fix #5 from audit)
// ═══════════════════════════════════════════════════════════════════

/**
 * Use Google Solar roofSegmentStats as explicit priors for expected face count
 * and pitch/azimuth clusters. This data is already being retrieved but not
 * leveraged as a structural prior.
 */
export function computeSolarPriors(
  solar_segments: SolarSegmentInput[],
  footprint_area_sqft: number,
): { expected_min_faces: number; expected_face_reasoning: string; pitch_clusters: number[]; azimuth_clusters: number[] } {
  if (solar_segments.length === 0) {
    const fallback = footprint_area_sqft < 1500 ? 4 : footprint_area_sqft < 2500 ? 6 : footprint_area_sqft < 3500 ? 8 : 10;
    return {
      expected_min_faces: fallback,
      expected_face_reasoning: `no_solar_segments_fallback_by_area_${footprint_area_sqft.toFixed(0)}sqft`,
      pitch_clusters: [],
      azimuth_clusters: [],
    };
  }

  // Solar segment count is a strong floor for expected faces
  const segmentFloor = solar_segments.length;

  // Azimuth clustering: group by 45° bins
  const azimuthBins = new Set<number>();
  for (const seg of solar_segments) {
    const normalized = Math.round(((seg.azimuth_degrees || 0) % 360) / 45) * 45;
    azimuthBins.add(normalized);
  }

  // Pitch clustering: group by 5° bins
  const pitchBins = new Set<number>();
  for (const seg of solar_segments) {
    const normalized = Math.round((seg.pitch_degrees || 0) / 5) * 5;
    pitchBins.add(normalized);
  }

  // Expected faces: at least as many as solar segments, modified by complexity
  const areaFactor = footprint_area_sqft < 1500 ? 4 : footprint_area_sqft < 2500 ? 6 : footprint_area_sqft < 3500 ? 8 : 10;
  const expected_min_faces = Math.max(segmentFloor, areaFactor);

  return {
    expected_min_faces,
    expected_face_reasoning: `solar_segments=${segmentFloor},azimuth_groups=${azimuthBins.size},pitch_groups=${pitchBins.size},area_factor=${areaFactor}`,
    pitch_clusters: [...pitchBins].sort((a, b) => a - b),
    azimuth_clusters: [...azimuthBins].sort((a, b) => a - b),
  };
}

// ═══════════════════════════════════════════════════════════════════
// HIERARCHY BUILDER: Converts solver output → RoofTopologyHierarchy
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a RoofTopologyHierarchy from the autonomous graph solver output.
 * This is the bridge between the existing solver and the new topology backbone.
 *
 * It does NOT replace the solver — it normalizes its output into the
 * authoritative representation that all downstream consumers read.
 */
export function buildTopologyHierarchy(
  solverResult: {
    vertices: Array<{ id: string; position: XY; type: string; connected_edge_ids: string[] }>;
    edges: Array<{
      id: string; type: string; start: XY; end: XY; length_ft: number;
      confidence: { final_confidence: number; dsm_score: number };
      facet_ids: string[]; source: string;
    }>;
    faces: Array<{
      id: string; label: string; polygon: XY[];
      plan_area_sqft: number; roof_area_sqft: number;
      pitch_degrees: number; azimuth_degrees: number;
      edge_ids: string[]; provisional?: boolean; plane_rms?: number | null;
    }>;
  },
  footprint_geo: XY[],
  footprint_px: PxPt[],
  footprint_area_sqft: number,
  solar_segments: SolarSegmentInput[],
  dsm_grid: any | null,
  refinement_diagnostics: Record<string, unknown>,
  coverageRatio: number,
  maxPlaneAreaRatio: number,
  customerBlockReason: string | null,
): RoofTopologyHierarchy {
  const now = new Date().toISOString();

  // Convert solver vertices → TopologyNode
  const nodes: TopologyNode[] = solverResult.vertices.map(v => ({
    id: v.id,
    position_geo: v.position,
    position_px: dsm_grid ? geoToPx(v.position, dsm_grid) : { x: 0, y: 0 },
    type: v.type as TopologyNode['type'],
    connected_edge_ids: v.connected_edge_ids,
    degree: v.connected_edge_ids.length,
    is_assembly_boundary: false,
  }));

  // Convert solver edges → TopologyEdge with classification evidence
  const topoEdges: TopologyEdge[] = solverResult.edges.map(e => {
    const startPx = dsm_grid ? geoToPx(e.start, dsm_grid) : { x: 0, y: 0 };
    const endPx = dsm_grid ? geoToPx(e.end, dsm_grid) : { x: 0, y: 0 };
    const lengthPx = Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y);

    // Build classification evidence (Fix #3)
    const leftFace = e.facet_ids.length >= 1 ? e.facet_ids[0] : null;
    const rightFace = e.facet_ids.length >= 2 ? e.facet_ids[1] : null;

    const evidence: EdgeClassificationEvidence = {
      raw_edge_id: e.id,
      supporting_raw_edge_ids: [e.id],
      adjacent_face_count: e.facet_ids.length,
      left_face_id: leftFace,
      right_face_id: rightFace,
      left_plane_normal: null,
      right_plane_normal: null,
      left_downslope_vector: null,
      right_downslope_vector: null,
      angle_between_planes_deg: null,
      edge_height_profile: [],
      along_edge_gradient: null,
      convexity_sign: e.type === 'ridge' ? 1 : e.type === 'valley' ? -1 : 0,
      classification_method: e.facet_ids.length >= 2 ? 'face_adjacency_planes' : 'dsm_proximity_fallback',
      classification_confidence: e.confidence.final_confidence,
      on_footprint_boundary: e.type === 'eave' || e.type === 'rake',
      structural_tier: null,
      dsm_prominence: null,
    };

    // Find start/end node IDs
    const startNodeId = solverResult.vertices.find(v =>
      Math.abs(v.position[0] - e.start[0]) < 1e-7 && Math.abs(v.position[1] - e.start[1]) < 1e-7
    )?.id || '';
    const endNodeId = solverResult.vertices.find(v =>
      Math.abs(v.position[0] - e.end[0]) < 1e-7 && Math.abs(v.position[1] - e.end[1]) < 1e-7
    )?.id || '';

    return {
      id: e.id,
      type: e.type as EdgeClassificationType,
      start_node_id: startNodeId,
      end_node_id: endNodeId,
      start_geo: e.start,
      end_geo: e.end,
      start_px: startPx,
      end_px: endPx,
      length_ft: e.length_ft,
      length_px: lengthPx,
      face_ids: e.facet_ids,
      assembly_id: null,
      source: e.source as TopologyEdge['source'],
      confidence: e.confidence.final_confidence,
      classification_evidence: evidence,
      provisional: false,
      provisional_reason: null,
      provisional_support_score: 0,
      provisional_expiry_stage: null,
      provisional_retain_reason: null,
      provisional_release_reason: null,
      refinement_round: 0,
      refinement_origin_edge_ids: [],
    };
  });

  // Convert solver faces → TopologyFace
  const topoFaces: TopologyFace[] = solverResult.faces.map(f => ({
    id: f.id,
    label: f.label,
    polygon_geo: f.polygon,
    polygon_px: dsm_grid ? f.polygon.map(p => geoToPx(p, dsm_grid)) : f.polygon.map(() => ({ x: 0, y: 0 })),
    plan_area_sqft: f.plan_area_sqft,
    roof_area_sqft: f.roof_area_sqft,
    pitch_degrees: f.pitch_degrees,
    azimuth_degrees: f.azimuth_degrees,
    edge_ids: f.edge_ids,
    assembly_id: null,
    plane_rms: f.plane_rms ?? null,
    plane_normal: null,
    downslope_vector: null,
    plane_slope_x: null,
    plane_slope_y: null,
    provisional: f.provisional || false,
    provisional_reason: f.provisional ? 'marginal_plane_rms' : null,
    plane_fit_quality: f.provisional ? 'marginal' : (f.plane_rms != null ? 'strict' : 'no_dsm'),
    face_seed_type: 'planar_cycle',
    refinement_round: 0,
    refinement_origin_face_ids: [],
  }));

  // Detect assemblies
  const assemblies = detectAssemblies(
    topoEdges, topoFaces,
    footprint_geo, footprint_px,
    solar_segments, dsm_grid,
  );

  // Compute solar priors
  const solarPriors = computeSolarPriors(solar_segments, footprint_area_sqft);

  // Build solar segment priors
  const solarSegmentPriors: SolarSegmentPrior[] = solar_segments.map((seg, i) => ({
    index: i,
    pitch_degrees: seg.pitch_degrees,
    azimuth_degrees: seg.azimuth_degrees,
    area_sqft: seg.area_sqft,
    center_geo: seg.center_geo,
    matched_assembly_id: null,
    matched_face_id: null,
    match_score: 0,
  }));

  // Build refinement history
  const refinementHistory: RefinementRound[] = [];
  const refDiag = refinement_diagnostics as Record<string, any>;
  if (refDiag?.refinement_attempted) {
    refinementHistory.push({
      round: 1,
      trigger: 'undersegmented',
      edges_reintroduced: refDiag.raw_edges_reintroduced || 0,
      faces_before: refDiag.faces_before_refinement || 0,
      faces_after: refDiag.faces_after_refinement || 0,
      accepted: refDiag.refinement_accepted || false,
      reason: refDiag.rejection_reason || 'accepted',
    });
  }

  // Compute topology metrics
  const ridgeEdges = topoEdges.filter(e => e.type === 'ridge');
  const valleyEdges = topoEdges.filter(e => e.type === 'valley');
  const hipEdges = topoEdges.filter(e => e.type === 'hip');
  const eaveEdges = topoEdges.filter(e => e.type === 'eave');
  const rakeEdges = topoEdges.filter(e => e.type === 'rake');
  const hasRidgeOrValley = (ridgeEdges.length > 0 || valleyEdges.length > 0) ||
    (topoFaces.length <= 2 && hipEdges.length > 0);

  const metrics: TopologyMetrics = {
    face_count: topoFaces.length,
    provisional_face_count: topoFaces.filter(f => f.provisional).length,
    strict_face_count: topoFaces.filter(f => !f.provisional).length,
    expected_min_faces: solarPriors.expected_min_faces,
    expected_face_reasoning: solarPriors.expected_face_reasoning,
    total_edge_count: topoEdges.length,
    ridge_count: ridgeEdges.length,
    valley_count: valleyEdges.length,
    hip_count: hipEdges.length,
    eave_count: eaveEdges.length,
    rake_count: rakeEdges.length,
    ridge_ft: ridgeEdges.reduce((s, e) => s + e.length_ft, 0),
    valley_ft: valleyEdges.reduce((s, e) => s + e.length_ft, 0),
    hip_ft: hipEdges.reduce((s, e) => s + e.length_ft, 0),
    eave_ft: eaveEdges.reduce((s, e) => s + e.length_ft, 0),
    rake_ft: rakeEdges.reduce((s, e) => s + e.length_ft, 0),
    coverage_ratio: coverageRatio,
    area_conservation_ratio: footprint_area_sqft > 0 ? topoFaces.reduce((s, f) => s + f.plan_area_sqft, 0) / footprint_area_sqft : 0,
    max_plane_area_ratio: maxPlaneAreaRatio,
    largest_plane_sqft: topoFaces.length > 0 ? Math.max(...topoFaces.map(f => f.plan_area_sqft)) : 0,
    assembly_count: assemblies.length,
    topology_fidelity_score: 0, // Will be computed by analyzeTopologyFidelity
    topology_fidelity: 'medium',
    ridge_valley_presence_pass: hasRidgeOrValley,
    provisional_edges_total: topoEdges.filter(e => e.provisional).length,
    provisional_edges_retained: 0,
    provisional_edges_released: 0,
    customer_report_ready: !customerBlockReason,
    customer_report_block_reason: customerBlockReason,
  };

  return {
    version: 'topology-v1',
    created_at: now,
    nodes,
    edges: topoEdges,
    faces: topoFaces,
    assemblies,
    topology_source: 'autonomous_dsm_graph_solver',
    coordinate_space_solver: 'dsm_px',
    coordinate_space_export: 'geo',
    footprint_geo,
    footprint_px,
    footprint_area_sqft,
    solar_segment_priors: solarSegmentPriors,
    metrics,
    refinement_rounds_applied: refinementHistory.filter(r => r.accepted).length,
    refinement_history: refinementHistory,
  };
}

// Helper to convert geo to pixel using DSM grid
function geoToPx(geo: XY, dsmGrid: any): PxPt {
  if (!dsmGrid || !dsmGrid.bounds) return { x: 0, y: 0 };
  const { bounds, width, height } = dsmGrid;
  const x = (geo[0] - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width;
  const y = (bounds.maxLat - geo[1]) / (bounds.maxLat - bounds.minLat) * height;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Extract a compact serializable summary from the hierarchy for persistence.
 * This goes into geometry_report_json.topology_hierarchy.
 */
export function serializeHierarchySummary(hierarchy: RoofTopologyHierarchy): Record<string, unknown> {
  return {
    version: hierarchy.version,
    created_at: hierarchy.created_at,
    node_count: hierarchy.nodes.length,
    edge_count: hierarchy.edges.length,
    face_count: hierarchy.faces.length,
    assembly_count: hierarchy.assemblies.length,

    // Assembly table
    assembly_table: hierarchy.assemblies.map(a => ({
      id: a.id,
      type: a.type,
      level: a.level,
      parent_id: a.parent_id,
      face_count: a.face_ids.length,
      edge_count: a.edge_ids.length,
      detection_method: a.evidence.detection_method,
      confidence: a.confidence,
    })),

    // Edge lineage table (first 30 for log size)
    edge_lineage_table: hierarchy.edges.slice(0, 30).map(e => ({
      id: e.id,
      type: e.type,
      length_ft: Number(e.length_ft.toFixed(1)),
      assembly_id: e.assembly_id,
      adjacent_faces: e.classification_evidence.adjacent_face_count,
      left_face: e.classification_evidence.left_face_id,
      right_face: e.classification_evidence.right_face_id,
      convexity: e.classification_evidence.convexity_sign,
      method: e.classification_evidence.classification_method,
      confidence: Number(e.confidence.toFixed(3)),
      provisional: e.provisional,
      tier: e.classification_evidence.structural_tier,
      refinement_round: e.refinement_round,
    })),

    // Face lineage table
    face_lineage_table: hierarchy.faces.map(f => ({
      id: f.id,
      label: f.label,
      area_sqft: Number(f.plan_area_sqft.toFixed(1)),
      pitch_deg: Number(f.pitch_degrees.toFixed(1)),
      assembly_id: f.assembly_id,
      provisional: f.provisional,
      plane_rms: f.plane_rms != null ? Number(f.plane_rms.toFixed(3)) : null,
      plane_fit_quality: f.plane_fit_quality,
      seed_type: f.face_seed_type,
      refinement_round: f.refinement_round,
    })),

    // Solar prior match table
    solar_prior_table: hierarchy.solar_segment_priors.map(sp => ({
      index: sp.index,
      pitch: sp.pitch_degrees,
      azimuth: sp.azimuth_degrees,
      area_sqft: Number(sp.area_sqft.toFixed(1)),
      matched_face: sp.matched_face_id,
      match_score: sp.match_score,
    })),

    // Metrics summary
    metrics: hierarchy.metrics,

    // Refinement history
    refinement_history: hierarchy.refinement_history,
  };
}
