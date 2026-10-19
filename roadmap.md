# Roadmap

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
