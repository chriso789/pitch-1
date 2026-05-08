/**
 * Backbone Network Builder — Ridge/Valley-first topology
 *
 * Instead of deriving topology from planes, this module:
 * 1. Extracts a ridge/valley backbone graph from classified DSM edges
 * 2. Identifies connected structural chains (ridge chains, valley chains)
 * 3. Partitions the roof into local assemblies from the backbone
 * 4. Suppresses cross-assembly diagonals
 * 5. Returns backbone-constrained edges for the planar solver
 */

type PxPt = { x: number; y: number };

export interface BackboneEdge {
  a: PxPt;
  b: PxPt;
  type: 'ridge' | 'valley' | 'hip' | 'primary_ridge' | 'primary_valley' | 'secondary_ridge' | 'secondary_valley' | 'connector' | 'provisional';
  score: number;
  backboneRole: 'primary_ridge' | 'primary_valley' | 'secondary_ridge' | 'secondary_valley' | 'connector' | 'provisional' | 'suppressed';
  assemblyId?: number;
  chainId?: number;
  suppressionReason?: string;
}

export interface BackboneChain {
  id: number;
  type: 'ridge' | 'valley';
  edges: number[]; // indices into backbone edges
  totalLength: number;
  tier: 'primary' | 'secondary';
}

export interface RoofAssembly {
  id: number;
  chainIds: number[];
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  centroid: PxPt;
  area: number; // approximate from bbox
}

export interface BackboneDiagnostics {
  ridge_chain_count: number;
  valley_chain_count: number;
  backbone_connected_components: number;
  assembly_count: number;
  cross_assembly_edges_suppressed: number;
  diagonal_suppression_events: number;
  backbone_edge_count: number;
  surviving_edge_count: number;
  backbone_to_plane_ratio: number;
  longest_ridge_chain_px: number;
  longest_valley_chain_px: number;
  max_diagonal_span_ratio: number;
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

const CHAIN_CONNECT_DIST_PX = 25;       // Max distance to connect two edges into a chain
const CHAIN_ANGLE_TOLERANCE_DEG = 45;    // Max angle deviation for chain continuation
const DIAGONAL_SPAN_RATIO_MAX = 0.50;   // Reject diagonals spanning >50% of roof width
const CROSS_ASSEMBLY_PENALTY = 0.6;      // Score multiplier for cross-assembly edges
const MIN_CHAIN_LENGTH_PX = 15;          // Minimum chain length to be considered structural
const ASSEMBLY_MERGE_DIST_PX = 30;       // Assemblies closer than this merge

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

/**
 * Step 1: Build ridge/valley chains from classified edges.
 * A chain is a sequence of edges with compatible type and direction
 * that connect end-to-end within tolerance.
 */
function buildChains(edges: ClassifiedEdge[]): BackboneChain[] {
  // Separate ridge-type and valley-type edges
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

          // Check angle compatibility
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

      // Single unchained edges still form length-1 chains
      const tier = chainLen >= MIN_CHAIN_LENGTH_PX * 2 ? 'primary' : 'secondary';
      chains.push({
        id: chains.length,
        type: chainType,
        edges: chain,
        totalLength: chainLen,
        tier,
      });
    }
  }

  return chains;
}

/**
 * Step 2: Partition the roof into local assemblies using backbone chains.
 * Each connected component of ridge/valley chains defines an assembly region.
 */
function partitionAssemblies(
  chains: BackboneChain[],
  edges: ClassifiedEdge[],
  footprintPx: PxPt[],
): RoofAssembly[] {
  if (chains.length === 0) return [];

  // Compute chain bounding boxes and centroids
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
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { minX, maxX, minY, maxY, cx, cy, pts };
  });

  // Union-find for merging nearby chains into assemblies
  const parent = chains.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Merge chains whose endpoints are close
  for (let i = 0; i < chains.length; i++) {
    const ci = chainInfos[i];
    if (!ci) continue;
    for (let j = i + 1; j < chains.length; j++) {
      const cj = chainInfos[j];
      if (!cj) continue;

      // Check if any endpoint of chain i is near any endpoint of chain j
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

  // Collect assemblies from union-find groups
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
    });
  }

  return assemblies;
}

/**
 * Assign an edge to its closest assembly based on midpoint proximity
 */
function assignEdgeToAssembly(e: { a: PxPt; b: PxPt }, assemblies: RoofAssembly[]): number {
  if (assemblies.length <= 1) return 0;

  const mid = edgeMidpoint(e);
  let bestId = 0;
  let bestDist = Infinity;

  for (const asm of assemblies) {
    // Distance from midpoint to assembly bbox center
    const d = ptDist(mid, asm.centroid);
    // Also check if midpoint is inside assembly bbox (expanded)
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
 * Step 3: Classify and suppress cross-assembly diagonals
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

  let crossAssemblySuppressed = 0;
  let diagonalSuppressed = 0;
  let maxDiagSpanRatio = 0;

  const result: BackboneEdge[] = [];

  for (const e of edges) {
    const len = edgeLength(e);
    const spanRatio = roofDiag > 0 ? len / roofDiag : 0;
    if (spanRatio > maxDiagSpanRatio) maxDiagSpanRatio = spanRatio;

    // Determine backbone role
    let role: BackboneEdge['backboneRole'] = 'provisional';
    if (e.type === 'ridge') role = e.tier === 'primary' ? 'primary_ridge' : 'secondary_ridge';
    else if (e.type === 'valley') role = e.tier === 'primary' ? 'primary_valley' : 'secondary_valley';
    else if (e.type === 'hip') role = 'connector';

    const asmId = assignEdgeToAssembly(e, assemblies);
    let suppressionReason: string | undefined;

    // Rule 1: Suppress diagonals spanning >50% of roof extent
    if (spanRatio > DIAGONAL_SPAN_RATIO_MAX && e.type !== 'ridge' && e.type !== 'valley') {
      // Only suppress non-backbone diagonals — ridges/valleys are structural
      suppressionReason = `span_ratio_${spanRatio.toFixed(3)}_gt_${DIAGONAL_SPAN_RATIO_MAX}`;
      diagonalSuppressed++;
      role = 'suppressed';
    }

    // Rule 2: Cross-assembly penalty for hip/connector edges
    if (!suppressionReason && assemblies.length >= 2 && e.type === 'hip') {
      const startAsm = assignEdgeToAssembly({ a: e.a, b: e.a }, assemblies);
      const endAsm = assignEdgeToAssembly({ a: e.b, b: e.b }, assemblies);
      if (startAsm !== endAsm) {
        // This edge spans two assemblies — penalize but don't always suppress
        if (spanRatio > 0.35) {
          suppressionReason = `cross_assembly_diagonal:asm_${startAsm}_to_${endAsm}:span_${spanRatio.toFixed(3)}`;
          crossAssemblySuppressed++;
          role = 'suppressed';
        } else {
          // Penalize score but keep
          role = 'connector';
        }
      }
    }

    // Rule 3: Long diagonals that are NOT ridges/valleys and have low score
    if (!suppressionReason && spanRatio > 0.40 && e.score < 0.5 && e.type === 'hip') {
      suppressionReason = `low_score_long_diagonal:span_${spanRatio.toFixed(3)}_score_${e.score.toFixed(2)}`;
      diagonalSuppressed++;
      role = 'suppressed';
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
  diagnostics: BackboneDiagnostics;
} {
  console.log(`[BACKBONE] Building ridge/valley backbone from ${classifiedEdges.length} classified edges`);

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

  // Step 3: Suppress cross-assembly diagonals
  const { constrained, diagnostics: suppressDiag } = suppressDiagonals(classifiedEdges, assemblies, footprintPx);

  const suppressed = constrained.filter(e => e.backboneRole === 'suppressed');
  const surviving = constrained.filter(e => e.backboneRole !== 'suppressed');

  // Compute role counts
  const roleMap: Record<string, number> = {};
  for (const e of constrained) {
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
    backbone_edge_count: backboneEdgeCount,
    surviving_edge_count: surviving.length,
    backbone_to_plane_ratio: classifiedEdges.length > 0 ? backboneEdgeCount / classifiedEdges.length : 0,
    longest_ridge_chain_px: longestRidge,
    longest_valley_chain_px: longestValley,
    max_diagonal_span_ratio: suppressDiag.max_diagonal_span_ratio || 0,
    edges_by_role: roleMap,
  };

  console.log(`  Backbone: ${backboneEdgeCount} structural edges, ${suppressed.length} suppressed, ${surviving.length} surviving`);
  console.log(`  Roles: ${JSON.stringify(roleMap)}`);

  return {
    constrainedEdges: constrained,
    chains,
    assemblies,
    diagnostics,
  };
}
