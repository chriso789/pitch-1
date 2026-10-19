# Photo Report Acceptance Criteria

## Balanced conditions — 2026-10-19
Approved report composition and PDF/preview now separate visible defects, maintenance, visually normal components and unassessed/uncertain areas. All sections retain persistent finding IDs, original evidence and inspector approval. Normal observations never add to damage severity totals. Unassessed areas trigger further inspection recommendations; no visible concern does not prove concealed defects absent.

Software tests pass, but real approved photographs and signed-in save→export→reopen remain pending. The current trained-model acceptance is **NOT met**: no customer model, material/component stages or measured accuracy. Local CPU synthetic execution is infrastructure evidence only. SQL persistence/evaluation hardening requires staging approval; no publication authorized.

A PITCH photo-intelligence report is acceptable only when ALL hold:

1. Every confirmed finding is human-approved (`review_status='approved'` with recorded review).
2. AI-proposed items are labeled unverified or omitted.
3. Every numeric quantity names its measurement source; no raw pixel-derived quantities.
4. Inspected areas with no visible damage are documented, not silently omitted.
5. Original photos are unchanged; annotations are separate records.
6. Findings are grouped by building with persistent finding IDs across revisions.
7. No statements of cause, concealed damage, age, or insurance eligibility beyond visible evidence; assumptions are labeled.
8. Recommendations are conditional and tied to verified observations.
9. Limitations (shadows, resolution, obstructions, missing close-ups) are recorded per finding.
10. Tenant isolation verified: users see only their company's findings.

## Definition of done (end-to-end)
Inspector uploads a property photo collection → PITCH proposes candidate components/damage grouped by building → inspector approves/edits → professional PDF report generated → approved quantities with validated sources optionally flow to estimating with estimator approval.

Current state: NOT met. Annotation/review/report software exists; real evidence, live recognition and authenticated acceptance are still pending.

## Status 2026-10-17
Report composition model (`reportModel.ts`) enforces criteria 1 (unapproved findings throw), traceability checks (`findUntraceableEntries`), and no-damage documentation. Preview page and versioned saves exist at `/photo-intelligence/report`.

## Separate acceptance tracks (2026-10-17 continuation)
**Report generation — software tested, real reference acceptance pending.** `reportPdf.ts` replaces browser printing. Exports selected approved snapshots with company branding, Unicode text, priorities, building inventory, image-relative aerial map, annotated photos, evidence/finding IDs, source labels, recommendations, limitations, original-photo appendix and numbered pages. Missing evidence (including clear areas) blocks export. Six-page synthetic PDF visually verified; not Navarre acceptance.

**Independent recognition — NOT accepted.** `benchmark.ts` provides inspector-label scoring without feeding labels/captions into predictions. Unannotated originals required for independent accuracy; masked/annotated images exploratory only. Real model POC blocked by absent suitable originals/session and identified analyzer routing/auth/coordinate-response defects. No service changes deployed or provider call made.

**Inspector workflow/security — pending.** Signed-in review→save approved version→export→reopen through UI and two-company isolation have not been performed. Existing schema approval triggers are not newly verified by unit PDF tests.

**Reference handoff:** Upload `7552 Navarre Parkway Storm Damage Photo Report 2.pdf` into this Lovable conversation. The current uploaded Markdown refers to the PDF but does not contain it. Preserve attribution, all 22 views and source labels; inspector-confirm overlapping defects before grouping. No publication approval requested or used.

## Update 2026-10-17 — Photos-tab AI Analysis wiring (Phases 2 + 3 integration)
- Photos tab now has an "AI Analyze" action that opens Photo Intelligence scoped to the current lead/project/contact photos (`PhotoControlCenter.tsx` → `/photo-intelligence?leadId|projectId|contactId`).
- Review page (`PhotoIntelligenceReviewPage.tsx`) loads the record's photos, supports per-photo selection or Analyze All, shows live progress/errors, skips already-analyzed photos, and persists findings as detection_source=ai / review_status=pending linked to the project.
- Orchestration in `src/lib/photo-intelligence/analyzePhotos.ts`; findings may now carry `project_id`/`job_id` via `persistProposals` opts.
- ai-api routing repaired: `serveRouter` dispatch, `/image/analyze` now behind requireAuth + requireTenant (verified live: 401 without/with invalid token); `x-pitch-tenant` accepted as tenant header (validated against user access).
- Analyzer handler now requests JSON output, prompts for mandatory normalized coordinates + confidence, and sanitizes detections server-side: only model-supplied in-bounds bbox/polygon geometry is kept; nothing is fabricated or clamped into place.
- Adapter maps structured `detections` (bbox/polygon, damage category, confidence, no_visible_damage flag); coordinate-less candidates are rejected downstream with reasons.
- Tests: 7 adapter tests + 18 recognition/findings/report tests pass. Signed-in end-to-end run with a real photo remains PENDING (no session can be minted for this user-managed backend); Navarre reference demo still BLOCKED on the actual 19-page PDF.
