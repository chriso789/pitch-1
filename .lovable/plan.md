# Phase 2 Implementation Plan

Phase 0 control flow is fixed. Now we make the roof logic correct: classify eave vs rake properly, persist typed `roof_lines` as the source of truth, stop the connectivity pruner from destroying structural edges, build a backbone before planar faces, and ensure `result_state` is never blank.

All work lives in `supabase/functions/start-ai-measurement/index.ts` plus a few shared modules. No DB schema changes — `roof_lines` table already exists from Phase 1.

---

## 2A — Eave/Rake classification (highest priority, biggest visible win)

**Where:** `buildPerimeterPhase0` and the perimeter classifier it calls (~line 1843).

**Current bug:** every perimeter edge classified as rake → `eave_lf=0`, `rake_lf=225.89` on Fonsica.

**Changes:**
1. Replace the single solar-downslope test with a 3-signal classifier per perimeter edge:
   - Adjacent plane drainage: project plane normal onto edge → drainage across edge = **eave**, drainage parallel = **rake**.
   - Gable detection: only allow rake when an actual gable plane (steep azimuth boundary, two planes meeting at apex inside the edge) is present.
   - Hip-roof prior: if no gable planes detected and roof is hip-like (azimuth count ≥ 4), default to **eave**.
2. Confidence-gated fallback: if confidence < 0.6 → mark `eave_candidate`/`unknown`, set `customer_reportable=false`, never force rake.
3. Sanity gate: if `eave_lf === 0 && perimeter_total_lf > 100` → fail with `perimeter_classification_invalid` and refuse to advance.
4. Persist on `perimeter_phase0`:
   `eave_rake_classification_debug`, `perimeter_edge_pitch_relation`, `eave_candidate_lf`, `rake_candidate_lf`, `unknown_perimeter_lf`, `eave_rake_confidence`.

**Acceptance:** Fonsica classifies most perimeter as eave, rake near 0–10 LF, eaves+rakes ≈ 264 LF.

---

## 2B — Typed `roof_lines` persistence drives report totals

**Where:** patent gate block (~line 6109) where typed roof_lines already insert.

**Changes:**
1. Always persist perimeter roof_lines from Phase 0 even if internal topology fails (today they only persist when `customer_report_ready` path runs).
2. Add fields on each row: `layer_id`, `adjacent_plane_ids`, `can_be_customer_reported`.
3. Ensure the allowed `non_dimensional_attribute` enum is enforced: perimeter, eave, rake, ridge, hip, valley, wall_flashing, step_flashing, common, unknown.
4. Report totals (`recalculate-measurement-from-overrides` and the publish path here) compute from `roof_lines WHERE can_be_customer_reported=true`. If none are reportable → totals stay null and `result_state=ai_failed_*`.
5. Add diagnostics: `roof_lines_count`, `roof_lines_by_attribute`, `customer_reportable_roof_lines_count`, `roof_line_total_lf_by_attribute`.

---

## 2C — Connectivity pruning becomes deferral, not deletion

**Where:** graph builder around the `rejected_by_connectivity` step (need to locate; ~line 3900+).

**Changes:**
1. Edges that fail connectivity move to `deferred_structural_candidates` instead of being deleted, IF:
   - Inside perimeter polygon, AND
   - Have DSM elevation support, AND
   - Align (within 15°) with a Solar segment azimuth boundary.
2. Topology refinement second-pass uses deferred edges to split oversized faces (any face > 35% of total roof area).
3. Persist: `connectivity_edges_deferred`, `connectivity_edges_deleted`, `deferred_edges_used_for_refinement`, `oversized_faces_split`, `faces_before_deferred_refinement`, `faces_after_deferred_refinement`.

---

## 2D — Backbone-first topology seed

**Where:** before `solveAutonomousGraph` planar-face extraction.

**Changes:**
1. New helper `buildSeedBackbone(rawDsmEdges, solarSegments, edgeClassCountsPre, perimeterReflexCorners)`:
   - Cluster collinear DSM edges into chains.
   - Promote chains lying along Solar azimuth boundaries → `seed_ridge_chains`.
   - Promote concave-up chains between opposing-azimuth segments → `seed_valley_chains`.
   - Promote chains terminating at reflex corners → `seed_hip_chains`.
2. Feed backbone into face extraction as locked edges (cannot be pruned).
3. Persist all `seed_*` debug fields listed in the spec.

---

## 2E — Result state is never blank

**Where:** publish path + final write of `roof_measurements` and `ai_measurement_jobs`.

**Changes:**
1. Pipe every state through `normalizeResultStateForWrite` (already exists from prior phase).
2. Mapping additions:
   - perimeter classification fail → `ai_failed_perimeter`
   - perimeter passes, topology fails → `perimeter_only`
   - backbone seed builds but solver collapses → `ai_failed_topology`
3. Always populate `hard_fail_reason`, `block_customer_report_reason`, `failure_stage` alongside.

---

## Implementation order

1. **2A** (visible fix on next Fonsica run) +
   **2E** (so the failure has a clean state label).
2. **2B** (so roof_lines reflect new classification and totals path is correct).
3. **2C** (preserves edges so 2D has data to work with).
4. **2D** (backbone seed — the most experimental piece, ship last).

Each step ends with a Fonsica re-run and the acceptance metrics from the spec checked against the diagnostic JSON.

---

## Files touched

- `supabase/functions/start-ai-measurement/index.ts` — all 5 phases.
- `supabase/functions/_shared/result-state.ts` — extend mapping for `perimeter_classification_invalid`, `topology_undersegmented`, `backbone_collapsed`.
- `supabase/functions/recalculate-measurement-from-overrides/index.ts` — read totals from `roof_lines` when `can_be_customer_reported=true`.
- `mem://architecture/measurement-system/perimeter-classification-contract` (new) + index update.

## Out of scope

- No DB schema migrations (table exists).
- No frontend changes — debug diagrams already render whatever `geometry_report_json` contains.
- No customer-report PDF changes — gate keeps it blocked until topology is real.
