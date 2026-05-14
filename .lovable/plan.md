## Problem

In `supabase/functions/_shared/perimeter-topology.ts` (lines ~747–944), `gableApexDetected` is set to `true` whenever **any** opposing-azimuth pair exists in the *global* solar segment set AND the edge happens to be parallel to a downslope vector. On a hip roof (4 azimuths) every opposing pair already exists globally, so every slope-parallel perimeter edge is falsely flagged as a gable apex.

Because the hip-prior demotion only runs when `!gableApexDetected`, no edges get demoted on Fonsica. Result: 6 rakes, 0 eaves, `eave_lf_zero_with_long_perimeter` hard fail.

## Fix

### 1. Redefine `gableApexDetected` as local-evidence only
Replace the current global-azimuth + parallel-slope rule with a per-edge local check that requires **all** of:
- A ridge endpoint (from `input.ridge_chains` / ridge graph) within `~max(8 px, 0.15 × edgeLen)` of either edge endpoint.
- ≥2 adjacent roof planes whose azimuths differ by ≥120° (true opposing pair locally, not globally).
- Edge is short relative to perimeter mean (`< 0.7 × meanEdgeLenFt`) — gable ends are typically the short sides.
- Edge is parallel to local downslope (`bestDownslopeAngle < 25°`).

If no ridge endpoint is near the edge → `gableApexDetected = false`, regardless of azimuth math.

### 2. Hip-archetype hard override
Add at the top of the per-edge loop, before scoring:
```
if (isHipLike && !isGableLike && !localGableEvidence) {
  gableApexDetected = false;
  rakeScoreCap = 0.3;
}
```
Then in scoring, clamp `rakeScore = Math.min(rakeScore, rakeScoreCap)`.

Hip-prior demotion fires whenever `isHipLike && !isGableLike && !localGableEvidence` — even if the edge currently scores rake. Increment `demotedByHipPrior` accordingly.

### 3. Tune scoring
- Eave: keep current weights, but raise baseline bias from `0.10` → `0.15` on hip-like roofs.
- Rake: zero out the +0.45 / +0.20 / +0.15 boosts when `gableApexDetected=false`. Final `rakeScore` capped at `0.3` on hip-like roofs without local gable evidence.
- Decision rule unchanged, but with the cap it can no longer beat eave.

### 4. Per-edge debug fields
Extend each entry in `classificationTable` and persist on the edge:
- `local_ridge_endpoint_near_edge` (bool)
- `local_ridge_endpoint_distance_px` (number | null)
- `adjacent_plane_count` (number)
- `adjacent_plane_azimuths` (number[])
- `local_gable_evidence` (bool)
- `global_opposing_azimuth_only` (bool) — true when global pair exists but local doesn't
- `hip_prior_forced_eave` (bool)
- `final_classification_reason` (string: `local_gable`, `hip_prior_no_local_gable`, `drainage_perpendicular`, `confidence_below_floor`, …)

### 5. Regression test
Create `supabase/functions/_shared/__tests__/perimeter-topology-fonsica.test.ts` with a synthetic Fonsica-shaped input:
- 6 perimeter edges, 4 solar azimuth buckets (hip-like), no ridge endpoints near perimeter.
- Assert: `eave_lf > 200`, `rake_lf < 30`, `edges_demoted_by_hip_prior > 0`, no edge has `gable_apex_detected=true`.

### 6. Downstream effects (no behavior change required, just verify)
- `start-ai-measurement` Phase 3A gate (`eave_lf_zero_with_long_perimeter`) should now pass for Fonsica.
- If subsequent topology gate still fails, `result_state` will fall through to `perimeter_only` or `ai_failed_topology` per the existing normalizer — no migration needed.

## Files to change

- `supabase/functions/_shared/perimeter-topology.ts` — classifier rewrite (sections at lines 747–944).
- `supabase/functions/_shared/__tests__/perimeter-topology-fonsica.test.ts` — new regression test.

No DB migration. No edge-function contract change. No frontend change.