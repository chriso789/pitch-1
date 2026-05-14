## Phase 3 — Preserve detected roof structure into the final diagram

Phase 0 now runs and DSM evidence reaches the solver (30 raw edges → 27 accepted → 24 clustered). The remaining failure is destructive: detected structure is annihilated between evidence detection and final diagram build, collapsing to 2 faces, 0 ridges, 0 valleys, and a one-diagonal failed diagram. Phase 3 wires detected evidence (perimeter classification, seed backbone, deferred edges, typed roof_lines) into the *output* so the diagram reflects what was actually found — and refuses to display failed geometry as if it were a real measurement.

All work is in `supabase/functions/start-ai-measurement/index.ts`, `supabase/functions/_shared/perimeter-topology.ts`, `supabase/functions/_shared/result-state.ts`, and `supabase/functions/recalculate-measurement-from-overrides/index.ts`. No DB schema changes — `roof_lines` exists.

---

### 3A — Eave/rake classifier rebuild (immediate priority)

Phase 2A added a hip prior but Fonsica still emits `eave_lf=0, rake_lf=225.89`. The provisional-rake path wins before hip demotion fires.

In `_shared/perimeter-topology.ts`:
1. **Invert the default.** Provisional type = `eave_candidate`, NOT `rake`. Rake only on positive gable evidence:
   - Two adjacent planes meet along edge with opposing azimuths (gable apex), OR
   - Adjacent plane downslope vector parallel (±20°) to edge AND a ridge chain terminates at one endpoint.
2. **Eave evidence:** adjacent plane normal projects across the edge (drainage crosses).
3. **Confidence floor:** if neither side reaches 0.6 → `unknown_perimeter`, `can_be_customer_reported=false`.
4. **Hip prior as tiebreaker** (not post-hoc demotion): `isHipLike` and no gable apex → force eave on any provisional rake regardless of confidence.
5. **Hard sanity gate** stays: `eave_lf===0 && perimeter_total_lf>100` → `perimeter_classification_invalid`.
6. Persist `perimeter_edge_classification_table[]`: `{edge_id, provisional, final, eave_score, rake_score, gable_apex_detected, drainage_dot, confidence, demoted_by_hip_prior}`.

Acceptance: Fonsica → `eave_lf > 200`, `rake_lf < 30`, per-edge reasoning visible.

---

### 3B — Typed `roof_lines` persisted on EVERY run, even failures

Today rows only insert on the `customer_report_ready` path; failed runs fall back to generic solver edges.

In `start-ai-measurement/index.ts` (~line 6109 patent gate block):
1. **Always persist** Phase 0 perimeter lines as `roof_lines`, regardless of gate outcome. `can_be_customer_reported = (gate_passed && confidence>=0.6)`.
2. **Always persist** accepted topology edges and rejected/deferred candidates with `rejection_reason`.
3. Each row: `measurement_id`, `tenant_id`, `layer_id` (1=perimeter, 2=structural), `geometry_px`, `geometry_geo`, `length_lf`, `non_dimensional_attribute` (perimeter/eave/rake/ridge/hip/valley/wall_flashing/step_flashing/common/unknown), `source`, `confidence`, `adjacent_plane_ids[]`, `can_be_customer_reported`, `rejection_reason`.
4. **Totals path:** `recalculate-measurement-from-overrides` and inline publish path compute totals from `roof_lines WHERE can_be_customer_reported=true`. None reportable → totals null and `result_state=ai_failed_*`.
5. Persist diagnostics: `roof_lines_count`, `roof_lines_by_attribute`, `reportable_roof_lines_count`, `roof_line_total_lf_by_attribute`.

---

### 3C — Defer connectivity-failed edges instead of deleting them

Today 13 of 27 accepted edges are deleted by connectivity → 9 canonical → 2 faces.

Locate the `rejected_by_connectivity` step (grep, est. ~line 3900). Change to:
1. Push to `deferred_structural_candidates[]` instead of dropping, if ALL of:
   - Inside perimeter polygon, AND
   - DSM elevation gradient >0.4 m across or along edge, AND
   - Within 15° of a Solar segment azimuth boundary, OR colinear with another deferred edge.
2. **Refinement pass:** for any face >35% of total roof area, attempt to insert deferred edges that lie inside it. Accept split if `valid_faces` rises and area conservation stays in [0.95, 1.05].
3. Persist: `connectivity_edges_deferred`, `connectivity_edges_deleted`, `deferred_edges_used_for_refinement`, `deferred_edges_rejected_after_refinement`, `faces_before_deferred_refinement`, `faces_after_deferred_refinement`, `oversized_faces_split`.

---

### 3D — Force seed backbone into the planar graph

Diagnostics show `edge_class_counts_pre.ridge=2, valley=3` and backbone chains exist, but final `ridge=0, valley=0`. Backbone is detected then thrown away.

1. New helper `buildSeedBackbone(rawDsmEdges, solarSegments, edgeClassCountsPre, perimeterReflexCorners)` produces `seed_ridge_chains`, `seed_valley_chains`, `seed_hip_chains`.
2. **Insert backbone into planar graph BEFORE face extraction.** Mark edges `locked=true`.
3. Final canonical-edge pruning **must not** drop locked edges. Failed downstream checks log to `backbone_prune_reasons` but the edge survives.
4. **Hard rule:** seed chains exist but final `ridge_lf===0 && valley_lf===0` → fail `backbone_not_applied` (NOT `invalid_roof_footprint`).
5. Persist: `seed_backbone_edges`, `seed_backbone_edges_inserted`, `seed_backbone_edges_survived`, `seed_backbone_edges_pruned`, `backbone_prune_reasons`, `seed_ridge_lf`, `seed_valley_lf`, `seed_hip_lf`.

---

### 3E — Constraint-solver repair pass before rejecting all candidates

Today: 8 candidates, all rejected for `ridge_lf=0`, no repair attempt.

1. If every candidate is rejected and dominant rejection reason is `ridge_lf=0` (or `valley_lf=0`): run repair pass — force-insert highest-confidence chain from `seed_ridge_chains`/`seed_valley_chains` as locked, re-score.
2. Only fail after one repair attempt per missing primitive.
3. Persist: `candidate_repair_attempted`, `repaired_ridge_chains_inserted`, `repaired_valley_chains_inserted`, `repaired_candidate_scores`, `final_selected_candidate`, `final_rejection_reason`.

---

### 3F — `result_state` is never blank

Extend `_shared/result-state.ts` `normalizeResultStateForWrite`:

```text
perimeter gate fails              → ai_failed_perimeter
perimeter passes, topology fails  → perimeter_only
seeds exist, dropped              → ai_failed_topology  (hard_fail_reason=backbone_not_applied)
all candidates rejected post-rep  → ai_failed_topology  (hard_fail_reason=topology_undersegmented_after_backbone_repair)
2 faces on >2500 sqft             → ai_failed_topology  (NOT invalid_roof_footprint)
schema mismatch                   → ai_failed_schema
unhandled exception               → ai_failed_runtime
```

Pipe every write of `result_state` on `roof_measurements`, `ai_measurement_jobs`, `measurement_jobs` through the normalizer. Always populate `hard_fail_reason`, `block_customer_report_reason`, `failure_stage` alongside.

---

### 3G — Failed geometry must NOT render as the measured diagram

Current PDF still renders the collapsed 2-face geometry with lengths/pitch/area — looks like a real report under a watermark. That ends now.

If any of these fire:
- `topology_undersegmented`
- `invalid_roof_footprint`
- `backbone_not_applied`
- `topology_undersegmented_after_backbone_repair`

Then the diagnostic JSON must signal the renderer to:
- Tag failed internal geometry as `rejected_topology_candidate` (red/orange stroke), label "Rejected topology candidate".
- Do NOT use it as the official length/pitch/area diagram.
- If perimeter is valid, expose a separate `perimeter_only_diagram` payload.
- `customer_report_ready` stays false.

Backend deliverable: emit `geometry_report_json.diagram_render_intent` enum (`rejected_only` / `perimeter_only` / `full_topology`) plus the geometry payloads each mode needs. Renderer changes are tracked separately.

---

### Frontend scope note

Frontend viewer updates are not required for this backend phase, but `geometry_report_json` MUST expose every new diagnostic so the existing report and future AI Process Viewer can render them later:

- `perimeter_edge_classification_table`
- `roof_lines_by_attribute`
- `deferred_structural_candidates`
- `seed_backbone_edges`, `seed_backbone_edges_survived`, `backbone_prune_reasons`
- `candidate_repair_attempted`, `repaired_candidate_scores`
- `final_rejection_reason`
- `diagram_render_intent`

---

### Implementation order

1. **3A + 3F + 3G** — visible classifier fix, clean failure label, stop pretending failed geometry is a diagram.
2. **3B** — typed roof_lines drive totals (unblocks debugging of 3C/3D/3E).
3. **3C** — defer instead of delete (gives 3D real edges to seed with).
4. **3D** — backbone insertion + locking.
5. **3E** — constraint repair pass.

Each step ends with a Fonsica re-run against the acceptance criteria.

---

### Acceptance criteria (Fonsica)

- `result_state` populated on every run
- `roof_lines_count > 0`, `roof_lines_by_attribute` populated
- `eave_lf > 200`, `rake_lf < 30`
- `perimeter_edge_classification_table` populated with per-edge reasoning
- `connectivity_edges_deferred > 0`; deletions only post-refinement
- `seed_backbone_edges_inserted > 0` when seed chains exist
- final `ridge_lf > 0` OR failure = `backbone_not_applied`
- `faces > 2` OR failure = `topology_undersegmented_after_backbone_repair`
- `diagram_render_intent` set on every run; failed runs are NOT `full_topology`
- `customer_report_ready=false` until topology actually passes

---

### Out of scope

- No DB migrations (`roof_lines` exists).
- No customer PDF template changes — gate keeps blocking until topology passes.
- Frontend renderer changes for 3G tracked separately; this phase only emits the contract.
