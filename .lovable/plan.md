
# Supplement Engine — Accuracy Layer v2

This plan adds a second layer on top of the existing scope-document-ingest / compare-scope-documents / SupplementEngine code. Nothing existing is removed; new modules wrap and augment the current pipeline.

## 1. Shared types and rules (new files)

- `supabase/functions/_shared/scope-types.ts` — `NormalizedScopeItem`, `ScopeMatch`, `AssemblyFinding`, `ReconciliationResult`, `ScopeCompareSummary`, `ScopeCompareIssue`. Includes deterministic `fingerprint = sha1(canonical_key|unit|section|line_number|round(qty,2)|round(total,2))` to prevent accidental merges.
- `supabase/functions/_shared/scope-assembly-rules.ts` — Exports `getAssemblyRules()` and `evaluateAssemblyRules({carrierItems, contractorItems})`. Ships rules: `ROOF_REPLACEMENT_BASE_ASSEMBLY`, `FLORIDA_ROOF_CODE_UPGRADE_ASSEMBLY`, `EXTERIOR_ELEVATION_REPAIR_ASSEMBLY`, `GUTTER_DOWNSPOUT_ASSEMBLY`, `TEMPORARY_REPAIR_ASSEMBLY` with trigger keys, expected/optional related keys, severity, and explanation templates as specified.

## 2. Reconciliation engine

- `supabase/functions/_shared/scope-reconciler.ts` — `reconcileParsedDocument({documentId, parsedLineItems, parsedHeaderTotals})` returns `ReconciliationResult` with sums, stated values, deltas, % delta, `passed`, and `warnings`.
  - PASS if within 2% or $2 of stated RCV; WARNING 2–5%; FAIL >5%.
  - On FAIL: write back to `insurance_scope_documents.raw_json_output.reconciliation` and set `parse_status='needs_review'`.
- Wired into `scope-document-ingest` post-parse step.

## 3. Compare engine upgrades

In `compare-scope-documents/index.ts`:

- Normalize both sides to `NormalizedScopeItem[]` via the shared model.
- **Grouped duplicate handling**: keep elevation-specific lines, but when contractor has N elevation lines and carrier has fewer/grouped, do canonical_key+unit aggregation, emit one parent row + `grouped_children`. New `result_type`s: `grouped_quantity_delta`, `grouped_total_delta`, `grouped_missing_from_carrier`, `grouped_possible_duplicate`.
- **Matching priority**: same section first → quantity-close cross-section (lower confidence) → grouped roll-up → missing_from_carrier when carrier grouped total = 0.
- **Confidence v2** scoring with the exact weights, penalties, and bands (`exact_match` / `strong_fuzzy_match` / `possible_match_needs_review` / `no_match`). Persist `match_score_breakdown` jsonb with components + reason codes + penalties.
- **Price list / date awareness**: detect carrier vs contractor price list (e.g. `FLTA8X_OCT24` vs `FLTA8X_NOV24`). Add `price_list_mismatch`, `carrier_price_list`, `contractor_price_list`, `price_list_explanation` to compare summary. Unit-price diffs become `price_list_delta_possible` (warning) instead of overcharge when lists differ, unless total impact is large.
- Run assembly rules and append `AssemblyFinding[]` to summary.

## 4. Justification builder

- `supabase/functions/_shared/supplement-justification-builder.ts` — `buildJustification(issue)` returns the four templated strings (missing/qty/price/grouped/assembly) and emits `{plain_english, contractor_note, adjuster_note, internal_note}`. Called by compare function and surfaced per row in the UI.

## 5. Database migration

New columns / table:

```sql
ALTER TABLE scope_compare_results
  ADD COLUMN IF NOT EXISTS group_id text,
  ADD COLUMN IF NOT EXISTS parent_result_id uuid REFERENCES scope_compare_results(id),
  ADD COLUMN IF NOT EXISTS grouped_children jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS match_score_breakdown jsonb;

CREATE TABLE scope_compare_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  compare_run_id uuid NOT NULL,
  result_id uuid,
  override_type text NOT NULL,
  carrier_line_item_id uuid,
  contractor_line_item_id uuid,
  reviewer_note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE scope_compare_overrides ENABLE ROW LEVEL SECURITY;
-- Tenant-scoped policies via user_company_access.
```

If `scope_compare_results` doesn't exist under that name in this project, the migration is adjusted to the actual table (`scope_comparison_lines`) — verified during build.

## 6. Evidence anchoring

- Extend the parser output per item: `page_number`, `raw_line`, `previous_line`, `next_line`, `section_name`, `layout_type`, `row_bbox` (nullable). Persisted on `insurance_scope_line_items` (or `evidence_jsonb` if column already exists).
- UI: add "View Evidence" drawer per result row showing both raw lines, parser layout, page #, parsed fields, and the confidence breakdown. Falls back to "Page unavailable from parser text extraction."

## 7. UI quality locks (`SupplementEngine.tsx` / `SupplementWorkflow.tsx`)

- Status badges (already partially present in `ScopeStatusBadges.tsx`): Parsed / Needs Review / Reconciled / Reconciliation Warning / AI Fallback Used / Final Report Ready.
- Disable "Generate Final Supplement Report" unless both docs parsed + reconciliation passed (or explicit override) + compare completed + missing/possible rows reviewed.
- Reviewer actions: mark correct / not a match / link / split / merge / exclude / include / add note → write to `scope_compare_overrides`. Overrides reapplied on re-open.

## 8. Hard error contract

Every edge function returns:
```json
{ "success": false, "error_code": "...", "message": "...", "details": {} }
```
Codes: `DOCUMENT_NOT_FOUND`, `DOCUMENT_NOT_PARSED`, `PARSER_NO_LINE_ITEMS`, `PARSER_LAYOUT_UNKNOWN`, `PARSER_RECONCILIATION_FAILED`, `COMPARE_NO_CARRIER_LINES`, `COMPARE_NO_CONTRACTOR_LINES`, `COMPARE_LOW_CONFIDENCE`, `TENANT_ACCESS_DENIED`.

## 9. Gaymon acceptance test

- `supabase/functions/tests/fixtures/gaymon-expected.json` — exact fixture from the spec.
- `supabase/functions/tests/scope-compare-gaymon.test.ts` — feeds mocked normalized items into the compare pipeline and asserts: totals, every required `missing_from_carrier` description, every `quantity_delta` (valley/hip-ridge/pipe-jack/drip-edge), grouped gutter roll-up, `price_list_mismatch=true`, and that `can_mark_final=false` when reconciliation fails.

## 10. Implementation order

1. Types + assembly rules + reconciler (pure modules, unit-testable).
2. DB migration (results columns + overrides table + RLS).
3. Compare function: normalize → group → score v2 → price-list → assembly → justification.
4. Ingest function: reconcile post-parse, persist evidence fields.
5. Error envelope across all four edge functions.
6. UI: evidence drawer, reviewer actions, gating logic, badges already wired.
7. Gaymon fixture + test, run via `supabase--test_edge_functions`.

## Out of scope (explicit)

- No replacement of existing parser or comparison entry points.
- No new AI model calls; assembly + reconciliation are deterministic.
- No changes to unrelated CRM modules.

