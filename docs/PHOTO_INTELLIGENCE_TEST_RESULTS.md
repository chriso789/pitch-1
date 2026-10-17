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

## 2026-10-17 — Phase 3 + Phase 6 + Phase 2 interface (sandbox)
- `photo-intelligence-annotations.test.ts`: 18/18 passed — geometry validation, polygon vertex edit/insert/delete, hit-testing, translation clamping, callout numbering, undo/redo, geometry-only JSON round-trip (asserts no image bytes are stored).
- `photo-intelligence-report.test.ts`: 6/6 passed — unapproved findings block report; severity sorting; no-damage areas separated; untraceable-photo detection; finding→photo traceability; approval metadata never assumed.
- `photo-intelligence-recognition.test.ts`: 8/8 passed — pixel→normalized conversion, forced ai/pending provenance, rejection reasons, confidence clamping, cross-photo grouping, stub provider end-to-end. NOTE: stub provider only — no real vision model has been run; no detection capability is claimed.
- Build: OK. Signed-in save/cross-company tests: still pending (no test accounts).

## 2026-10-17 (later) — Review-workspace wiring + report preview
- Annotation editor wired into `/photo-intelligence`: evidence thumbnails per finding, "Annotate" opens the editor, saves geometry-only JSON to `photo_finding_evidence.annotation` (source 'manual').
- Report preview at `/photo-intelligence/report`: composes from approved findings only; export blocked until an approved version exists; every save is a new immutable version in `photo_intelligence_reports` (tenant RLS, unique tenant+project+version).
- Build OK after import fix (useAuth from contexts/AuthContext).
- All Photo Intelligence unit tests still green (32+ earlier batches). Signed-in save/cross-company checks: still pending test accounts.

## 2026-10-17 (POC adapter) — Phase 2 controlled POC
- `photo-intelligence-provider-adapter.test.ts`: 5/5 passed — adapter for the EXISTING ai-image-analyzer (gpt-4o-mini, existing key, no purchase). Coordinated insights → ai/pending proposals; coordinate-less observations are rejected with an explicit reason and a warning (geometry is never invented); request failures surface as warnings, never throws.
- No live model call has been made. A real POC run still needs a signed-in session and sample photos.
