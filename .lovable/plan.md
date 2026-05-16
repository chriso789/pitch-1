## Problem

In the comparison view (`ProjectInsuranceTab` → `ComparisonDetail`) every row shows `Carrier Qty × $` and `Company Qty × $` that do not match either source PDF. Example from the screenshot:

- Row `RFG ASBPH — Remove Laminated comp. shingle rfg. w/ felt`
  - UI says: Carrier `28.33 SQ × $214.50`, Company `28.33 SQ × $58.42`
  - Actual carrier PDF: `15.66 SQ × $78.86` (Tear off / Remove laminated)
  - Actual company PDF: `15.43 SQ × $83.20` (Remove laminated w/out felt)
- Several "added" rows (Gutter, Ice & water, Turbine, Drip edge) show a carrier value of "—" even when those items exist in the carrier scope under slightly different descriptions.

This is a backend correctness problem in the comparison engine, not a Gaymon-only issue. It affects every project across every company.

## Root-cause hypotheses to confirm during Phase 1

1. **Wrong matching key.** `scope-compare-core.ts` is pairing carrier and company lines by something other than canonical code + unit + section (e.g., partial description match or `raw_code` only), so unrelated lines collide on the same row.
2. **Quantity / unit-price aggregation bug.** When multiple parsed lines share a canonical key (elevation-specific gutters, multi-page subtotals), the engine sums quantities but copies a unit price from one arbitrary line instead of computing `total / qty`.
3. **Description swap.** The `description` written to `scope_compare_results` is taken from the contractor side, but the `unit_price` is taken from the network/default price list, not from the parsed PDF line — producing the $214.50 / $58.42 numbers that exist nowhere in either PDF.
4. **Tear-off vs. R&R confusion.** Xactimate `RFG ASBPH` (remove + replace) is being matched against the carrier's plain "Remove" line, so quantity (15.66 vs 28.33) and price get doubled.

## Plan

### Phase 1 — Audit (no code changes)
1. Pick 3 real projects across 3 tenants that already have a comparison row (Gaymon + 2 others).
2. For each, dump:
   - `scope_parse_debug_rows` for both documents → confirm parser captured the correct `quantity`, `unit`, `unit_price`, `total` per line.
   - `scope_compare_results` rows → confirm what was persisted.
3. Compare parser output to comparison output. Locate the exact step that drops/replaces the unit price.
4. Write findings into `docs/SUPPLEMENT_COMPARISON_AUDIT.md`.

### Phase 2 — Fix pairing in `scope-compare-core.ts`
1. Pair lines by composite key in this priority order:
   1. `canonical_key` (from `scope-normalizer`)
   2. `xactimate_code` (e.g., `RFG ASBPH`) + `unit`
   3. Fuzzy description match only as a last resort and only when units agree
2. Reject any pairing where `unit` differs (SQ vs LF vs EA) — emit two rows instead.
3. When multiple lines on one side share the same key (elevation rows), aggregate them into a parent row and put the per-elevation lines under `grouped_children` (column already exists).
4. Always carry `unit_price` straight from the parsed line. Never substitute a price-list value into `carrier_unit_price` / `company_unit_price`. Price-list deltas live in a separate `price_list_delta_possible` flag.

### Phase 3 — Fix the persistence layer in `compare-scope-documents/index.ts`
1. When writing `scope_compare_results`, store:
   - `carrier_quantity`, `carrier_unit`, `carrier_unit_price`, `carrier_total` from the matched carrier line
   - Same for company side
   - `delta_rcv = company_total − carrier_total` (per row)
2. If one side is missing, store `null` for that side and `change_type = 'added'` or `'removed'` (not "—" derived in the UI).
3. Re-derive `change_type` after pairing:
   - both present, qty equal, price equal → `match`
   - both present, qty differs → `qty_change`
   - both present, price differs → `price_change`
   - only one side → `added` / `removed`

### Phase 4 — Backfill existing comparisons
1. Add an admin-only edge function `recompute-scope-comparisons` that:
   - Iterates every row in `scope_compare_runs`
   - Re-runs the comparison from the already-parsed `insurance_scope_documents`
   - Overwrites `scope_compare_results` for that run
2. Trigger it once for all tenants after Phase 3 ships. Existing UI will instantly show corrected values.

### Phase 5 — Regression tests
1. Extend `supabase/functions/tests/fixtures/gaymon-parsed.ts` with the exact numeric facts visible in the user screenshots:
   - Carrier `Remove laminated` = `15.66 SQ × $78.86`
   - Company `Remove laminated w/out felt` = `15.43 SQ × $83.20`
   - 4 elevations of gutter on company side aggregate to `85 LF × $8.50`
2. Add assertions:
   - The paired row keeps both sides' actual prices.
   - No row contains a unit price that was not present in either parsed source.
   - `change_type` matches the qty/price relationship.
3. Add a second fixture from a non-Gaymon project (use one of the 3 projects audited in Phase 1) to prove the fix generalises.

### Phase 6 — UI polish (small)
1. Show both sides' totals (`carrier_total`, `company_total`) inline so reviewers can sanity-check `Δ RCV` without math.
2. When a row is aggregated from elevation children, show a small chevron and the child rows in a sub-table.

## Technical Details

- Files touched:
  - `supabase/functions/_shared/scope-compare-core.ts` (pairing rewrite)
  - `supabase/functions/_shared/scope-normalizer.ts` (only if Phase 1 shows canonical keys are unstable)
  - `supabase/functions/compare-scope-documents/index.ts` (persistence)
  - new `supabase/functions/recompute-scope-comparisons/index.ts`
  - `supabase/functions/tests/fixtures/gaymon-parsed.ts` + new fixture
  - `src/features/projects/components/ProjectInsuranceTab.tsx` (sub-row UI only)
- Database: no schema changes required; `scope_compare_results` already has `carrier_*`, `company_*`, `grouped_children`, `match_score_breakdown`.
- Backfill is idempotent: `recompute-scope-comparisons` deletes and re-inserts rows per run, wrapped in a transaction.

## Out of scope

- Re-parsing the source PDFs (parser output is trusted; Phase 1 will confirm).
- Changing the supplement-report PDF format.
- Any change to the assembly-rule engine or justification builder.

## Success criteria

- For every row in every project's comparison, `carrier_unit_price` and `company_unit_price` either equal a value present in the corresponding parsed PDF line or are `null`.
- No row pairs lines whose units differ.
- Gaymon and the second-project fixture both pass the new regression tests.
- After backfill, the screenshot scenario shows `Carrier 15.66 SQ × $78.86 / Company 15.43 SQ × $83.20 / Δ RCV` matching the real delta.
