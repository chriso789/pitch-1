# Photo Intelligence Master Roadmap

## Current condition update — 2026-10-19 (supersedes historical damage-only status)
- Implemented expanded taxonomy across six systems; normal groups, visible defects, maintenance, uncertainty and not-assessable. Label editor has condition buttons, category filtering and bulk-normal-region assignment; independent review retains corrections and an uncertainty queue. Dashboard counts regions and distinct approved photos and shows normal/damage examples side by side.
- Local dataset/export/worker exclude review-only uncertainty from learning and evaluation, retain negatives, enforce independent approval and property splits. Experimental readiness is separate from validation and production. Local CPU TorchVision tests ran successfully without purchased hosting or pretrained weights.
- Balanced approved report model/preview/PDF separate defects, maintenance, visually normal and unassessed observations; every category retains original-evidence gates.
- Local evaluation CLI and tests report normal-photo false positives, missed defects, per-system/per-condition P/R, bbox IoU, calibration and excluded-review counts. This is not polygon segmentation or measured material/component-stage accuracy.
- **Partial:** component-first material→component→condition pipeline is not trained; current experiment is a joint detector. Automatic suggestions remain off without validated PITCH weights. Corrected labels still require fresh second-inspector approval.
- **Persistence limitation:** class-validator SQL was expanded live, without prior staging approval (no RLS changed). Remaining dataset/evaluation SQL hardening is not applied; see `PHOTO_CONDITION_STAGING.md`. Condition results are blocked from registry import/promotion in the UI until staging acceptance; this is not a substitute for server hardening.
- **Blocked:** real 16-photo training/analysis and accuracy need actual originals, independent labels, unseen properties and an authenticated account. GitHub synchronization is unverified. Nothing published or worker-installed.
- 64 Photo Intelligence tests and 5 local CPU tests passed; CPU tests use synthetic images, not customer recognition evidence.

Reference benchmark: 7552 Navarre Parkway Storm Damage Photo Report (19 pages, 22 photos). Used as taxonomy/quality benchmark only, never as ground truth or branding source.

## Phases
- [x] Phase 1 — Audit existing photo systems + findings data model (this file; `photo_findings`, `photo_finding_evidence`, `photo_finding_reviews` tables with tenant RLS + human-approval trigger)
- [~] Phase 2 — Recognition engine: model-independent interface built (2026-10-17, `src/lib/photo-intelligence/recognition.ts`): RecognitionProvider contract, pixel→normalized geometry conversion, validation with explicit rejection reasons, confidence clamping, no-visible-damage candidates, cross-photo association, forced detection_source='ai' + review_status='pending'. Existing infrastructure audit: `ai-image-analyzer` edge function already calls a vision model (gpt-4o-mini via OPENAI_API_KEY) for inspection photos; `_shared/lovable-ai.ts` gateway helper exists. No live model call made — no proof of capability claimed.
- [~] Phase 3 — Damage segmentation: annotation library + editor built (2026-10-17, `src/lib/photo-intelligence/annotations.ts`, `src/components/photo-intelligence/PhotoAnnotationEditor.tsx`): editable polygons (vertex move/insert/delete), bbox, circle, arrow, numbered callouts, zoom/pan, undo/redo history, building/roof-plane/elevation/component/damage-category assignment, finding linking, geometry-only JSON persistence on evidence rows. Cross-photo grouping logic lives in `recognition.ts` (`associateCrossPhoto`). Remaining: wire editor into the review workspace UI, signed-in save test.
- [ ] Phase 4 — Inspector review workspace (accept/reject/edit boundaries, severity, limitations)
- [ ] Phase 5 — Technical damage analysis fields (already in schema; populate via engine)
- [~] Phase 6 — Report builder: composition model built (2026-10-17, `src/lib/photo-intelligence/reportModel.ts`): branded cover data, executive summary, building-by-building inventory sorted by severity, priority counts, water-entry concerns, no-damage areas, limitations, next steps, approval + version fields. Hard gates enforced in code: unapproved findings throw; `findUntraceableEntries` flags findings with no original photo. Remaining: PDF rendering, preview/edit UI, site overview map, evidence appendix pages.
- [ ] Phase 7 — Estimating integration (approved findings + validated measurement sources only)
- [ ] Phase 8 — Recognition benchmarking (labeled dataset, precision/recall per defect category, hard negatives)
- [ ] Phase 9 — Production integration across leads/jobs/projects/inspections/estimating/portals
- [ ] Phase 10 — This roadmap + companion docs kept current

## Hard rules (from build plan)
- AI findings start `pending`; only human-approved findings appear in client reports (enforced by `photo_finding_approval_guard` trigger).
- Measured quantities require a `measurement_source`; estimates never accept raw AI pixel counts.
- Original photos are immutable; annotations are separate editable records.
- No inference of causation, concealed damage, or insurance eligibility from photos alone.
- Do not claim recognition works until the actual model is tested on unannotated originals against inspector-reviewed labels.

## Blockers
- Actual recognition not activated: existing `ai-image-analyzer` does not request coordinates; its legacy shim dispatch and grouped route authentication order need verified repairs before a real POC. Existing gpt-4o-mini selection preserved; no model purchase or live call.
- Navarre report contains annotated images, not unannotated originals; a true recognition benchmark needs the original drone files.
- Authenticated end-to-end testing unavailable for this externally managed Supabase project; two-company credentials not supplied.

## Reference demonstration status (2026-10-17)
BLOCKED: only the plan text and one screenshot were uploaded — the Navarre report PDF containing the 22 photographs is not in the workspace uploads. Import of the reference dataset (22 photos + findings, labeled reference_label) cannot proceed until the PDF or photos are provided.

## Continuation 2026-10-17 02:52 UTC
- Programmatic PDF exporter: `reportPdf.ts`, `reportExportGuard.ts`, `reportImages.ts`. Embedded Unicode font, company branding, cover, summary, priorities/water-entry concerns, building inventory, annotated evidence with persistent IDs/provenance, original-image appendix, pagination and reopen verification. Browser print removed. Export reads the selected approved saved snapshot, not the current draft. Photo resolution choices prepare export copies only; source files unchanged.
- `SiteOverviewEditor.tsx`: choose an existing aerial evidence image, attribution, editable numbered building callouts; stored in immutable report versions. Coordinates are image-relative only, not geographic positions or quantities. Actual Navarre map remains blocked on source PDF.
- Report findings/saved versions filtered to the selected project (`?projectId=`) or unassigned records only. Company branding follows the per-tab selected tenant; draft map resets on company/project change.
- Recognition safety: provider no longer fabricates confidence from severity; out-of-image geometry rejected; cross-photo merging now requires inspector-verified physical identity. No category-based automatic defect merging.
- `benchmark.ts`: independent one-to-one IoU/category scoring, hard negatives, duplicate false positives, and pairwise association false merges/splits. Annotated/masked images blocked from independent-accuracy claims. No measured model accuracy yet.
- Tests: 49/49 Photo Intelligence tests passed; security harness: 1 status check passed, 7 live cases skipped. Six-page synthetic report rendered and inspected in full, searchable accented text/approved version/reference labels verified via pdftotext. Synthetic QA is not the Navarre demonstration.
- Navarre upload check: current attachment is `Lovable_has_made_substantial_progress_but_its_pasted.md` (instructions); no 7552/Navarre PDF present. A file uploaded to a separate ChatGPT conversation is not accessible here.
- Nothing published; no database policies or live AI service changed. Signed-in export/save/overview and two-company tests remain pending.

## Update 2026-10-17 — Photos-tab AI Analysis wiring (Phases 2 + 3 integration)
- Photos tab now has an "AI Analyze" action that opens Photo Intelligence scoped to the current lead/project/contact photos (`PhotoControlCenter.tsx` → `/photo-intelligence?leadId|projectId|contactId`).
- Review page (`PhotoIntelligenceReviewPage.tsx`) loads the record's photos, supports per-photo selection or Analyze All, shows live progress/errors, skips already-analyzed photos, and persists findings as detection_source=ai / review_status=pending linked to the project.
- Orchestration in `src/lib/photo-intelligence/analyzePhotos.ts`; findings may now carry `project_id`/`job_id` via `persistProposals` opts.
- ai-api routing repaired: `serveRouter` dispatch, `/image/analyze` now behind requireAuth + requireTenant (verified live: 401 without/with invalid token); `x-pitch-tenant` accepted as tenant header (validated against user access).
- Analyzer handler now requests JSON output, prompts for mandatory normalized coordinates + confidence, and sanitizes detections server-side: only model-supplied in-bounds bbox/polygon geometry is kept; nothing is fabricated or clamped into place.
- Adapter maps structured `detections` (bbox/polygon, damage category, confidence, no_visible_damage flag); coordinate-less candidates are rejected downstream with reasons.
- Tests: 7 adapter tests + 18 recognition/findings/report tests pass. Signed-in end-to-end run with a real photo remains PENDING (no session can be minted for this user-managed backend); Navarre reference demo still BLOCKED on the actual 19-page PDF.
