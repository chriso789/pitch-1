# Photo Intelligence Test Results

## 2026-10-17 — Phase 1 (data model)
- Migration applied: `photo_findings`, `photo_finding_evidence`, `photo_finding_reviews` with tenant RLS and grants.
- Trigger tests (approval guard, measurement-source guard): pending — run against DB with test accounts.
- Recognition engine tests: none — no model exists yet. Do not report detection capability.
- Cross-company isolation tests: pending (requires two test tenants + users).

## Acceptance targets (from plan; NOT yet measured)
- Structural/material classification ≥95% accuracy (held-out labeled set)
- Major visible damage recall ≥90%; auto-proposal precision ≥90%
- Building/finding association ≥98%
- 100% of estimate quantities have approved measurement source
- 100% of published findings human-reviewed; 100% originals preserved
