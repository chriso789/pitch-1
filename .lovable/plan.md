
# Supplement Engine — Accuracy Layer 2

A layered upgrade on top of the existing parser + comparer. Nothing existing is replaced; new modules are composed into the current pipeline.

## Scope note

The brief references `supabase/functions/compare-scope-documents`. The repo currently uses `scope-comparison-analyze` (primary) and `xact-compare-documents` (Xactimate-specific). I will wire the new layer into `scope-comparison-analyze` and expose it from `xact-compare-documents` too, rather than create a third compare function. If you want a new `compare-scope-documents` function specifically, say so before approval.

---

## What gets built

### 1. Shared types
`supabase/functions/_shared/scope-types.ts`
- `NormalizedScopeItem` (with `fingerprint`, `parser_layout`, `page_number`, `raw_line`, `canonical_*`, totals, etc.)
- `ScopeMatch`, `AssemblyFinding`, `ReconciliationResult`, `ScopeCompareSummary`, `ScopeCompareIssue`
- All other shared modules import from here so the contract is single-sourced.

### 2. Assembly rule engine
`supabase/functions/_shared/scope-assembly-rules.ts`
- `getAssemblyRules()` returns the 5 rules from the brief (roof base, FL code upgrade, exterior elevation, gutter/downspout, temporary repair) with trigger keys, expected/optional related keys, severity, and explanation template.
- `evaluateAssemblyRules({ carrierItems, contractorItems })` walks both sides, fires rules where triggers match, and emits `AssemblyFinding[]` listing missing related keys + which side is missing them.

### 3. Total reconciliation
`supabase/functions/_shared/scope-reconciler.ts`
- `reconcileParsedDocument(...)` computes sums vs stated header totals, deltas, % delta, and `passed` flag with the 2% / 5% PASS/WARN/FAIL bands.
- Result persisted at `insurance_scope_documents.raw_json_output.reconciliation`.
- On FAIL, `parse_status` is flipped to `needs_review`.
- Called at the end of `scope-document-ingest` after parsing.

### 4. Grouped duplicate handling
Inside `scope-comparison-analyze` (and `xact-compare-documents`):
- Section-first matching, then quantity-close cross-section, then grouped-by-canonical_key fallback.
- New `result_type` values: `grouped_quantity_delta`, `grouped_total_delta`, `grouped_missing_from_carrier`, `grouped_possible_duplicate`.
- Migration adds `group_id text`, `parent_result_id uuid`, `grouped_children jsonb default '[]'` to `scope_compare_results` (only if columns are missing — checked via `IF NOT EXISTS`).

### 5. Price list / date normalization
- Parser captures `price_list` and `estimate_date` into `raw_json_output.header`.
- Comparer compares both sides and emits summary fields: `price_list_mismatch`, `carrier_price_list`, `contractor_price_list`, `price_list_explanation`.
- Unit-price deltas reclassified as `price_list_delta_possible` (warning) when lists differ, unless total impact crosses a threshold.

### 6. Justification builder
`supabase/functions/_shared/supplement-justification-builder.ts`
- `buildJustification(issue)` returns the four narratives per issue type (plain English, contractor-friendly, adjuster-facing, internal reviewer) for: `missing_from_carrier`, `quantity_delta`, `price_delta`, `grouped_missing_from_carrier`, `assembly_finding`.
- Output stored on the result row as `justification jsonb` (new column via migration if missing) so the report builder can render directly.

### 7. Confidence scoring v2
- Replace current scalar score in `scope-comparison-analyze` with weighted components + penalties from the brief.
- Persist `match_score_breakdown jsonb` (migration if missing) with: `components`, `penalties`, `final`, `classification`, `reason_codes`.
- Thresholds map to `exact_match | strong_fuzzy_match | possible_match_needs_review | no_match`.

### 8. PDF evidence anchoring
- Extend parser output to include `page_number`, `raw_line`, `previous_line`, `next_line`, `section_name`, `layout_type`, `row_bbox` (null if unavailable).
- Stored on `insurance_scope_line_items` (migration adds any missing columns).
- UI: per-row “View Evidence” drawer fed by these fields + `match_score_breakdown`.

### 9. Acceptance test
- `supabase/functions/tests/fixtures/gaymon-expected.json` (exactly the JSON in the brief).
- `supabase/functions/tests/scope-compare-gaymon.test.ts` Deno test that loads a mocked parsed-items fixture, runs the reconciler + comparer + assembly engine, and asserts: totals, missing items, grouped gutter rows, price-list mismatch flag, and that the comparison is blocked from `final` when reconciliation fails.
- A second small fixture of mocked parsed line items (`gaymon-parsed.json`) avoids needing the real PDFs in the test runner.

### 10. UI quality locks
`src/pages/SupplementWorkflow.tsx`, `src/pages/SupplementEngine.tsx`, `src/hooks/useScopeIntelligence.ts`
- Status badges: Parsed, Needs Review, Reconciled, Reconciliation Warning, AI Fallback Used, Final Report Ready.
- “Generate Final Supplement Report” disabled unless: both docs parsed, both reconciliations PASS (or manual override), compare run completed, and all `possible_match_needs_review` rows reviewed.
- Reviewer actions wired to a new table.

### 11. Manual override table
Migration: `scope_compare_overrides` with the exact columns from the brief, tenant-scoped RLS (`tenant_id = get_user_tenant_id()`), and re-application on compare-run reopen.

### 12. Hard error handling
- Every scope edge function returns the structured `{ success, error_code, message, details }` envelope with the listed error codes.
- A tiny shared helper `_shared/scope-errors.ts` keeps codes consistent.

---

## Database migrations (single migration file)

```text
ALTER TABLE scope_compare_results
  ADD COLUMN IF NOT EXISTS group_id text,
  ADD COLUMN IF NOT EXISTS parent_result_id uuid,
  ADD COLUMN IF NOT EXISTS grouped_children jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS match_score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS justification jsonb;

ALTER TABLE insurance_scope_line_items
  ADD COLUMN IF NOT EXISTS page_number int,
  ADD COLUMN IF NOT EXISTS raw_line text,
  ADD COLUMN IF NOT EXISTS previous_line text,
  ADD COLUMN IF NOT EXISTS next_line text,
  ADD COLUMN IF NOT EXISTS layout_type text,
  ADD COLUMN IF NOT EXISTS row_bbox jsonb,
  ADD COLUMN IF NOT EXISTS fingerprint text;

CREATE TABLE IF NOT EXISTS scope_compare_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  compare_run_id uuid not null,
  result_id uuid null,
  override_type text not null,
  carrier_line_item_id uuid null,
  contractor_line_item_id uuid null,
  reviewer_note text null,
  created_by uuid null,
  created_at timestamptz default now()
);
-- RLS: tenant_id = get_user_tenant_id()
```

---

## File map

```text
supabase/functions/_shared/
  scope-types.ts                          (new)
  scope-assembly-rules.ts                 (new)
  scope-reconciler.ts                     (new)
  supplement-justification-builder.ts     (new)
  scope-errors.ts                         (new)
  scope-normalizer.ts                     (extend: emit fingerprint + canonical_group)
  xactimate-line-parser.ts                (extend: capture page/raw_line/neighbors/layout/price_list/date)

supabase/functions/scope-document-ingest/index.ts
  - call reconciler, persist reconciliation, set parse_status=needs_review on FAIL
  - return structured errors

supabase/functions/scope-comparison-analyze/index.ts
  - grouped-duplicate logic + v2 confidence + assembly engine + justification
  - emit price_list_mismatch summary
  - return structured errors

supabase/functions/xact-compare-documents/index.ts
  - thin wrapper that reuses the same shared modules

supabase/functions/tests/
  fixtures/gaymon-expected.json
  fixtures/gaymon-parsed.json
  scope-compare-gaymon.test.ts

src/hooks/useScopeIntelligence.ts        (surface new statuses/locks)
src/pages/SupplementWorkflow.tsx         (badges, locks, reviewer actions, evidence drawer)
src/pages/SupplementEngine.tsx           (badges + locks)
src/components/supplement/EvidenceDrawer.tsx  (new)
src/components/supplement/ReviewActions.tsx   (new)
```

---

## Out of scope (call out before approval if you want these)

- Re-parsing the Gaymon PDFs end-to-end inside the Deno test runner. The acceptance test will run against a parsed-items JSON fixture; full PDF→text reparse stays out of CI to avoid pulling the PDF library into the test sandbox.
- Renaming `scope-comparison-analyze` → `compare-scope-documents`. Happy to do it if you want consistency with the brief.
- Touching `generate-supplement-report` / `generate-supplement-packet` — the new `justification` field is available to them but I will not change their rendering until you confirm.

## Verification once built

1. `supabase--test_edge_functions` runs `scope-compare-gaymon.test.ts` and asserts the full expected list.
2. Manual run on the live Gaymon documents in the UI: badges appear, evidence drawer opens, locks block "Generate Final" until both reconciliations pass, and the produced report contains the bullet list in Phase 12 of the brief.
3. `supabase--linter` after migration to catch policy/index regressions.

