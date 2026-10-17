# Photo Recognition Feature Matrix

Status: implemented | partial | blocked | not-started

| Feature | Status | Notes |
|---|---|---|
| Findings data model (IDs, building, component, condition, confidence, review status) | implemented | `photo_findings` migration; tenant RLS |
| Evidence links (many photos per finding, editable annotation JSON) | implemented | `photo_finding_evidence`; originals immutable |
| Review history + human-approval gate | implemented | `photo_finding_reviews` + `photo_finding_approval_guard` trigger |
| Measurement source required for quantities | implemented | trigger blocks quantity without source |
| Building/component detection | not-started | Phase 2; no model chosen |
| Defect detection (missing shingles/tabs, creased/lifted, underlayment, ridge caps/vents, siding, wrap, sheathing, debris, metal) | not-started | taxonomy defined from Navarre report |
| Damage segmentation polygons | partial | editor + geometry library built (`annotations.ts`, PhotoAnnotationEditor); not yet wired into review UI; no model |
| Cross-photo grouping / dedup | partial | `associateCrossPhoto` groups by building+component+category; GPS/visual matching not started |
| Inspector review workspace UI | not-started | Phase 4 |
| Report builder integration | partial | composition model + preview page at `/photo-intelligence/report` (2026-10-17); versioned saves via `photo_intelligence_reports`; export = print-to-PDF of approved version only; site overview map and styled PDF template not yet built |
| Estimating integration | not-started | approved findings + validated sources only |
| Benchmarking dataset/metrics | blocked | needs unannotated originals + labeled test set |
| "No visible damage" documentation | not-started | must record inspected-clear areas |
