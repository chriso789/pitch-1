# Perimeter-First + Reverse-Geometry Measurement Rebuild

## Problem

Current pipeline tries to detect internal hips/ridges/valleys before locking the outer roof boundary. When DSM edge detection misses interior structure, the solver collapses into giant cross-roof diagonals (Fonsica: 6 facets, 1.67/12 pitch, 0 ridges vs Roofr's 14 facets, 6/12, 30'2" ridges). Threshold tuning will not fix this — the architecture is wrong.

## Correct Flow

```text
Aerial image / roof mask
    └─► true outer eave/rake perimeter      (Phase 1)
            └─► Google Solar pitch + segments (Phase 2)
                    └─► DSM height evidence
                            └─► candidate topology templates (Phase 3)
                                    └─► reverse geometry optimizer
                                            └─► final roof diagram (Phase 4)
                                                    └─► vendor calibration (Phase 5)
                                                            └─► customer gate (Phase 6)
```

Outside boundary is fixed FIRST. Internal structure is reverse-solved against that fixed boundary using Solar/DSM as priors.

## Implementation

### Phase 1 — Perimeter-first extractor (NEW)

**New file:** `supabase/functions/_shared/perimeter-first-extractor.ts`

Inputs: aerial RGB, roof mask, DSM tile.
Process:
1. Connected-component the roof mask → largest blob = primary roof body.
2. Trace boundary contour with Suzuki-Abe; simplify with Douglas-Peucker (epsilon ≈ 1.5px).
3. Snap vertices to DSM roof-to-ground elevation breaks (>0.6m drop) to remove tree/shadow noise.
4. Classify each perimeter segment by adjacent-face downslope direction:
   - segment perpendicular to facet downslope = **eave** (low edge)
   - segment parallel to facet downslope = **rake** (sloped edge)
5. Compute corners (interior angles), perimeter LF, footprint area.

Outputs (persisted in `roof_measurements.source_context.perimeter_first`):
- `roof_outer_perimeter` (polygon, dsm_px)
- `eave_segments[]`, `rake_segments[]`
- `corners[]`
- `perimeter_confidence` (0–1)
- `perimeter_area_sqft`

**Hard gate:** perimeter_confidence < 0.80 → fail with `perimeter_unreliable`. No internal solve attempted.

### Phase 2 — Lock pitch + Solar priors (REWORK existing)

**Edit:** `supabase/functions/_shared/google-solar-api.ts`
Add `extractSolarTopologyPriors()` returning:
- `dominant_pitch_degrees` (area-weighted from `roofSegmentStats`)
- `pitch_band` `[min, max]` (e.g. ±1/12)
- `segment_priors[]` with `{ area, azimuth, pitch, bbox }`
- `total_area_target`
- `expected_facet_count`

**Edit:** `supabase/functions/start-ai-measurement/index.ts`
Move pitch locking from post-topology (current ~L4045–4076) to **pre-solver**. Pitch band is an input constraint, not an output. `pitch_source = "solar_locked_pre_solver"`.

### Phase 3 — Topology candidate generator + reverse solver (REWORK)

**Edit:** `supabase/functions/_shared/constraint-roof-solver.ts` (already exists from prior turn)
Change contract: solver now consumes the **fixed perimeter** from Phase 1, not a footprint guess.

Candidate templates (generated inside fixed perimeter):
- simple hip (4 facets)
- cross hip (8–10)
- nested upper hip (10–14)
- valley connector (8–12)
- multi-hip complex (12–16)
- mirrored assemblies

Scoring (weights):
| Constraint | Weight |
|---|---|
| perimeter_fit (vertices on fixed boundary) | 0.20 |
| pitch_fit (within Solar band) | 0.15 |
| area_conservation (vs Solar target ±5%) | 0.15 |
| dsm_edge_support | 0.10 |
| solar_segment_agreement (area + azimuth) | 0.10 |
| ridge_valley_continuity | 0.10 |
| construction_plausibility | 0.05 |
| facet_count vs Solar segment count | 0.05 |
| max_plane_area_ratio penalty (>35%) | 0.05 |
| cross_roof_diagonal penalty | 0.05 |

Local search: 50 iterations max, accept move only if total score improves. Persist top-3 candidates with score breakdown.

### Phase 4 — Diagram from winning topology

**Edit:** `supabase/functions/_shared/autonomous-graph-solver.ts`
Replace current "DSM edges → faces" pipeline with:
1. Take winning topology graph from Phase 3.
2. Perimeter edges → eaves/rakes (already classified in Phase 1).
3. Internal edges classified by adjacent-face normals:
   - opposing downslopes → **ridge**
   - converging downslopes → **valley**
   - convex perimeter transition → **hip**
4. Faces become facets; assign pitch per facet from Solar segment overlap.

### Phase 5 — Vendor calibration mode

**Edit:** `supabase/functions/_shared/vendor-benchmark.ts` (or extend existing)
When a `roof_measurement_benchmarks` row exists, compute deltas on area, facets, pitch, eaves, hips, valleys, ridges, rakes. Feed deltas back into candidate scoring weights for that property (not to fake numbers — to bias future runs on similar geometry).

### Phase 6 — Customer gate

**Edit:** `start-ai-measurement/index.ts` — extend existing gates.
Customer-ready ONLY if all pass:
- `perimeter_confidence ≥ 0.80`
- `pitch_confidence ≥ 0.85`
- `topology_score ≥ 0.70`
- no `ridge_network_missing` flag
- no `topology_undersegmented` flag
- `area_error ≤ 5%`
- `facet_count` within ±25% of Solar expected count

Otherwise → `validation_status = needs_review`, `requires_manual_review = true`, persist debug diagram + diagnostics.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/_shared/perimeter-first-extractor.ts` | **NEW** — Phase 1 extractor |
| `supabase/functions/_shared/google-solar-api.ts` | Add `extractSolarTopologyPriors()` |
| `supabase/functions/_shared/constraint-roof-solver.ts` | Consume fixed perimeter; expand candidate templates |
| `supabase/functions/_shared/autonomous-graph-solver.ts` | Replace edge-detection pipeline with topology→diagram |
| `supabase/functions/_shared/vendor-benchmark.ts` | Calibration feedback into scoring |
| `supabase/functions/start-ai-measurement/index.ts` | Pre-solver pitch lock; perimeter-first orchestration; new customer gate |
| `mem://architecture/measurement-system/perimeter-first-reverse-geometry` | Architecture memory |

## Expected Fonsica Results

- Perimeter traces full house outline from aerial mask, ~258'9" eave LF
- Pitch locks to 6/12 from Solar pre-solve
- Candidate generator emits hip+cross-gable + nested-upper-hip variants
- Constraint solver picks ~14-facet structured hierarchy
- Cross-roof diagonal candidate rejected on `cross_roof_diagonal` + `max_plane_area_ratio` penalties
- Ridges become non-zero (~30'2"), hips ~201', valleys ~64'
- Area within 5% of 3077 sqft
- Customer gate passes; diagram matches Roofr structure

## Notes / Risks

- Perimeter classifier (eave vs rake) needs DSM elevation gradient already implemented in `classifyEdgeByDSM`; reuse it.
- Solar pitch band must remain a hard constraint — no post-hoc "pitch correction" overwrites.
- Candidate generation is the new compute-heavy step; budget 3s per roof. If exceeded, return best-so-far with `time_budget_exceeded` diagnostic.
- This is a structural change — old runs in `roof_measurements` retain their schema; new runs add `perimeter_first` block to `source_context`.
