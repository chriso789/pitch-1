export type ResolvedAerialCandidateGraph = {
  present: boolean;
  executed: boolean;
  edgeCount: number;
  source: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function getEdgeCount(candidate: unknown): number | null {
  if (!isRecord(candidate)) return null;

  const edges = candidate.edges;
  if (Array.isArray(edges)) return edges.length;

  const faces = candidate.candidate_faces;
  if (Array.isArray(faces)) return faces.length;

  const edgeCount = candidate.edge_count;
  if (typeof edgeCount === "number" && Number.isFinite(edgeCount)) return edgeCount;

  const edgesCount = candidate.edges_count;
  if (typeof edgesCount === "number" && Number.isFinite(edgesCount)) return edgesCount;

  return null;
}

const SOURCES: { key: string; path: string[] }[] = [
  { key: "root", path: ["aerial_candidate_roof_graph"] },
  { key: "debug_layers", path: ["debug_layers", "aerial_candidate_roof_graph"] },
  { key: "dsm_planar_graph_debug", path: ["dsm_planar_graph_debug", "aerial_candidate_roof_graph"] },
  { key: "terminal_preempt", path: ["terminal_debug_payload", "pre_phase3_5_preempt", "aerial_candidate_roof_graph"] },
  { key: "terminal_root", path: ["terminal_debug_payload", "aerial_candidate_roof_graph"] },
];

export function resolveAerialCandidateGraph(grj: unknown): ResolvedAerialCandidateGraph {
  let present = false;
  let executed = false;
  let bestCount = 0;
  let bestSource: string | null = null;
  let hasAnyCount = false;

  for (const source of SOURCES) {
    const graph = getPath(grj, source.path);
    if (!isRecord(graph)) continue;

    present = true;
    if (graph.executed === true) executed = true;

    const count = getEdgeCount(graph);
    if (count === null) continue;

    if (!hasAnyCount || count > bestCount) {
      bestCount = count;
      bestSource = source.key;
      hasAnyCount = true;
    }
  }

  return {
    present,
    executed,
    edgeCount: hasAnyCount ? bestCount : 0,
    source: bestSource,
  };
}
