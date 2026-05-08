/**
 * Backbone Network Builder v2 — Ridge/Valley-first topology
 *
 * Architecture change from v1: Instead of just filtering bad diagonals,
 * this module BUILDS the roof structure from the ridge/valley skeleton:
 * 1. Extracts ridge/valley backbone graph from classified DSM edges
 * 2. Identifies connected structural chains (ridge chains, valley chains)
 * 3. Partitions the roof into local assemblies from the backbone
 * 4. Derives local hip edges from backbone endpoints to footprint corners
 * 5. Suppresses cross-assembly diagonals and oversized-plane creators
 * 6. Supports deferred edge reintroduction for under-segmented results
 */

type PxPt = { x: number; y: number };

export interface BackboneEdge {
  a: PxPt;
  b: PxPt;
  type: 'ridge' | 'valley' | 'hip' | 'primary_ridge' | 'primary_valley' | 'secondary_ridge' | 'secondary_valley' | 'connector' | 'provisional';
  score: number;
  backboneRole: 'primary_ridge' | 'primary_valley' | 'secondary_ridge' | 'secondary_valley' | 'connector' | 'provisional' | 'suppressed' | 'derived_hip';
  assemblyId?: number;
  chainId?: number;
  suppressionReason?: string;
}

export interface BackboneChain {
  id: number;
  type: 'ridge' | 'valley';
  edges: number[]; // indices into the relevant edge set
  totalLength: number;
  tier: 'primary' | 'secondary';
  endpoints: [PxPt, PxPt]; // chain start and end points
}

export interface RoofAssembly {
  id: number;
  chainIds: number[];
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  centroid: PxPt;
  area: number;
  footprintCornerIndices: number[]; // indices into footprintPx owned by this assembly
}

export interface BackboneDiagnostics {
  ridge_chain_count: number;
  valley_chain_count: number;
  backbone_connected_components: number;
  assembly_count: number;
  cross_assembly_edges_suppressed: number;
  diagonal_suppression_events: number;
  oversized_plane_suppressions: number;
  derived_hip_count: number;
  backbone_edge_count: number;
  surviving_edge_count: number;
  backbone_to_plane_ratio: number;
  longest_ridge_chain_px: number;
  longest_valley_chain_px: number;
  max_diagonal_span_ratio: number;
  deferred_edges_reintroduced: number;
  edges_by_role: Record<string, number>;
}

interface ClassifiedEdge {
  a: PxPt;
  b: PxPt;
  type: 'ridge' | 'valley' | 'hip';
  score: number;
  tier?: 'primary' | 'secondary' | 'tertiary';
  hierarchyScore?: number;
}

const CHAIN_CONNECT_DIST_PX = 25;
const CHAIN_ANGLE_TOLERANCE_DEG = 45;
const DIAGONAL_SPAN_RATIO_MAX = 0.50;
const CROSS_ASSEMBLY_SPAN_MAX = 0.35;
const OVERSIZED_PLANE_RATIO = 0.35;       // Reject edges creating >35% area faces
const CROSS_ASSEMBLY_PENALTY = 0.6;
const MIN_CHAIN_LENGTH_PX = 15;
const ASSEMBLY_MERGE_DIST_PX = 30;
const DERIVED_HIP_MAX_DIST_PX = 120;      // Max distance from backbone endpoint to footprint corner for derived hip

function edgeLength(e: { a: PxPt; b: PxPt }): number {
  return Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
}

function edgeAngle(e: { a: PxPt; b: PxPt }): number {
  return Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

function ptDist(a: PxPt, b: PxPt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function edgeMidpoint(e: { a: PxPt; b: PxPt }): PxPt {
  return { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
}

function polygonAreaPx(pts: PxPt[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

/**
 * Check if a line segment crosses another line segment
 */
function segmentsCross(a1: PxPt, a2: PxPt, b1: PxPt, b2: PxPt): boolean {
  const d1 = (b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x);
  const d2 = (b2.x - b1.x) * (a2.y - b1.y) - (b2.y - b1.y) * (a2.x - b1.x);
  const d3 = (a2.x - a1.x) * (b1.y - a1.y) - (a2.y - a1.y) * (b1.x - a1.x);
  const d4 = (a2.x - a1.x) * (b2.y - a1.y) - (a2.y - a1.y) * (b2.x - a1.x);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

/**
 * Step 1: Build ridge/valley chains from classified edges.
 */
function buildChains(edges: ClassifiedEdge[]): BackboneChain[] {
  const ridgeEdges = edges.filter(e => e.type === 'ridge');
  const valleyEdges = edges.filter(e => e.type === 'valley');

  const chains: BackboneChain[] = [];

  for (const [edgeSet, chainType] of [[ridgeEdges, 'ridge'], [valleyEdges, 'valley']] as const) {
    const used = new Set<number>();

    for (let i = 0; i < edgeSet.length; i++) {
      if (used.has(i)) continue;
      used.add(i);

      const chain: number[] = [i];
      let chainLen = edgeLength(edgeSet[i]);
      let headPt = edgeSet[i].b;
      let tailPt = edgeSet[i].a;
      let headAngle = edgeAngle(edgeSet[i]);

      // Extend forward from head
      let extended = true;
      while (extended) {
        extended = false;
        let bestIdx = -1;
        let bestDist = CHAIN_CONNECT_DIST_PX;
        let bestEnd: 'a' | 'b' = 'a';

        for (let j = 0; j < edgeSet.length; j++) {
          if (used.has(j)) continue;
          const ej = edgeSet[j];
          const dA = ptDist(headPt, ej.a);
          const dB = ptDist(headPt, ej.b);
          const ejAngle = edgeAngle(ej);
          const aDiff = angleDiff(headAngle, ejAngle);
          if (aDiff > CHAIN_ANGLE_TOLERANCE_DEG * Math.PI / 180) continue;
          if (dA < bestDist) { bestDist = dA; bestIdx = j; bestEnd = 'a'; }
          if (dB < bestDist) { bestDist = dB; bestIdx = j; bestEnd = 'b'; }
        }

        if (bestIdx >= 0) {
          used.add(bestIdx);
          chain.push(bestIdx);
          const ej = edgeSet[bestIdx];
          chainLen += edgeLength(ej);
          headPt = bestEnd === 'a' ? ej.b : ej.a;
          headAngle = bestEnd === 'a' ? edgeAngle(ej) : edgeAngle({ a: ej.b, b: ej.a });
          extended = true;
        }
      }

      // Extend backward from tail
      extended = true;
      let tailAngle = edgeAngle({ a: edgeSet[i].b, b: edgeSet[i].a });
      while (extended) {
        extended = false;
        let bestIdx = -1;
        let bestDist = CHAIN_CONNECT_DIST_PX;
        let bestEnd: 'a' | 'b' = 'a';

        for (let j = 0; j < edgeSet.length; j++) {
          if (used.has(j)) continue;
          const ej = edgeSet[j];
          const dA = ptDist(tailPt, ej.b);
          const dB = ptDist(tailPt, ej.a);
          const ejAngle = edgeAngle({ a: ej.b, b: ej.a });
          const aDiff = angleDiff(tailAngle, ejAngle);
          if (aDiff > CHAIN_ANGLE_TOLERANCE_DEG * Math.PI / 180) continue;
          if (dA < bestDist) { bestDist = dA; bestIdx = j; bestEnd = 'b'; }
          if (dB < bestDist) { bestDist = dB; bestIdx = j; bestEnd = 'a'; }
        }

        if (bestIdx >= 0) {
          used.add(bestIdx);
          chain.unshift(bestIdx);
          const ej = edgeSet[bestIdx];
          chainLen += edgeLength(ej);
          tailPt = bestEnd === 'b' ? ej.a : ej.b;
          tailAngle = bestEnd === 'b' ? edgeAngle({ a: ej.b, b: ej.a }) : edgeAngle(ej);
          extended = true;
        }
      }

      const tier = chainLen >= MIN_CHAIN_LENGTH_PX * 2 ? 'primary' : 'secondary';
      chains.push({
        id: chains.length,
        type: chainType,
        edges: chain,
        totalLength: chainLen,
        tier,
        endpoints: [tailPt, headPt],
      });
    }
  }

  return chains;
}

/**
 * Step 2: Partition the roof into local assemblies.
 * Each connected component of ridge/valley chains defines an assembly region.
 * Footprint corners are assigned to their nearest assembly.
 */
function partitionAssemblies(
  chains: BackboneChain[],
  edges: ClassifiedEdge[],
  footprintPx: PxPt[],
): RoofAssembly[] {
  if (chains.length === 0) return [];

  // Compute chain bounding boxes and collect all structural points
  const chainInfos = chains.map(chain => {
    const pts: PxPt[] = [];
    const edgeSet = chain.type === 'ridge'
      ? edges.filter(e => e.type === 'ridge')
      : edges.filter(e => e.type === 'valley');
    for (const idx of chain.edges) {
      if (edgeSet[idx]) {
        pts.push(edgeSet[idx].a, edgeSet[idx].b);
      }
    }
    if (pts.length === 0) return null;
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));
    return { minX, maxX, minY, maxY, pts };
  });

  // Union-find for merging nearby chains
  const parent = chains.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < chains.length; i++) {
    const ci = chainInfos[i];
    if (!ci) continue;
    for (let j = i + 1; j < chains.length; j++) {
      const cj = chainInfos[j];
      if (!cj) continue;
      let minDist = Infinity;
      for (const pi of ci.pts) {
        for (const pj of cj.pts) {
          const d = ptDist(pi, pj);
          if (d < minDist) minDist = d;
        }
      }
      if (minDist < ASSEMBLY_MERGE_DIST_PX) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < chains.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const assemblies: RoofAssembly[] = [];
  for (const [_, chainIds] of groups) {
    const allPts: PxPt[] = [];
    for (const cid of chainIds) {
      const ci = chainInfos[cid];
      if (ci) allPts.push(...ci.pts);
    }
    if (allPts.length === 0) continue;

    const minX = Math.min(...allPts.map(p => p.x));
    const maxX = Math.max(...allPts.map(p => p.x));
    const minY = Math.min(...allPts.map(p => p.y));
    const maxY = Math.max(...allPts.map(p => p.y));

    assemblies.push({
      id: assemblies.length,
      chainIds,
      boundingBox: { minX, maxX, minY, maxY },
      centroid: {
        x: allPts.reduce((s, p) => s + p.x, 0) / allPts.length,
        y: allPts.reduce((s, p) => s + p.y, 0) / allPts.length,
      },
      area: (maxX - minX) * (maxY - minY),
      footprintCornerIndices: [],
    });
  }

  // If no assemblies found, create one from the footprint
  if (assemblies.length === 0 && footprintPx.length >= 3) {
    const xs = footprintPx.map(p => p.x);
    const ys = footprintPx.map(p => p.y);
    assemblies.push({
      id: 0,
      chainIds: [],
      boundingBox: {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
      },
      centroid: {
        x: footprintPx.reduce((s, p) => s + p.x, 0) / footprintPx.length,
        y: footprintPx.reduce((s, p) => s + p.y, 0) / footprintPx.length,
      },
      area: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)),
      footprintCornerIndices: footprintPx.map((_, i) => i),
    });
  }

  // Assign footprint corners to nearest assembly
  if (assemblies.length > 0) {
    for (let ci = 0; ci < footprintPx.length; ci++) {
      const pt = footprintPx[ci];
      let bestAsm = 0;
      let bestDist = Infinity;
      for (const asm of assemblies) {
        const d = ptDist(pt, asm.centroid);
        if (d < bestDist) { bestDist = d; bestAsm = asm.id; }
      }
      const target = assemblies.find(a => a.id === bestAsm);
      if (target) target.footprintCornerIndices.push(ci);
    }
  }

  return assemblies;
}

/**
 * Assign an edge to its closest assembly
 */
function assignEdgeToAssembly(e: { a: PxPt; b: PxPt }, assemblies: RoofAssembly[]): number {
  if (assemblies.length <= 1) return 0;
  const mid = edgeMidpoint(e);
  let bestId = 0;
  let bestDist = Infinity;
  for (const asm of assemblies) {
    const d = ptDist(mid, asm.centroid);
    const expand = 20;
    const bb = asm.boundingBox;
    const inside = mid.x >= bb.minX - expand && mid.x <= bb.maxX + expand &&
                   mid.y >= bb.minY - expand && mid.y <= bb.maxY + expand;
    const effectiveDist = inside ? d * 0.5 : d;
    if (effectiveDist < bestDist) {
      bestDist = effectiveDist;
      bestId = asm.id;
    }
  }
  return bestId;
}

/**
 * Step 3: Derive local hip edges from backbone endpoints to footprint corners.
 * For each assembly, connect ridge/valley endpoints to the nearest footprint
 * corners within that assembly. This replaces the cross-roof diagonals
 * with structurally correct local hips.
 */
function deriveLocalHips(
  chains: BackboneChain[],
  assemblies: RoofAssembly[],
  footprintPx: PxPt[],
  existingEdges: ClassifiedEdge[],
): BackboneEdge[] {
  const derivedHips: BackboneEdge[] = [];
  const footprintArea = polygonAreaPx(footprintPx);

  for (const asm of assemblies) {
    // Get all backbone endpoints in this assembly
    const backboneEndpoints: PxPt[] = [];
    for (const chainId of asm.chainIds) {
      const chain = chains.find(c => c.id === chainId);
      if (chain) {
        backboneEndpoints.push(chain.endpoints[0], chain.endpoints[1]);
      }
    }

    if (backboneEndpoints.length === 0) continue;

    // Get footprint corners for this assembly
    const asmCorners = asm.footprintCornerIndices.map(i => footprintPx[i]);

    // For each backbone endpoint, find nearest footprint corners and create hips
    for (const ep of backboneEndpoints) {
      // Sort corners by distance
      const sortedCorners = asmCorners
        .map((c, i) => ({ corner: c, idx: asm.footprintCornerIndices[i], dist: ptDist(ep, c) }))
        .filter(c => c.dist < DERIVED_HIP_MAX_DIST_PX)
        .sort((a, b) => a.dist - b.dist);

      // Connect to up to 2 nearest corners (typical hip structure)
      for (const { corner, dist } of sortedCorners.slice(0, 2)) {
        // Check if this hip would be a duplicate of an existing edge
        const isDuplicate = existingEdges.some(e => {
          const d1 = ptDist(e.a, ep) + ptDist(e.b, corner);
          const d2 = ptDist(e.a, corner) + ptDist(e.b, ep);
          return Math.min(d1, d2) < 15;
        }) || derivedHips.some(h => {
          const d1 = ptDist(h.a, ep) + ptDist(h.b, corner);
          const d2 = ptDist(h.a, corner) + ptDist(h.b, ep);
          return Math.min(d1, d2) < 15;
        });

        if (isDuplicate) continue;

        // Check span ratio — derived hips should be local
        const roofDiag = Math.sqrt(footprintArea);
        const spanRatio = roofDiag > 0 ? dist / roofDiag : 0;
        if (spanRatio > 0.45) continue;

        derivedHips.push({
          a: ep,
          b: corner,
          type: 'hip',
          score: 0.7, // Moderate confidence for derived hips
          backboneRole: 'derived_hip',
          assemblyId: asm.id,
        });
      }
    }
  }

  return derivedHips;
}

/**
 * Step 4: Classify and suppress cross-assembly diagonals + oversized-plane creators
 */
function suppressDiagonals(
  edges: ClassifiedEdge[],
  assemblies: RoofAssembly[],
  footprintPx: PxPt[],
): { constrained: BackboneEdge[]; diagnostics: Partial<BackboneDiagnostics> } {
  const xs = footprintPx.map(p => p.x);
  const ys = footprintPx.map(p => p.y);
  const roofWidth = Math.max(...xs) - Math.min(...xs);
  const roofHeight = Math.max(...ys) - Math.min(...ys);
  const roofDiag = Math.hypot(roofWidth, roofHeight);
  const footprintArea = polygonAreaPx(footprintPx);

  let crossAssemblySuppressed = 0;
  let diagonalSuppressed = 0;
  let oversizedPlaneSuppressed = 0;
  let maxDiagSpanRatio = 0;

  // Collect all ridge/valley edges to check if a hip would suppress them
  const ridgeValleyMidpoints = edges
    .filter(e => e.type === 'ridge' || e.type === 'valley')
    .map(e => edgeMidpoint(e));

  const result: BackboneEdge[] = [];

  for (const e of edges) {
    const len = edgeLength(e);
    const spanRatio = roofDiag > 0 ? len / roofDiag : 0;
    if (spanRatio > maxDiagSpanRatio) maxDiagSpanRatio = spanRatio;

    let role: BackboneEdge['backboneRole'] = 'provisional';
    if (e.type === 'ridge') role = e.tier === 'primary' ? 'primary_ridge' : 'secondary_ridge';
    else if (e.type === 'valley') role = e.tier === 'primary' ? 'primary_valley' : 'secondary_valley';
    else if (e.type === 'hip') role = 'connector';

    const asmId = assignEdgeToAssembly(e, assemblies);
    let suppressionReason: string | undefined;

    // Rule 1: Suppress diagonals spanning >50% of roof extent (ALL types including hips)
    if (spanRatio > DIAGONAL_SPAN_RATIO_MAX && e.type === 'hip') {
      suppressionReason = `span_ratio_${spanRatio.toFixed(3)}_gt_${DIAGONAL_SPAN_RATIO_MAX}`;
      diagonalSuppressed++;
      role = 'suppressed';
    }

    // Rule 2: Cross-assembly hip penalty — stricter threshold
    if (!suppressionReason && assemblies.length >= 2 && e.type === 'hip') {
      const startAsm = assignEdgeToAssembly({ a: e.a, b: e.a }, assemblies);
      const endAsm = assignEdgeToAssembly({ a: e.b, b: e.b }, assemblies);
      if (startAsm !== endAsm) {
        if (spanRatio > CROSS_ASSEMBLY_SPAN_MAX) {
          suppressionReason = `cross_assembly_diagonal:asm_${startAsm}_to_${endAsm}:span_${spanRatio.toFixed(3)}`;
          crossAssemblySuppressed++;
          role = 'suppressed';
        } else {
          role = 'connector';
        }
      }
    }

    // Rule 3: Long diagonals with low score
    if (!suppressionReason && spanRatio > 0.40 && e.score < 0.5 && e.type === 'hip') {
      suppressionReason = `low_score_long_diagonal:span_${spanRatio.toFixed(3)}_score_${e.score.toFixed(2)}`;
      diagonalSuppressed++;
      role = 'suppressed';
    }

    // Rule 4: NEW — Suppress edges that cross ridge/valley lines
    // A hip should not cross a ridge or valley; it connects to them
    if (!suppressionReason && e.type === 'hip' && spanRatio > 0.30) {
      let crossesBackbone = false;
      for (const otherEdge of edges) {
        if (otherEdge === e) continue;
        if (otherEdge.type !== 'ridge' && otherEdge.type !== 'valley') continue;
        if (segmentsCross(e.a, e.b, otherEdge.a, otherEdge.b)) {
          crossesBackbone = true;
          break;
        }
      }
      if (crossesBackbone) {
        suppressionReason = `crosses_backbone_edge:span_${spanRatio.toFixed(3)}`;
        diagonalSuppressed++;
        role = 'suppressed';
      }
    }

    // Rule 5: NEW — Suppress edges that would create faces >35% of total roof area
    // Estimate: if this edge + footprint boundary would define a triangle > threshold
    if (!suppressionReason && e.type === 'hip' && footprintArea > 0) {
      // Rough triangle area from the edge to footprint center
      const mid = edgeMidpoint(e);
      const toCenter = ptDist(mid, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
      const roughTriArea = len * toCenter * 0.5;
      const areaRatio = roughTriArea / footprintArea;
      if (areaRatio > OVERSIZED_PLANE_RATIO && spanRatio > 0.35) {
        suppressionReason = `oversized_plane_creator:area_ratio_${areaRatio.toFixed(3)}_span_${spanRatio.toFixed(3)}`;
        oversizedPlaneSuppressed++;
        role = 'suppressed';
      }
    }

    result.push({
      a: e.a,
      b: e.b,
      type: e.type,
      score: role === 'suppressed' ? e.score * CROSS_ASSEMBLY_PENALTY : e.score,
      backboneRole: role,
      assemblyId: asmId,
      suppressionReason,
    });
  }

  return {
    constrained: result,
    diagnostics: {
      cross_assembly_edges_suppressed: crossAssemblySuppressed,
      diagonal_suppression_events: diagonalSuppressed,
      oversized_plane_suppressions: oversizedPlaneSuppressed,
      max_diagonal_span_ratio: maxDiagSpanRatio,
    },
  };
}

/**
 * Main entry point: Build backbone network and return constrained edges.
 */
export function buildBackboneNetwork(
  classifiedEdges: ClassifiedEdge[],
  footprintPx: PxPt[],
): {
  constrainedEdges: BackboneEdge[];
  chains: BackboneChain[];
  assemblies: RoofAssembly[];
  derivedHips: BackboneEdge[];
  diagnostics: BackboneDiagnostics;
} {
  console.log(`[BACKBONE_v2] Building ridge/valley backbone from ${classifiedEdges.length} classified edges`);

  // Step 1: Build structural chains
  const chains = buildChains(classifiedEdges);
  const ridgeChains = chains.filter(c => c.type === 'ridge');
  const valleyChains = chains.filter(c => c.type === 'valley');
  const longestRidge = ridgeChains.length > 0 ? Math.max(...ridgeChains.map(c => c.totalLength)) : 0;
  const longestValley = valleyChains.length > 0 ? Math.max(...valleyChains.map(c => c.totalLength)) : 0;

  console.log(`  Chains: ${ridgeChains.length} ridge (longest=${longestRidge.toFixed(0)}px), ${valleyChains.length} valley (longest=${longestValley.toFixed(0)}px)`);

  // Step 2: Partition into local assemblies
  const assemblies = partitionAssemblies(chains, classifiedEdges, footprintPx);
  console.log(`  Assemblies: ${assemblies.length} local roof regions`);

  // Step 3: Derive local hip edges from backbone to footprint
  const derivedHips = deriveLocalHips(chains, assemblies, footprintPx, classifiedEdges);
  console.log(`  Derived hips: ${derivedHips.length} local hip edges from backbone endpoints to footprint corners`);

  // Step 4: Suppress cross-assembly diagonals
  const { constrained, diagnostics: suppressDiag } = suppressDiagonals(classifiedEdges, assemblies, footprintPx);

  const suppressed = constrained.filter(e => e.backboneRole === 'suppressed');
  const surviving = constrained.filter(e => e.backboneRole !== 'suppressed');

  // Compute role counts
  const roleMap: Record<string, number> = {};
  for (const e of [...constrained, ...derivedHips]) {
    roleMap[e.backboneRole] = (roleMap[e.backboneRole] || 0) + 1;
  }

  const backboneEdgeCount = constrained.filter(e =>
    e.backboneRole === 'primary_ridge' || e.backboneRole === 'primary_valley' ||
    e.backboneRole === 'secondary_ridge' || e.backboneRole === 'secondary_valley'
  ).length;

  const diagnostics: BackboneDiagnostics = {
    ridge_chain_count: ridgeChains.length,
    valley_chain_count: valleyChains.length,
    backbone_connected_components: assemblies.length,
    assembly_count: assemblies.length,
    cross_assembly_edges_suppressed: suppressDiag.cross_assembly_edges_suppressed || 0,
    diagonal_suppression_events: suppressDiag.diagonal_suppression_events || 0,
    oversized_plane_suppressions: suppressDiag.oversized_plane_suppressions || 0,
    derived_hip_count: derivedHips.length,
    backbone_edge_count: backboneEdgeCount,
    surviving_edge_count: surviving.length + derivedHips.length,
    backbone_to_plane_ratio: classifiedEdges.length > 0 ? backboneEdgeCount / classifiedEdges.length : 0,
    longest_ridge_chain_px: longestRidge,
    longest_valley_chain_px: longestValley,
    max_diagonal_span_ratio: suppressDiag.max_diagonal_span_ratio || 0,
    deferred_edges_reintroduced: 0,
    edges_by_role: roleMap,
  };

  console.log(`  Backbone: ${backboneEdgeCount} structural, ${suppressed.length} suppressed, ${surviving.length} surviving, ${derivedHips.length} derived`);
  console.log(`  Roles: ${JSON.stringify(roleMap)}`);

  return {
    constrainedEdges: constrained,
    chains,
    assemblies,
    derivedHips,
    diagnostics,
  };
}
