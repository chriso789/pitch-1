# Roadmap

## Real-photo acceptance execution (2026-10-21)
- [x] Repair preview ONNX binary loading shown by user's ten-photo run (9 execution failures, 1 dark/unassessable; all ten report verified saves). Version-matched runtime binary is hosted via an asset pointer, never source-imported or committed as an oversized binary; browser-only initialization. Real-photo rerun still requires signed-in user acceptance; no prior results replaced or website published
- [x] Implement private fixed-selection browser history, transactional idempotent saves/read-back, per-photo resolution/outline/failure evidence and selectable overlays; API/DB block batches over ten; 11 simulated regressions pass, signed-out route redirects, new private table/RPC deny app roles
- [ ] Publish only after signed-in real-photo staging acceptance; verify GitHub sync and deployment — BLOCKED: external unmanaged authentication prevents signed-in testing here; grouped result API deployed, website not published; latest observed checkpoint 2656747c47f6cf2c39eb9744f9f8e392864dfdce, remote GitHub sync unverified
- [x] Deployed binary assets verified on production and preview; production browser DINOv2/SAM executed successfully on synthetic texture (execution evidence only); restored separate bounded ten-photo browser action and per-photo results
- [x] Audited central executor integration: authenticated pull runner exists; no verified centrally deployed process/scheduler. Recommended authorized container/CPU scheduled runner; no purchases or provisioning
- [ ] Process 10 eligible CRM originals in signed-in developer browser; background hosting must not block browser testing; verify saved outlines and timings
- [ ] Independently label/review useful components and verify approved-only, currently consented shared publication — BLOCKED: external unmanaged authentication unavailable here; requires two authorized inspectors, never agent-fabricated approval
- [ ] Benchmark on properties excluded from references; report measured precision, recall, unknowns and timings — requires independently approved reference/test labels and executed inference
- No additional infrastructure, synthetic accuracy claims, purchases or customer deployment in this phase

## GitHub Photo Intelligence gap closure (2026-10-21)
- [x] Refresh live counts: 457 photos; 234 consented, 1 company, 11 properties; 0 processed/approved/models. Eight legacy 501 routes have no identified callers
- [x] Durable queue/API and bounded local CPU runner implemented; database leases, retries, cancellation and saved progress; hosting not operationally verified
- [x] Shared approved-reference publisher and anonymous-handle inference distribution; direct private provenance reads revoked; no approved references yet
- [x] 20 JS and 5 Python tests pass (synthetic); live SQL privilege/unsigned checks pass; invalid API calls return 401/403; preview build OK. Report: docs/PHOTO_INTELLIGENCE_GAP_CLOSURE.md
- [ ] Queue transaction/signed-in flow — BLOCKED: no developer session or verified central executor. Browser ten-photo path is independent and assets execute on deployed origin; customer-photo save/read-back remains unverified here
- [ ] Approved-data training, held-out accuracy, compatible export and installed-weight activation/rollback — BLOCKED: independently approved representative data and real checkpoint unavailable
- [ ] Remote GitHub verification — BLOCKED: API credentials rejected; observed platform-managed checkpoint 031bcb9b9cf6f13a47dec4d804808d3f78f975af

## Canvass pins → Contacts and reopen (2026-10-20)
- [x] Add Customer saves/reuses a linked Contact in the selected company/location; confirms saved link and refreshes map without moving the pin
- [x] Both map providers page saved manual/marked/CRM-linked pins separately from limited parcel previews; 13 regression checks pass; preview build OK
- [ ] Signed-in placement → CRM → reopen acceptance — BLOCKED: external Supabase session unavailable here

## Manual house pins (2026-10-20)
- [x] Repair Drop Pin saving and selected-company handling; retain chosen house coordinates
- [x] 13 pin/dialog/access regressions; deployed grouped route and legacy shim reject invalid tokens with 401
- [ ] Signed-in Chris pin placement/read-back — BLOCKED: external Supabase session unavailable here

## Existing CRM photo inventory (2026-10-20)
- [x] Refresh inventory: 457 customer photos, 41 properties, 3 companies; 234 consented photos, 11 properties, 1 company; 47 other image records
- [x] Add property-diverse up-to-100 selection, consent refresh, protected original access and saved local quality/DINOv2/SAM preparation
- [x] Developer-only inventory/report; original records remain private; unverified outlines use existing Reference library review controls
- [x] 16 consent/diversity/geometry/run-status tests; unsigned inventory/batch/save return 401; preview build OK
- [ ] Execute real-photo preparation and signed-in cross-company acceptance — BLOCKED: external unmanaged Supabase has no developer session here; 0 processed/regions/approved examples
- [ ] Additional-company contribution — BLOCKED: 2 photo-owning companies have no current contribution consent

## Canvass → Photo Intelligence
- [x] Zero-copy candidates, preserved source metadata, hash deduplication and retry-safe offline uploads
- [x] Gallery inspection actions, unlabeled review queue and approved canvass counts
- [x] Independent approval/training eligibility tests and tracking documents — 72 JS, 4 Deno, isolated SQL passed; intake deployed; anonymous 401; real-user acceptance pending
- [ ] Signed-in two-inspector acceptance — BLOCKED: external Supabase session unavailable
- [ ] GitHub commit/sync confirmation — BLOCKED: Git state managed by platform

## Homeowner lookup
- [x] Restore missing Storm lookup service; remove duplicate/speculative warning; selected-company checks; 5 authorization tests passed; deployed legacy endpoint rejects invalid tokens with 401
- [ ] Signed-in homeowner lookup/provider results and switched-company cache persistence — BLOCKED: external managed account unavailable; cache schema/policy fixes need staging and approval

## JAE Enterprise menu
- [x] Restore JAE Storm Canvass switch; verify saved access and platform flag; selected-company hook regression tests: 3 passed
- [ ] Signed-in JAE menu verification — BLOCKED: external Supabase session unavailable in this sandbox

## Security (pending)
- [ ] Two-company isolation tests — BLOCKED: no test-company credentials
- [ ] 268 DB warnings severity triage — in progress
- [ ] Vulnerable deps (PDF/formula/canvas/pdfjs) — needs regression tests
- [ ] Claude Code security review — runs in user's GitHub repo

## Photo Intelligence (current)
- [x] Expand condition taxonomy/editor, bulk normal regions, uncertainty queue and approved normal/damage dashboard; authenticated acceptance pending
- [x] Extend local dataset/export/CPU experiments and independent condition evaluation; 64 JS and 5 CPU tests passed, synthetic only
- [x] Balance reviewed report model/preview/PDF and update four tracking documents
- [ ] Condition dataset/evaluation SQL and server promotion hardening — BLOCKED: staging verification/approval; whitelist expansion applied without staging, no RLS changed
- [ ] Material/component staged training, automatic suggestions and native/ONNX parity — BLOCKED: independently approved representative component/material data and validated weights
- [ ] Real approved clay-tile training/accuracy and signed-in acceptance — BLOCKED: approved originals from multiple properties and authenticated session unavailable
- [ ] M1/M2/M3 signed-in labeling, dataset and model registry acceptance — BLOCKED: authenticated account unavailable; software exists, condition SQL staging incomplete
- [x] Local CPU train/resume, balanced targets, held-out export and evaluation CLI exercised on synthetic originals; 5 CPU tests passed
- [x] Four Photo Intelligence tracking documents updated
- [ ] GitHub sync — BLOCKED: remote main c8f22b35b651668bd4d0ce1e70139c7803d9d6fe (2026-10-18T17:42:37Z) differs from local observed db1e4ef9f50425d8605b88fe49d803140b39b36c; automatic synchronization not confirmed
- [x] P1: AI Analyze button on Photos tab → Photo Intelligence in record context, select/Analyze All, progress, dedupe
- [ ] P2: Unify Standard vs AI report types under View/Export/Email Report
- [x] P3: Live AI recognition repaired (ai-api routing + auth + tenant header; coordinate-bearing detections; server-side sanitization; no fabricated geometry)
- [ ] P4: Navarre demo — BLOCKED: actual 19-page PDF not uploaded here
- [x] P5: In-tab review workflow (findings + evidence + annotations on review page; deeper in-tab editing polish still open)
- [x] P6: Tests (25 passing) + 4 tracking docs updated
- [ ] Signed-in end-to-end analysis run with a real photo — BLOCKED: backend is user-managed, no session can be minted here; must be tested in the preview signed in

## First real model milestone (2026-10-19)
- [x] Training readiness per roof type: normal, damaged, maintenance, uncertain, difficult look-alikes, unique properties
- [x] Clay/concrete tile normal-vs-damaged target with readiness blockers (30 approved/class, 3 properties/class)
- [ ] Real training + held-out evaluation — blocked: 0 canvass photos, 0 labels, 0 approvals in live data
- [ ] Authenticated cross-company tests — blocked: no test sign-in available in this environment
- [ ] Recognition stays off until a real trained model passes acceptance

## Component recognition milestone (2026-10-19, uploaded spec)
- [x] Phase 1: pretrained model + weight-license audit — docs/PHOTO_COMPONENT_MODEL_AUDIT.md; chosen: DINOv2-S (Apache-2.0), SAM 2.1 Tiny (Apache-2.0), RoofSense (MIT/CC-BY-4.0); held out: YOLO (AGPL), SegFormer (noncommercial), torchvision weights (uncleared)
- [~] Phase 2: DINOv2-Small + SAM 2.1 Tiny (encoder+decoder) installed, license-audited (Apache-2.0), executed end-to-end via the app's onnxruntime-web on synthetic texture (2 stable regions)
- [~] Phase 3: anomaly-to-SAM-region matching (evidence wording only) + DINOv2 self-similarity note wired into analysis; 22 tests pass. Named components still BLOCKED: no verified semantic head; masks stay 'unknown' until a classifier is validated on real approved photos
- [ ] Phase 3: component-aware anomaly comparison (similar components only; shadows/leaves/variation suppressed; anomalies never auto-confirmed)
- [ ] Phase 4: real-photo benchmark (damaged/undamaged/shadowed, property-separated, independent labels; no synthetic accuracy claims)
- [ ] Phase 5: findings show component + condition + evidence + verification status; inspector confirm/correct feeds approved dataset only
- [ ] Acceptance: 3-photo test (intact tile / damaged tile / shadowed) — no real photos uploaded here yet

## Reference-based component recognition (2026-10-19, uploaded spec Phases 1–6)
- [x] Phase 1 classifier: `components/referenceClassifier.ts` — cosine-similarity over DINOv2 embeddings, dual thresholds (min similarity + margin), hard negatives as first-class classes, else `unknown` with no confidence; provenance-enforced `addApprovedExample`
- [x] One DINOv2 pass per image: `components/regionEmbedding.ts` — 16×16 patch features, polygon-centre pooling, content-hash LRU cache (32); reused for similarity + classification
- [x] DB: `photo_reference_examples` (platform-global, versioned, JSONB embedding, CHECK labeler≠approver; read=authenticated, write=platform admin via `is_platform_admin`)
- [x] Learning loop: `promoteCorrectionToReference` — only after independent approval; unverified predictions never enter; write path platform-admin gated by RLS
- [x] Wiring: analyzePhotos runs pattern analysis first, DINOv2/SAM only when anomalies exist; classified regions keep evidence wording "algorithmic observation, not a diagnosis"; never upgraded to damage
- [x] Benchmark: `scoreComponentClassification` in benchmark.ts — per-class P/R, macro P/R, unknown-rejection (correct vs missed components), marked `experimental_reference` separate from damage metrics; requires reviewed unannotated originals
- [x] Tests: 14 new (classifier, pooling, hashing, learning-loop gates, benchmark) — synthetic embeddings only, no real-photo accuracy claims
- [ ] Threshold validation on real photos — BLOCKED: reference library is empty (0 approved examples); defaults 0.62/0.05 are unvalidated
- [ ] Phase 2 condition analysis per component (broken/missing tile, displaced components vs normal exemplars) — BLOCKED: needs validated component labels first
- [ ] Phase 3 perf: benchmark decode/embed/segment/classify timings; embedding reuse done; target <5s/photo — BLOCKED: browser model verification blocked by dev-server asset quirk; timings known only from synthetic runs
- [~] Phase 4 real-photo benchmark harness: `photo_benchmark_sets`/`photo_benchmark_items` tables (tenant-scoped, DB-enforced reviewer≠labeler), Benchmark tab on the training page (set creation, original upload with property/material/scene kind, component label editor, independent review, import-predictions scoring with property + scene-kind coverage); 3 harness tests pass. Not yet verified: signed-in upload/review/scoring in the preview (external Supabase, no session here)
- [ ] Phase 5 inspector correction UI feeding `promoteCorrectionToReference` — not wired to review screen yet
- [ ] GitHub sync — BLOCKED: remote/main divergence noted above

## Photo Intelligence — reference data preparation (2026-10-19)
- [x] GitHub: project head matches main 9ad202d0d
- [x] Auto-proposed outlines (SAM) + DINOv2 grouping + bulk assign; suggestions stay in notes, unverified
- [x] Quality/duplicate triage and diverse 100-photo recommendation across properties
- [x] Per-type property counts; bulk approve only checked items, never own labels
- [x] Reference / calibration / test property split; experimental under 5 test properties
- [x] Recognition report: outlines, suggestions + runner-up, unknowns, anomalies, versions, stage timings
- [ ] Real labeling on the 457 photos — needs signed-in inspectors (blocked here)
