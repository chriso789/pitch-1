
## Scope

Add a new **Registered Aerial Geometry Stage** that runs between source acquisition and DSM topology solving. It builds a first-class diagnostic `aerial_candidate_roof_graph` in `raster_px` space from already-available inputs (raster bounds, `geo_to_raster_transform`, Solar mask, perimeter ring, target mask, eave edges). DSM is demoted to a validation/refinement layer — it no longer gates whether *any* roof geometry exists. Customer gates stay strict.

No schema migration. No relaxation of `customer_report_ready`. Canonical route remains `start-ai-measurement`.

---

## Backend

### 1. New module: `supabase/functions/_shared/aerial-candidate-graph.ts`

Pure builder. Inputs (all already persisted today):
- `overlay_debug.raster_url`, `raster_bounds_lat_lng`, `geo_to_raster_transform`
- `confirmed_roof_center_px`, `static_map_center_lat_lng`
- Google Solar mask contour / segment polygons / azimuths
- `target_mask_isolation` (bbox, components, chosen component)
- `perimeter_topology.perimeter_ring_px` / `perimeter_ring_geo`
- `perimeter_topology.eave_edges`, `corner_nodes`
- `mask_components_table`

Output shape persisted at `geometry_report_json.aerial_candidate_roof_graph`:

```ts
{
  version: "aerial-candidate-graph-v1",
  coordinate_space: "raster_px",
  executed: true,
  customer_ready: false,
  source: "registered_aerial_geometry",
  perimeter_ring_px, perimeter_ring_geo,
  perimeter_area_sqft, target_mask_area_sqft,
  perimeter_vs_mask_iou, target_mask_overlap_with_perimeter,
  nodes: [{ id, px, geo, kind: "corner"|"reflex"|"convex" }],
  edges: [{
    id, type_candidate: "eave"|"rake"|"perimeter"|"unclassified",
    start_px, end_px, start_geo, end_geo,
    length_ft, confidence, evidence_source,
    debug_only: true, customer_ready: false,
    validation_status: "candidate_only",
  }],
  candidate_faces: [{ id, polygon_px, polygon_geo, source: "solar_segment"|"mask_component" }],
  evidence: {
    raster_registered: bool,
    target_mask_isolation_checked: bool,
    solar_segments_used: bool,
    dsm_required: false,
  },
  skipped_reason?: string,  // when inputs insufficient
}
```

Skip (`executed:false, skipped_reason`) when raster transform OR perimeter ring missing. Never throw.

### 2. Wire into `supabase/functions/start-ai-measurement/index.ts`

New phase **before** Phase 3A.5 perimeter refinement / Phase 3C-E:

```
… source acquisition (raster + solar + target mask) …
→ buildAerialCandidateGraph(ctx)             // NEW
→ persist into geometry_report_json
→ perimeter refinement (Phase 3A.5)
→ DSM georeg gate (existing footprint-DSM gate)
   ├── pass → autonomous DSM solver / Phase 3C/D/E (validation/refinement)
   └── fail → mark dsm_status.georegistration_transform=fail,
              keep aerial_candidate_roof_graph,
              do NOT erase aerial geometry,
              hard_fail_reason = "dsm_transform_invalid"
                 (only when DSM was the actual blocker)
```

Existing CPU preempt + persistence contract slice stays intact. Aerial graph builder is cheap (no heavy edge detection) — runs before any preempt threshold matters.

### 3. Demote-DSM rule (no gate relaxation)

In `start-ai-measurement`:
- If `aerial_candidate_roof_graph.executed === true` AND DSM georeg fails → write `result_state` via `normalizeResultStateForWrite` mapping to existing `ai_failed_runtime` bucket, set `hard_fail_reason="dsm_transform_invalid"`, `block_customer_report_reason="dsm_validation_unavailable"`, keep `customer_report_ready=false`.
- DSM solver path is unchanged when transform IS valid. Aerial graph remains as additional debug evidence.

### 4. Debug edges contract (already partially in place)

Aerial graph edges feed `debug_roof_lines` only. They MUST NOT contribute to `roof_lines_count` or any typed-roof-line aggregation. Enforce in `roof-lines.ts` aggregator: filter `debug_only===true`.

---

## Frontend

### 5. `src/components/measurements/MeasurementVisualQAOverlay.tsx`

Extend render fallback chain to include aerial candidate graph perimeter (highest debug priority):

1. `aerial_candidate_roof_graph.perimeter_ring_px` (NEW — top of fallback when DSM failed)
2. `phase3_5.refined_perimeter_px`
3. `phase3_5.raw_perimeter_px`
4. `debug_layers.raw_perimeter_px`
5. `perimeter_topology.perimeter_ring_px`

Add toggleable layer for aerial candidate edges (gray) and candidate faces (translucent fill). Use existing layer-toggle pattern.

### 6. `src/components/measurements/MeasurementReportDialog.tsx`

Add three-line status block when `aerial_candidate_roof_graph` exists:
- **Aerial Candidate Graph:** present / skipped
- **DSM Topology:** passed / failed / blocked
- **Customer Report:** ready / blocked (with `block_customer_report_reason`)

No change to customer-ready gating.

### 7. `src/lib/measurements/measurementDiagnosticState.ts`

Add `aerial_candidate_graph_present` boolean. When true AND DSM failed, blocker copy is "DSM validation unavailable — aerial candidate geometry persisted for review" (not "no roof geometry").

---

## Tests (added before deploy; deploy only after green)

Backend (Deno) — `supabase/functions/start-ai-measurement/__tests__/`:

- `aerial-candidate-graph-builder.test.ts` — given `perimeter_ring_px` + raster transform + target mask, builder emits `executed:true`, all edges flagged `debug_only:true`, `customer_ready:false`, edges carry `start_px`/`end_px`/`start_geo`/`end_geo`/`length_ft`.
- `aerial-graph-survives-dsm-failure.test.ts` — given invalid DSM transforms, aerial graph still persisted; `customer_report_ready===false`; `hard_fail_reason==="dsm_transform_invalid"`; `block_customer_report_reason` set.
- `aerial-debug-edges-excluded-from-roof-lines.test.ts` — aerial edges do NOT increment `roof_lines_count` and do NOT appear in typed roof_lines aggregator.
- `aerial-graph-skipped-without-raster.test.ts` — missing `geo_to_raster_transform` → `executed:false`, `skipped_reason:"raster_transform_unavailable"`, no throw.

Frontend (Vitest):

- `MeasurementVisualQAOverlay.aerial-fallback.test.tsx` — only `aerial_candidate_roof_graph.perimeter_ring_px` present → overlay renders; "unavailable" not shown.
- `MeasurementReportDialog.aerial-status-block.test.tsx` — aerial present + DSM failed → three-line status block renders; customer-report chip remains "blocked".
- `measurementDiagnosticState.aerial-blocker-copy.test.ts` — DSM failure + aerial present → blocker copy mentions DSM validation, not missing geometry.

---

## Guardrails (unchanged)

- No geometry gate relaxation; vendor benchmark thresholds untouched.
- No DB schema migration; everything lives inside `geometry_report_json`.
- `customer_report_ready` stays driven by existing `assertCustomerReportReady` path; aerial graph alone never flips it.
- Canonical route remains `start-ai-measurement`; legacy routes still stamped `canonical_measurement_route:false`.
- DSM solver code paths unchanged when DSM georeg is valid.

## Post-deploy verification (Fonsica rerun from lead UI)

- `geometry_report_json.aerial_candidate_roof_graph.executed === true`
- Aerial perimeter visible in overlay even when DSM transform invalid
- `customer_report_ready === false`
- Three-line status block visible in report dialog
- `debug_roof_lines.length > 0` while `roof_lines_count === 0`
- No DB constraint errors; CPU elapsed < budget
