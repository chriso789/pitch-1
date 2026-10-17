# Photo Intelligence Master Roadmap

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
- No trained detection/segmentation model exists yet — Phase 2 requires choosing vision models (no purchases without approval).
- Navarre report contains annotated images, not unannotated originals; a true recognition benchmark needs the original drone files.
- Authenticated end-to-end tests require test accounts (not available in sandbox).
