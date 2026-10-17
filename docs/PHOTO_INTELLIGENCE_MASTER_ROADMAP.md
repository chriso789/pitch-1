# Photo Intelligence Master Roadmap

Reference benchmark: 7552 Navarre Parkway Storm Damage Photo Report (19 pages, 22 photos). Used as taxonomy/quality benchmark only, never as ground truth or branding source.

## Phases
- [x] Phase 1 — Audit existing photo systems + findings data model (this file; `photo_findings`, `photo_finding_evidence`, `photo_finding_reviews` tables with tenant RLS + human-approval trigger)
- [ ] Phase 2 — Component recognition engine (buildings, roof planes, shingles, metal, ridges, vents, siding, wrap, sheathing)
- [ ] Phase 3 — Damage segmentation (editable polygons) + cross-photo grouping into single findings
- [ ] Phase 4 — Inspector review workspace (accept/reject/edit boundaries, severity, limitations)
- [ ] Phase 5 — Technical damage analysis fields (already in schema; populate via engine)
- [ ] Phase 6 — Premium report builder (cover, exec summary, site map, building matrix, evidence pages, appendix)
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
