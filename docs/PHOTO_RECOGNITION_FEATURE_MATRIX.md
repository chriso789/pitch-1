# Photo Recognition Feature Matrix

## Canvass review integration — 2026-10-19
- Property and Storm Canvass galleries open a selected-photo inspection queue. Source cards distinguish unverified rep observations, inspector status and predictions (not run); approved canvass counts separate roof systems and five condition kinds.
- Captures no longer stamp pixels. GPS, capture time, employee, property/address, category and notes remain metadata; source registration references the private original bucket without copying. Known roof type is not fabricated (source roofType remains null until an inspector assigns the system).
- Content-addressed upload IDs recover partial/repeated uploads. Failed offline records remain indefinitely; only the selected company and employee queue is drained. Registration failure retains uploads for retry.
- Trusted registration hashes stored bytes and reads image dimensions, validates tenant/property membership, records audit events and is service-only at the SQL boundary. Independent inspector approval remains mandatory; rep categories never create training labels. Existing label corrections still need fresh second-inspector approval.
- New dataset snapshots preserve source-bucket metadata, reject duplicates/property leakage and exclude uncertain/not-assessable classes from COCO learning. Referenced source objects and ownership cannot be overwritten/deleted by authenticated users. Security helper implementation lives in a private schema with an invoker wrapper. Applied SQL is recorded in `canvass-training-schema.sql`.
- Verification: 72 Photo Intelligence JS tests passed; four Deno intake/hash/auth/preflight tests passed; isolated synthetic Postgres approval/isolation/dedup/provenance tests passed. Portable image metadata reader replaced incompatible ImageScript. Harness build OK. Registration function deployed; anonymous live request returns 401.
- **Not accepted end-to-end:** real signed-in capture → inspector label → second-inspector approval → dataset export is unavailable for this external unmanaged Supabase project. Browser review URL redirected to sign-in. No real customer accuracy, trained model, paid service, automatic inference or publication. GitHub synchronization remains platform-managed and unconfirmed. Existing condition model evaluation/promotion hardening still needs staging approval; intake changes do not certify that registry.

## Current condition update — 2026-10-19
| Condition capability | Status | Evidence / limitation |
|---|---|---|
| Balanced taxonomy and condition labels | implemented | `training/taxonomy.ts`, editor condition controls; normal groups, defects, maintenance, uncertainty |
| Bulk normal region assignment and uncertainty review | partial | Editor and queue implemented; authenticated save/review unverified |
| Normal versus damage approved examples/counts | implemented | Training readiness, distinct approved photos per class |
| Small local CPU experiments | implemented | TorchVision synthetic train/resume tests: 5 passed; not actual tile-photo learning |
| Safe uncertainty exclusions | partial | COCO, worker and local evaluator enforce; SQL dataset/evaluation still pending staging |
| Condition/normal false-positive evaluation | implemented | Local `evaluation.ts` and CLI; bbox metrics, not polygon accuracy |
| Balanced evidence-backed report sections | partial | Model/preview/PDF plus evidence test; authenticated real-file acceptance pending |
| Material→component→condition staged recognizer | not-started | Current experimental detector is joint, no trained material/component stages |
| Model activation / real accuracy | blocked | Approved originals, independent unseen-property tests, staging SQL and model parity missing |

Historical entries below do not establish current live model capability. No external inference was used in this update; no model installed or app published.

Status: implemented | partial | blocked | not-started

| Feature | Status | Notes |
|---|---|---|
| Findings data model (IDs, building, component, condition, confidence, review status) | implemented | `photo_findings` migration; tenant RLS |
| Evidence links (many photos per finding, editable annotation JSON) | implemented | `photo_finding_evidence`; originals immutable |
| Review history + human-approval gate | implemented | `photo_finding_reviews` + `photo_finding_approval_guard` trigger |
| Measurement source required for quantities | implemented | trigger blocks quantity without source |
| Building/component detection | partial | POC adapter built (2026-10-17, `providers/aiImageAnalyzerProvider.ts`) over the existing `ai-image-analyzer` edge function (gpt-4o-mini, existing key — no purchase); no live model call made yet |
| Defect detection (missing shingles/tabs, creased/lifted, underlayment, ridge caps/vents, siding, wrap, sheathing, debris, metal) | not-started | taxonomy defined from Navarre report; current analyzer returns text-only insights without coordinates, so per-defect placed detections need either a prompt/contract change on `ai-image-analyzer` or a segmentation model (no purchase without approval) |
| Damage segmentation polygons | partial | Editor wired into review UI; geometry-only saving; no verified model segmentation |
| Cross-photo grouping / dedup | partial | Inspector-verified physical identities only; matching categories do not merge distinct damage |
| Inspector review workspace UI | partial | Existing accept/reject/close-up and annotation editing; signed-in persistence acceptance pending |
| Report builder integration | partial | Programmatic Unicode PDF exporter, selected approved snapshot, company branding, pagination, annotated photos, traceable originals appendix; real-file/signed-in acceptance pending |
| Aerial building overview | partial | Editable numbered image-relative callouts and attribution in report versions; actual Navarre imagery missing |
| Estimating integration | not-started | approved findings + validated sources only |
| Benchmarking dataset/metrics | partial | Independent IoU/category + pairwise physical-identity metrics implemented; real reviewed dataset missing; masked/annotated images exploratory only |
| "No visible damage" documentation | implemented | Separate no-damage records retain evidence IDs/photos; missing originals block export |

Live recognition remains BLOCKED on suitable originals, auth session, coordinate-response contract and verified service dispatch/authorization repairs. No new model or paid service selected. Report-generation acceptance and independent-recognition acceptance remain separate.

## Update 2026-10-17 — Photos-tab AI Analysis wiring (Phases 2 + 3 integration)
- Photos tab now has an "AI Analyze" action that opens Photo Intelligence scoped to the current lead/project/contact photos (`PhotoControlCenter.tsx` → `/photo-intelligence?leadId|projectId|contactId`).
- Review page (`PhotoIntelligenceReviewPage.tsx`) loads the record's photos, supports per-photo selection or Analyze All, shows live progress/errors, skips already-analyzed photos, and persists findings as detection_source=ai / review_status=pending linked to the project.
- Orchestration in `src/lib/photo-intelligence/analyzePhotos.ts`; findings may now carry `project_id`/`job_id` via `persistProposals` opts.
- ai-api routing repaired: `serveRouter` dispatch, `/image/analyze` now behind requireAuth + requireTenant (verified live: 401 without/with invalid token); `x-pitch-tenant` accepted as tenant header (validated against user access).
- Analyzer handler now requests JSON output, prompts for mandatory normalized coordinates + confidence, and sanitizes detections server-side: only model-supplied in-bounds bbox/polygon geometry is kept; nothing is fabricated or clamped into place.
- Adapter maps structured `detections` (bbox/polygon, damage category, confidence, no_visible_damage flag); coordinate-less candidates are rejected downstream with reasons.
- Tests: 7 adapter tests + 18 recognition/findings/report tests pass. Signed-in end-to-end run with a real photo remains PENDING (no session can be minted for this user-managed backend); Navarre reference demo still BLOCKED on the actual 19-page PDF.

## Update 2026-10-17 — Test count reconciliation
Full Photo Intelligence run (`npx vitest run tests/unit/photo-intelligence`): 7 files, 51 passed, 0 failed, 0 skipped.
- annotations 18, recognition 8, provider-adapter 7, report 6, findings 4, benchmark 4, pdf 4.
- The earlier "49" was the full suite before 2 adapter tests were added; the "25" was a subset (adapter 7 + recognition 8 + report 6 + findings 4) — annotations, benchmark and pdf were not run that time.
- Still not run: signed-in live analysis on a real photo, coordinate-overlay check, damaged/undamaged recognition benchmark. Navarre 19-page PDF still not in project uploads.

## Update 2026-10-17 — Self-hosted engine direction
- Live run on 16 tile-roof photos: all 16 rejected by OpenAI ("no credits remaining"); the UI wrongly said "no damage". Fixed: service failures now show as errors.
- Decision: PITCH owns recognition; no OpenAI/Lovable AI per photo. App analysis is switched off until the engine has validated weights.
- Built: worker `/vision/detect-damage` (ONNX Runtime, local weights, returns `model_not_trained` + zero detections without weights). Classes include cracked/displaced tile.
- Next (unblocked): labeling export/import (CVAT format), dataset split tooling, training script (open-source detector), benchmark wiring. Blocked: labeled originals, worker hosting/GPU approval.

| Feature (2026-10-19) | Status |
|---|---|
| Automatic outline proposals (SAM 2.1 Tiny, local) | Built, unverified on real photos |
| Similar-region grouping (DINOv2) | Built |
| Component vs condition labels kept separate | Built |
| Held-out property evaluation (3-way) | Built; experimental under 5 test properties |
| Reviewer reject + version history | Blocked — needs approval-rule change |
| Peak memory measurement | Not built (browser API unreliable) |
