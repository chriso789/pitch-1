# Photo Recognition Feature Matrix

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
