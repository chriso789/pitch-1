## PR #5 — Self-Consistent Pitch Verification

Goal: every reported pitch must agree across three independent evidence streams (DSM plane-fit, Solar API, Street View edge-angle) or it is downgraded / blocked from the customer report. This is the prerequisite for PR #6 (self-distilled UNet) and PR #7 (self-consistency gate).

---

### Scope

**In scope**
1. Per-facet DSM plane-fit pitch (RANSAC on DSM points inside facet polygon).
2. Per-facet Solar `roofSegmentStats.pitchDegrees` lookup (already fetched in PR #4 evidence acquisition).
3. Per-facet Street View edge-angle pitch (pano fetch → rake/eave edge detection → projected pitch).
4. Three-way agreement scorer → `pitch_agreement_state` per facet.
5. Customer-report gate: any facet with `pitch_agreement_state='low'` blocks `customer_report_ready`.
6. Regression fixtures: Fonsica (must pass `high` at ~6/12); synthetic disagreement fixture (must hard-fail).

**Out of scope (later PRs)**
- UNet training (PR #6)
- Self-consistency score across whole roof (PR #7)
- Sellable PDF report layout (PR #8)

---

### Technical changes

**Database (one migration)**

`roof_measurement_facets` additions (all `IF NOT EXISTS`):
- `pitch_dsm_deg numeric`
- `pitch_solar_deg numeric`
- `pitch_streetview_deg numeric`
- `pitch_agreement_state text` — `high | medium | low | insufficient_evidence`
- `pitch_source_final text` — `dsm | solar | streetview | consensus | none`
- `pitch_consensus_deg numeric`

`ai_measurement_jobs` / `measurement_jobs`:
- `pitch_verification jsonb` — per-facet rollup `{ facet_id, dsm, solar, streetview, agreement, final_deg, final_source }[]`
- Extend `result_state` normalizer mapping (NOT the CHECK constraint) to map `pitch_disagreement` → `ai_failed_pitch`.

Trailing `NOTIFY pgrst, 'reload schema';`.

**Shared helpers (`supabase/functions/_shared/pitch/`)**
- `dsm-plane-fit.ts` — RANSAC plane through DSM points inside a facet polygon → slope deg → rise/12.
- `solar-pitch-lookup.ts` — nearest-segment match from cached Solar response.
- `streetview-edge-angle.ts` — Street View Static API pano fetch + Hough rake-edge detection + horizon-relative angle → pitch deg.
- `consensus.ts` — three-way agreement scorer (±1/12 tolerance) returning `{ state, final_deg, final_source }`.

**Edge-function changes**
- `start-ai-measurement`: after geometry passes the six contracts, run `verifyPitchPerFacet()` → persist `pitch_*_deg`, `pitch_agreement_state`, `pitch_source_final` on each facet; persist `pitch_verification` rollup on the job.
- `assertCustomerReportReady()`: add gate — any facet `agreement_state='low'` → `block_customer_report_reason='pitch_disagreement'`, `result_state=ai_failed_pitch`.
- Strip-and-retry wrapper covers the new diagnostic columns (PR #4 contract).

**Frontend**
- `MeasurementReportDialog`: per-facet pitch row showing DSM / Solar / Street View values + agreement badge (green/amber/red).
- Blocked runs render red-highlighted disagreement facets with the three values side-by-side.
- `DSMDebugOverlay`: add "Pitch Verification" section.

**Secrets**
- `GOOGLE_STREETVIEW_API_KEY` (needed for pano fetch; if absent, Street View stream returns `insufficient_evidence` and the gate degrades to two-source consensus instead of hard-failing).

**Regression (per skill: ai-measurement-regression-harness)**
- `supabase/functions/start-ai-measurement/__tests__/fonsica-pitch-consensus.test.ts` — expects `agreement_state='high'`, `final_deg≈26.57` (6/12), `final_source='dsm'`.
- `supabase/functions/_shared/pitch/__tests__/consensus.test.ts` — unit table covering the agreement matrix.
- Synthetic disagreement fixture (`_shared/__fixtures__/pitch-disagreement.json`) — must produce `result_state='ai_failed_pitch'`, `customer_report_ready=false`.

---

### Acceptance criteria

- Every facet on a passing job has all three of `pitch_dsm_deg`, `pitch_solar_deg`, `pitch_streetview_deg` populated OR `pitch_agreement_state='insufficient_evidence'` with a documented reason.
- Fonsica regression test passes (`high` agreement, 6/12, source=`dsm`).
- Synthetic disagreement fixture hard-fails with `result_state='ai_failed_pitch'`.
- No new value added to the `result_state` CHECK constraint — only the normalizer mapping is extended.
- `pitch_verification` JSON is never null on jobs that reach `customer_report_ready=true`.
- Existing six-contract + four-hard-gate behavior unchanged.

---

### Build order

1. Migration (facet columns + job JSON + `NOTIFY pgrst`).
2. `consensus.ts` + unit tests (pure function, fastest signal).
3. `dsm-plane-fit.ts` + `solar-pitch-lookup.ts` + `streetview-edge-angle.ts`.
4. Wire `verifyPitchPerFacet()` into `start-ai-measurement` after contract gates.
5. Extend `assertCustomerReportReady()` + `normalizeResultStateForWrite()` mapping.
6. Frontend per-facet pitch panel.
7. Fonsica + synthetic regression tests.

After PR #5 lands, next is PR #6 — Self-Distilled UNet (use high-confidence consensus facets as training labels).

---

Approve and I'll start with the migration.
