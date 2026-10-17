# Photo Report Acceptance Criteria

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

Current state: NOT met. Phase 1 (data model) only; recognition engine and UI not built.

## Status 2026-10-17
Report composition model (`reportModel.ts`) enforces criteria 1 (unapproved findings throw), traceability checks (`findUntraceableEntries`), and no-damage documentation. PDF rendering, preview/edit UI, site overview, and evidence appendix pages are not yet built — no report has been generated or accepted.
