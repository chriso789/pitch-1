# PR #5 — Self-Consistent Pitch Verification

## North star

The AI measurement system is the vendor. Runtime confidence is derived from raw evidence agreement only. Vendor reports, vendor benchmarks, and vendor PDF labels are not live inputs, not training labels, and not runtime gates.

## What this PR adds

1. **Per-facet DSM / point-cloud plane-fit pitch contract**
   - `fitPlaneRansac(points)` fits `ax + by + cz + d = 0` from 3D roof points.
   - Pitch is derived from plane normal as rise-over-12.
   - Plane-fit quality is recorded with RMSE, median residual, max residual, inlier count, and inlier ratio.
   - A facet is not pitch-verified when residuals are high or inlier ratio is low.

2. **Visual edge-angle cross-check contract**
   - Street-facing imagery is a cross-check only.
   - Edge-angle reads are compared against DSM/geometry pitch.
   - Missing imagery produces `unavailable`, not lower AI confidence by itself.
   - Disagreement produces `needs_review` / self-consistency failure, not a vendor fallback.

3. **Runtime validation hook**
   - `validate_geometry` now requires the `pitch_results` artifact to carry a self-consistency score.
   - Minimum runtime threshold is `0.90`.
   - The gate reads `pitch_self_consistency`, `self_consistency`, `pitch_verification`, or top-level pitch metadata blocks.

4. **Schema support**
   - Adds pitch verification columns to `roof_measurements`, `ai_measurement_jobs`, `measurement_jobs`, and `mskill_geometry_status`.
   - Adds `pitch_visual_cross_checks` for visual pitch readings and deltas.

## Required `pitch_results` artifact metadata

```json
{
  "pitch_self_consistency": {
    "score": 0.94,
    "status": "passed",
    "facet_results": [
      {
        "facet_id": "front-1",
        "score": 0.96,
        "consensus_pitch_rise_over_12": 6.0,
        "max_delta_rise_over_12": 0.2,
        "failed_reasons": []
      }
    ]
  }
}
```

Equivalent accepted keys:

- `pitch_self_consistency.score`
- `self_consistency.score`
- `pitch_verification.score`
- top-level `pitch_self_consistency_score`

## Hard gate

`validate_geometry` blocks when:

- `pitch_results` artifact is missing.
- `pitch_results.metadata` lacks a numeric self-consistency score.
- score `< 0.90`.
- status exists and is not `passed` or `verified`.

## Tests

- `supabase/functions/_shared/__tests__/pitch-self-consistency.test.ts`
- `supabase/functions/_shared/__tests__/street-view-pitch-verification.test.ts`

These tests cover synthetic 6/12 plane recovery, outlier robustness, disagreement failure, artifact gate behavior, and visual edge-angle comparison.
