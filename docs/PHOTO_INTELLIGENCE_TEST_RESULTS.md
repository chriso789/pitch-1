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

## 2026-10-17 (proposal persistence) — Phase 2→1 bridge
- `persistProposals` in findings.ts: grouped AI proposals become ONE finding per group (detection_source 'ai', review_status 'pending', ai_model_version recorded) with one evidence row per photo and geometry-only annotations (source 'ai'). Approval remains blocked by the DB guard until an inspector approves.
- Build OK; findings tests 4/4 still pass.

## 2026-10-17 (navigation) — sidebar entry
- "Photo Intelligence" added to the sidebar (Camera icon, routes to /photo-intelligence; active-section matcher covers /photo-intelligence/report). Build OK. Full PI suite: 41/41 passed.
- Remaining honest gaps: no live vision-model call has been made; reference demo blocked (Navarre 22-photo PDF not in uploads); signed-in/cross-company tests need test accounts; report PDF is print-based, styled PDF template and site overview map not built.

## 2026-10-17 02:52 UTC — Programmatic PDF, overview, independent scoring
- Complete Photo Intelligence suite: **49 passed, 0 failed** across 7 files. Command: `bun run test -- tests/unit/photo-intelligence-annotations.test.ts tests/unit/photo-intelligence-report.test.ts tests/unit/photo-intelligence-findings.test.ts tests/unit/photo-intelligence-provider-adapter.test.ts tests/unit/photo-intelligence-recognition.test.ts tests/unit/photo-intelligence-pdf.test.ts tests/unit/photo-intelligence-benchmark.test.ts`.
- PDF tests (4): drafts blocked; missing no-damage original evidence blocked; invalid building positions blocked; immutable approved snapshot creates reopenable paginated PDF with embedded subset Unicode font. Font fixture kept under `tests/fixtures/photo-report` with license; no test-only network font download needed.
- Benchmark tests (4): annotated/masked or unreviewed inputs cannot claim independent accuracy; duplicate detections count as false positives; wrong/missing categories as false negatives; hard negatives and empty datasets never imply perfect accuracy; false merges measured independently.
- Existing provider/recognition tests updated: severity does not create confidence; same-category cross-photo detections remain separate unless inspector identity supplied.
- `tests/scanner/security-harness.test.ts`: **1 status test passed, 7 live cases skipped** (not isolation evidence). No authenticated Photo Intelligence checks performed; external unmanaged authentication unavailable.
- Visual QA: six-page synthetic inspection report generated in `/tmp/photo-intel/qa`, every page rendered with `pdftoppm` and inspected. Cover, summary, building map, inventory, annotation overlay and unmarked original appendix present; no clipping/overlap seen. Unicode `Résumé`, version 7 and imported-reference provenance verified by `pdftotext`. Header width fitting added for long names/titles.
- Harness build/typecheck log: build OK following Blob buffer compatibility repair. No manual build/typecheck run.
- Not tested: Navarre reproduction, live model call, genuine precision/recall, authenticated save/export, cross-company isolation, real-device acceptance. No claims inferred from synthetic tests.
- Read-only local revision observed before final documentation edits: `5c80cdc4f100eb5dcb347d242bf8a059831c765f`. This is not proof of remote GitHub main synchronization; automatic sync happens after replies and current-turn final SHA is not yet available.

## Update 2026-10-17 — Photos-tab AI Analysis wiring (Phases 2 + 3 integration)
- Photos tab now has an "AI Analyze" action that opens Photo Intelligence scoped to the current lead/project/contact photos (`PhotoControlCenter.tsx` → `/photo-intelligence?leadId|projectId|contactId`).
- Review page (`PhotoIntelligenceReviewPage.tsx`) loads the record's photos, supports per-photo selection or Analyze All, shows live progress/errors, skips already-analyzed photos, and persists findings as detection_source=ai / review_status=pending linked to the project.
- Orchestration in `src/lib/photo-intelligence/analyzePhotos.ts`; findings may now carry `project_id`/`job_id` via `persistProposals` opts.
- ai-api routing repaired: `serveRouter` dispatch, `/image/analyze` now behind requireAuth + requireTenant (verified live: 401 without/with invalid token); `x-pitch-tenant` accepted as tenant header (validated against user access).
- Analyzer handler now requests JSON output, prompts for mandatory normalized coordinates + confidence, and sanitizes detections server-side: only model-supplied in-bounds bbox/polygon geometry is kept; nothing is fabricated or clamped into place.
- Adapter maps structured `detections` (bbox/polygon, damage category, confidence, no_visible_damage flag); coordinate-less candidates are rejected downstream with reasons.
- Tests: 7 adapter tests + 18 recognition/findings/report tests pass. Signed-in end-to-end run with a real photo remains PENDING (no session can be minted for this user-managed backend); Navarre reference demo still BLOCKED on the actual 19-page PDF.

## Update 2026-10-17 — Training pipeline foundation
- Added `src/lib/photo-intelligence/training/` (taxonomy per roof system, dataset versioning, COCO/YOLO export, COCO re-import, property-grouped split, per-system evaluation with ECE and promotion gates) and `worker/training/train_detector.py` (open-source YOLO-seg, CPU default, checkpoint resume, ONNX export + manifest marked `trained_unvalidated`).
- `npx vitest run` Photo Intelligence: 8 files, 57 passed (51 prior + 6 new), 0 failed.
- Not done yet: database tables + labeling queue UI, dataset dashboard, evaluation CLI wiring, model registry/rollback. No model trained; no infrastructure provisioned.
