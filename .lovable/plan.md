## PR #5 — Self-Consistent Pitch Verification

Goal: every reported roof pitch must agree across independent raw evidence streams before a measurement can become customer-report-ready. The AI measurement system is the vendor; vendor reports and benchmark tables are not runtime inputs, confidence sources, training labels, or publication gates.

This PR is the prerequisite for PR #6 (self-distilled RoofNet/UNet) and PR #7 (global self-consistency publication gate).

---

### Scope

**In scope**
1. Per-facet DSM plane-fit pitch: RANSAC plane through DSM/point-cloud points inside each facet polygon.
2. Solar cross-check: nearest matching `roofSegmentStats.pitchDegrees` from the Solar evidence already acquired by PR #4.
3. Street-facing visual cross-check: closest available Street View/visual pano edge-angle read projected to pitch.
4. Three-way consensus per facet:
   - all three within ±1/12 → `pitch_agreement_state='high'`, final source `dsm`.
   - two of three within ±1/12 → `pitch_agreement_state='medium'`, final source `consensus`.
   - no agreement → `pitch_agreement_state='low'`, hard-fail with `hard_fail_reason='pitch_disagreement'`.
   - fewer than two usable streams → `pitch_agreement_state='insufficient_evidence'`, block publication until reviewed or more evidence arrives.
5. Customer-ready gate: all persisted facets must have pitch agreement state in `{high, medium}`.
6. Failed pitch runs render visual QA overlays, not sellable customer reports.

**Out of scope**
- Vendor benchmark/runtime comparison.
- Training on vendor PDFs or vendor report diagrams.
- UNet training/deployment (PR #6).
- Global topology self-consistency score across all evidence layers (PR #7).
- Sellable PDF layout polish (PR #8).

---

### Technical changes

**Database**
- Extend `roof_measurement_facets`:
  - `pitch_dsm_deg double precision`
  - `pitch_solar_deg double precision`
  - `pitch_streetview_deg double precision`
  - `pitch_dsm_rise_over_12 double precision`
  - `pitch_solar_rise_over_12 double precision`
  - `pitch_streetview_rise_over_12 double precision`
  - `pitch_consensus_rise_over_12 double precision`
  - `pitch_agreement_state text` (`high | medium | low | insufficient_evidence`)
  - `pitch_source_final text` (`dsm | solar | streetview | consensus | unavailable`)
  - `pitch_confidence text` (`high | medium | low`)
  - `pitch_verification_json jsonb`
- Extend job/measurement summary rows with `pitch_verification_json`, `pitch_self_consistency_score`, and `pitch_verification_status` for dashboards and report gating.
- Add `pitch_visual_cross_checks` for visual edge-angle evidence and deltas.

**Shared helpers**
- `supabase/functions/_shared/pitch/dsm-plane-fit.ts`
  - Samples DSM points inside a facet polygon.
  - Runs deterministic RANSAC plane fit.
  - Reports plane normal, pitch degrees, rise/12, RMSE, median/max residual, inlier count, and status.
- `supabase/functions/_shared/pitch/streetview-edge-angle.ts`
  - Fetches/records closest pano metadata and converts corrected edge angle into rise/12.
  - Missing pano is `unavailable`, not a confidence downgrade by itself.
- `supabase/functions/_shared/pitch/consensus.ts`
  - Scores DSM/Solar/Street View agreement per facet.
  - Produces final pitch source and agreement state.

**Gate integration**
- `assertCustomerReportReady()` gains facet pitch agreement requirement.
- `normalizeResultStateForWrite('pitch_disagreement')` resolves to the existing canonical bucket `ai_failed_pitch` while preserving the raw failure reason in `hard_fail_reason` / `geometry_report_json`.
- `validate_geometry` requires `pitch_results` to carry a self-consistency score ≥ 0.90.

**Frontend**
- `MeasurementReportDialog`: per-facet pitch row shows DSM, Solar, and Street View values plus agreement badge.
- Failed runs render perimeter/facet overlay with pitch-disagreement highlights instead of a customer-ready report.

---

### Acceptance criteria

- Every customer-ready facet has `pitch_agreement_state in ('high', 'medium')`.
- `pitch_disagreement` hard-fails to canonical `result_state='ai_failed_pitch'`.
- No runtime code path reads vendor reports or `roof_measurement_benchmarks` for pitch confidence.
- Fonsica fixture: ~6/12 agreement across DSM/Solar/visual streams → high.
- Wrong-topology fixture: DSM disagrees with Solar/visual by more than ±1/12 → hard fail.
- Reports show pitch agreement badges and never display low/insufficient facets as sellable.

---

### Build order

1. Migration: facet-level pitch evidence fields + visual cross-check table.
2. `dsm-plane-fit.ts` helper + tests.
3. `consensus.ts` helper + tests.
4. Street-facing visual edge-angle helper + metadata persistence.
5. Wire pitch consensus into `calculate_pitch` / `validate_geometry` artifacts.
6. Add customer-ready gate and report UI.

Start now with migration + `dsm-plane-fit.ts`.
