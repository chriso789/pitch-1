## Phase 0 — Verification Results (already run)

The user's GitHub-search miss was a false negative. Everything they listed actually exists in the repo and database:

| Artifact | Status |
|---|---|
| `supabase/functions/generate-supplement-report/index.ts` | FOUND (444 lines) |
| `supabase/functions/export-supplement-report/index.ts` | FOUND (203 lines) |
| `supabase/functions/update-scope-compare-review/index.ts` | FOUND (150 lines) |
| `supabase/functions/_shared/supplement-report-builder.ts` | FOUND (449 lines) |
| Table `supplement_reports` | FOUND in public schema |
| Table `supplement_report_items` | FOUND |
| Table `supplement_report_exports` | FOUND |
| Hook `useRunScopeComparison` | FOUND in `useScopeIntelligence.ts` |
| Hook `useUpdateCompareReview` | FOUND |
| Hook `useGenerateSupplementReportV2` | FOUND (calls `generate-supplement-report`) |
| Hook `useExportSupplementReport` | FOUND |
| Migrations creating the 3 tables | FOUND (`20260515223232_*.sql`, `20260521144825_*.sql`) |
| `docs/SUPPLEMENT_BACKEND_AUDIT.md` | FOUND |

So Phases 1–6 of the user's prompt are **already implemented**. What is genuinely missing:

1. Deno tests for the three edge functions (`tests/` dir has none for them).
2. A "Final Report Phase Verification" section in `docs/SUPPLEMENT_BACKEND_AUDIT.md` with file-path proof.
3. UI audit of `SupplementWorkflow.tsx` / `SupplementEngine.tsx` to confirm review → generate → export buttons exist and use the hooks; wire any missing pieces (scope-limited; no redesign).

## What this plan will do

### 1. Verify UI wiring (small, surgical)
- Read `SupplementWorkflow.tsx`, `SupplementEngine.tsx`, and any review/findings components.
- Confirm presence of: review include/exclude toggles, reviewer note input, Generate Report button, report preview pane (markdown/HTML), and 4 export buttons (JSON / CSV / Markdown / HTML).
- For any missing button or wiring, add it using existing hooks. No layout overhaul.

### 2. Add Deno tests
Create:
- `supabase/functions/tests/generate-supplement-report.test.ts` — mocked compare run + results; asserts totals math, section headers (Executive Summary, Missing Items, Quantity Differences, Price List Warning, Evidence/Parser Audit), and no double-counting of grouped parent/children. Uses synthetic Gaymon-shaped fixtures (14,718.16 / 29,417.87 / 14,699.71).
- `supabase/functions/tests/export-supplement-report.test.ts` — asserts JSON valid, CSV has required headers, Markdown contains Executive Summary, HTML is printable standalone.
- `supabase/functions/tests/update-scope-compare-review.test.ts` — asserts include/exclude/mark_reviewed/add_note mutations.

Tests target the **builder module directly** plus pure handler logic; no live network calls, no AI.

### 3. Update `docs/SUPPLEMENT_BACKEND_AUDIT.md`
Append two sections:
- **Final Report Phase Verification** — table of every artifact above marked FOUND with exact file path / table name / hook name.
- **Final Report Phase Completed** — checklist (upload → parse → reconcile → compare → review → generate → export JSON/CSV/MD/HTML) with `[x]` where code exists, plus known limitations (no PDF export yet, no email/share packet, no claim submission tracker — those are the next phase).

### 4. Do NOT
- Re-create the 3 edge functions, builder, or migrations (already exist).
- Re-create the 3 tables (already exist).
- Re-create the hooks (already exist; just verify wiring).
- Add PDF generation, email packet, or claim tracker (explicitly next phase per the prompt).

## Technical notes
- Test runner: Deno via `supabase--test_edge_functions`.
- Fixtures will be inline TS objects (no external file deps) shaped like `scope_compare_runs` / `scope_compare_results` rows.
- Builder is imported directly: `import { buildSupplementReport } from "../_shared/supplement-report-builder.ts"`.
- Any UI changes will reuse existing shadcn components and the existing hooks — no new state libs.

## Deliverables
1. 3 new test files under `supabase/functions/tests/`.
2. Updated `docs/SUPPLEMENT_BACKEND_AUDIT.md` with verification + completion sections.
3. Minimal patches to `SupplementWorkflow.tsx` / `SupplementEngine.tsx` only if review/generate/export controls are missing.
