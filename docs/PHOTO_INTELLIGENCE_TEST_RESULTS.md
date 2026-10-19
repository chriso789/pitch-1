# Photo Intelligence Test Results

## Canvass review integration — 2026-10-19
- Property and Storm Canvass galleries open a selected-photo inspection queue. Source cards distinguish unverified rep observations, inspector status and predictions (not run); approved canvass counts separate roof systems and five condition kinds.
- Captures no longer stamp pixels. GPS, capture time, employee, property/address, category and notes remain metadata; source registration references the private original bucket without copying. Known roof type is not fabricated (source roofType remains null until an inspector assigns the system).
- Content-addressed upload IDs recover partial/repeated uploads. Failed offline records remain indefinitely; only the selected company and employee queue is drained. Registration failure retains uploads for retry.
- Trusted registration hashes stored bytes and reads image dimensions, validates tenant/property membership, records audit events and is service-only at the SQL boundary. Independent inspector approval remains mandatory; rep categories never create training labels. Existing label corrections still need fresh second-inspector approval.
- New dataset snapshots preserve source-bucket metadata, reject duplicates/property leakage and exclude uncertain/not-assessable classes from COCO learning. Referenced source objects and ownership cannot be overwritten/deleted by authenticated users. Security helper implementation lives in a private schema with an invoker wrapper. Applied SQL is recorded in `canvass-training-schema.sql`.
- Verification: 72 Photo Intelligence JS tests passed; four Deno intake/hash/auth/preflight tests passed; isolated synthetic Postgres approval/isolation/dedup/provenance tests passed. Portable image metadata reader replaced incompatible ImageScript. Harness build OK. Registration function deployed; anonymous live request returns 401.
- **Not accepted end-to-end:** real signed-in capture → inspector label → second-inspector approval → dataset export is unavailable for this external unmanaged Supabase project. Browser review URL redirected to sign-in. No real customer accuracy, trained model, paid service, automatic inference or publication. GitHub synchronization remains platform-managed and unconfirmed. Existing condition model evaluation/promotion hardening still needs staging approval; intake changes do not certify that registry.

## 2026-10-19 — Balanced roof conditions
- `bun run test -- src/lib/photo-intelligence/training/conditions.test.ts src/lib/photo-intelligence/photo-intelligence-training.test.ts tests/unit/photo-intelligence-*.test.ts`: **9 files, 64 passed, 0 failed** (57 existing plus 6 condition rules and 1 balanced-report evidence rule).
- `/tmp/pitch-condition-venv/bin/python -m unittest worker.tests.test_damage_training`: **5 passed**. Local CPU trained/resumed the synthetic small backbone, retained held-out-only output, independently approved originals, normal targets and uncertainty exclusions. No paid computer or model license purchased. Isolated temporary CPU dependencies installed.
- Conditions tests: six-system class acceptance, normal shadows/mortar maintenance, uncertainty not background, small internal experiments without production approval, no-concern consistency, false defects on normal photos, missed broken tiles, and review-only metric exclusion.
- Report test: normal, maintenance and not-assessable never count as damage; all require original evidence.
- Running app route `/photo-intelligence/training` redirects to `/login`; screenshot confirms sign-in screen. **Authenticated labeling/review/save/export/registry and two-company isolation not tested.** No real accuracy score exists.
- SQL class whitelist expanded; no RLS changed, but prior staging approval was not obtained. Remaining SQL hardening is documented, not deployed. 241 pre-existing linter findings reported, not triaged as part of this condition task.
- Material/component recognition, polygon segmentation accuracy, customer-photo training, native/ONNX parity and production switch remain unverified. Current local metric is bounding-box IoU.
- Local CLI exercised end-to-end on a synthetic trained checkpoint's held-out predictions: 1 test photograph evaluated; no production approval. Final regression rerun: 64 passed; harness build OK.
- GitHub API read: remote `chriso789/pitch-1` main `c8f22b35b651668bd4d0ce1e70139c7803d9d6fe`, dated 2026-10-18T17:42:37Z; local observed revision `db1e4ef9f50425d8605b88fe49d803140b39b36c`. Current changes are **not confirmed synchronized**. No manual git push performed.

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

## 2026-10-19
102 Photo Intelligence unit tests pass (synthetic data only). Live data: 457 photos, 41 properties, 3 companies, 0 labels, 0 approved examples. No real-photo accuracy or timing measured.
Blocked test: open Training → Reference library as inspector A, Propose outlines on a recommended photo, assign types, save; sign in as inspector B, approve; Evaluate on held-out properties.

## 2026-10-19 (execution workflow)
Added saved quality/duplicate results, saved outline batches (10 at a time, timed), and server-checked review (approve / reject with reason / request correction, history logged, no self-review). Processing has NOT been run on real photos: it runs in a signed-in inspector's browser under their own permissions, and no session is available in the build environment. Live counts: 457 photos, 0 checked, 0 outlines, 0 labels.
