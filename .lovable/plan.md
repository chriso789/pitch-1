## Aerial Candidate Graph Diagnostic Fix (frontend-only)

The diagnostics row reads only two paths and treats object existence as success, so it shows "present (0 candidate edges)" even when a nested location has `executed=true` with 12 edges. Backend is correct and must not change.

### Files

**1. Add `src/lib/measurements/aerialCandidateGraphResolver.ts**`

Exports:

```ts
export type ResolvedAerialCandidateGraph = {
  present: boolean;
  executed: boolean;
  edgeCount: number;
  source: string | null;
};
export function resolveAerialCandidateGraph(grj: unknown): ResolvedAerialCandidateGraph;
```

Walks these source paths in order, keyed as shown:

- `root` → `aerial_candidate_roof_graph`
- `debug_layers` → `debug_layers.aerial_candidate_roof_graph`
- `dsm_planar_graph_debug` → `dsm_planar_graph_debug.aerial_candidate_roof_graph`
- `terminal_preempt` → `terminal_debug_payload.pre_phase3_5_preempt.aerial_candidate_roof_graph`
- `terminal_root` → `terminal_debug_payload.aerial_candidate_roof_graph`

For each found object: edge count comes from the first valid of `edges.length` → `candidate_faces.length` → numeric `edge_count` → numeric `edges_count`.

Aggregation:

- `present` = any source object exists
- `executed` = any source has `executed === true`
- `edgeCount` = max count across sources (so a stale 0 cannot mask a later 12); `source` = the path that produced the chosen count
- Missing graph → `{ present:false, executed:false, edgeCount:0, source:null }`

Uses the `isRecord` / `getPath` / `getEdgeCount` helpers spelled out in the spec.

**2. Add `src/lib/measurements/__tests__/aerialCandidateGraphResolver.test.ts**`

Vitest cases 1–10 exactly as specified:

1. Top-level executed with 12 edges → source `root`
2. Fonsica `dsm_planar_graph_debug` fallback → source `dsm_planar_graph_debug`
3. `terminal_debug_payload.pre_phase3_5_preempt` fallback → source `terminal_preempt`
4. Executed but `edges: []` → edgeCount 0, source `root`
5. Missing graph → all-false/null result
6. Stale root `executed:false, edges:[]` plus nested executed with 8 edges → edgeCount 8, source `dsm_planar_graph_debug`
7. `candidate_faces` fallback → edgeCount 5
8. numeric `edge_count` fallback → 7
9. numeric `edges_count` fallback → 9
10. Best non-zero count wins: empty root vs terminal_preempt with 12 → edgeCount 12, source `terminal_preempt`

**3. Modify `src/components/measurements/MeasurementReportDialog.tsx` (lines 774–788 only)**

- Add import: `import { resolveAerialCandidateGraph } from "@/lib/measurements/aerialCandidateGraphResolver";`
- Replace the existing Aerial Candidate Graph IIFE with one that calls `resolveAerialCandidateGraph(grj)` and renders:
  - not present → `"—"`
  - present, not executed → `"present (0 candidate edges) — graph not executed"`
  - executed, `edgeCount > 0` → ``executed (${edgeCount} candidate edges)``
  - executed, `edgeCount === 0` → `"executed (0 candidate edges) — empty graph"`
- Preserve the existing DSM-unavailable suffix behavior: append `" — DSM validation unavailable"` only when one of the existing local conditions is true (`hard_fail_reason === "dsm_transform_invalid"`, `block_customer_report_reason === "dsm_validation_unavailable"`, or `dsm_validation_status.reason === "invalid_transform"` already in scope as `resolvedState.dsm_validation_status`). No other diagnostics logic touched.

### Out of scope (untouched)

- start-ai-measurement, all edge functions, backend measurement / aerial graph / DSM solver / geometry scoring / overlay transforms
- customer-report gates, report_blocked logic, `measurementDiagnosticState.ts`, `MeasurementVisualQAOverlay`
- DB schema and migrations
- Debug Roof Lines row, Reportable Roof Lines row, all other diagnostic rows
- Any UI labels outside the Aerial Candidate Graph row

### Acceptance

- Fonsica row reads: `Aerial Candidate Graph executed (12 candidate edges)` (plus DSM-unavailable suffix if applicable)
- Debug Roof Lines = 6, Reportable Roof Lines = 0, `customer_report_ready` = false — all unchanged
- No candidate/debug edges promoted into reportable roof lines
- New resolver unit tests pass; no backend, edge-function, or DB changes  
  

  ```
  Go.

  Implement the Aerial Candidate Graph Diagnostic Fix exactly as scoped.

  This is frontend-only.

  Do not touch:
  - start-ai-measurement
  - edge functions
  - backend measurement logic
  - aerial graph builder
  - DSM solver
  - geometry scoring
  - overlay transforms
  - customer-report gates
  - report_blocked logic
  - measurementDiagnosticState.ts
  - MeasurementVisualQAOverlay
  - DB schema or migrations
  - Debug Roof Lines row
  - Reportable Roof Lines row
  - any UI labels outside the Aerial Candidate Graph row
  - six-phase cleanup

  Files to change:

  1. Add:
  src/lib/measurements/aerialCandidateGraphResolver.ts

  Export:

  export type ResolvedAerialCandidateGraph = {
    present: boolean;
    executed: boolean;
    edgeCount: number;
    source: string | null;
  };

  export function resolveAerialCandidateGraph(grj: unknown): ResolvedAerialCandidateGraph;

  Source paths, checked in order:

  - root → aerial_candidate_roof_graph
  - debug_layers → debug_layers.aerial_candidate_roof_graph
  - dsm_planar_graph_debug → dsm_planar_graph_debug.aerial_candidate_roof_graph
  - terminal_preempt → terminal_debug_payload.pre_phase3_5_preempt.aerial_candidate_roof_graph
  - terminal_root → terminal_debug_payload.aerial_candidate_roof_graph

  For each graph object, edge count comes from first valid:

  - edges.length
  - candidate_faces.length
  - numeric edge_count
  - numeric edges_count

  Aggregation rules:

  - present = true if any source object exists.
  - executed = true if any source has executed === true.
  - edgeCount = max valid count across sources.
  - source = source key that produced the chosen count.
  - Missing graph returns:
    { present:false, executed:false, edgeCount:0, source:null }
  - A stale zero-count source must not mask a later non-zero source.
  - A stale executed=false source must not mask a later executed=true source.

  2. Add tests:
  src/lib/measurements/__tests__/aerialCandidateGraphResolver.test.ts

  Use Vitest.

  Required test cases:

  - top-level executed graph with 12 edges returns source root and edgeCount 12
  - dsm_planar_graph_debug fallback with 12 edges returns source dsm_planar_graph_debug and edgeCount 12
  - terminal_debug_payload.pre_phase3_5_preempt fallback with 12 edges returns source terminal_preempt and edgeCount 12
  - executed=true but edges=[] returns present=true, executed=true, edgeCount=0, source=root
  - missing graph returns present=false, executed=false, edgeCount=0, source=null
  - stale root executed=false edges=[] plus nested executed=true edges.length=8 returns executed=true, edgeCount=8, source=dsm_planar_graph_debug
  - candidate_faces fallback returns candidate_faces.length
  - numeric edge_count fallback works
  - numeric edges_count fallback works
  - best non-zero count wins when root is empty but terminal_preempt has 12 edges

  3. Modify only the Aerial Candidate Graph row in:
  src/components/measurements/MeasurementReportDialog.tsx

  Add import:

  import { resolveAerialCandidateGraph } from "@/lib/measurements/aerialCandidateGraphResolver";

  Replace the existing Aerial Candidate Graph IIFE around lines 774–788 with resolver-based display logic:

  - not present:
    "—"

  - present, not executed:
    "present (0 candidate edges) — graph not executed"

  - executed, edgeCount > 0:
    `executed (${edgeCount} candidate edges)`

  - executed, edgeCount === 0:
    "executed (0 candidate edges) — empty graph"

  Preserve existing DSM-unavailable suffix behavior only if one of the existing local conditions is already true:

  - hard_fail_reason === "dsm_transform_invalid"
  - block_customer_report_reason === "dsm_validation_unavailable"
  - resolvedState.dsm_validation_status.reason === "invalid_transform"

  Do not create new diagnostic state.

  Acceptance:

  - Latest Fonsica UI shows:
    Aerial Candidate Graph executed (12 candidate edges)
    plus DSM-unavailable suffix only if current local condition applies.

  - Debug Roof Lines remains 6.
  - Reportable Roof Lines remains 0.
  - customer_report_ready remains false.
  - No candidate/debug edges are promoted into reportable roof lines.
  - No backend files changed.
  - No edge functions changed.
  - No DB migration.
  - Resolver tests pass.
  ```
  This is the right move. After this, the diagnostics UI should finally reflect what the backend already fixed.