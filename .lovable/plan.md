## Problem

On `/commission-report`, the **Contract** column shows `$0.00` for every project, while **Gross Profit** correctly shows large negatives (e.g. `-$35,712.62`). The negatives = invoiced costs with no revenue offset, which proves the contract value isn't being read.

## Root cause

`src/pages/CommissionReport.tsx` reads from the wrong table:

```ts
// line 210-214
const { data: estimates } = await supabase
  .from('estimates')                          // ← legacy/empty table
  .select('id, pipeline_entry_id, selling_price, material_cost, labor_cost, overhead_amount, created_at')
  .in('pipeline_entry_id', entryIds)
  .order('created_at', { ascending: false });
```

DB confirms: `estimates` has **0 rows**; all live data is in `enhanced_estimates` (102 rows with `selling_price > 0`). Every other surface in the app (Pipeline, MyMoney, ProfitCenter) reads `enhanced_estimates`.

Because `est?.selling_price` resolves to `undefined`, `contractValue = 0`, and the commission formula falls through with only invoiced costs → negative gross profit, $0 contract.

A second smaller bug: line 302 reads `est?.sales_tax_amount`, but that column is never included in the `select(...)`, so pre-tax math is wrong even when an estimate is found.

## Fix

File: `src/pages/CommissionReport.tsx`

1. Change `.from('estimates')` (line 211) to `.from('enhanced_estimates')`.
2. Add `sales_tax_amount` to the select list.
3. Apply the same priority rule already used in `usePipelineData` so a draft estimate with `selling_price = 0` doesn't beat a sibling with a real price:
   - prefer `metadata.selected_estimate_id` / `enhanced_estimate_id` **only when its `selling_price > 0`**,
   - else fall back to the highest non-zero `selling_price` for that entry.
4. Leave the explicit "no fallback to `pipeline_entries.estimated_value`" comment in place — that intent (only count real contracts) is correct.

## Verification

1. Reload `/commission-report` for Chris O'Brien — Contract column shows the saved estimate selling price for each project (e.g. Brenda Herzel, Barb Drummond, Ron Gagne should now show their actual contracts).
2. Gross Profit recomputes against real revenue (no longer all-negative).
3. Profit Split commission column updates accordingly.
4. Spot-check one project that has approved change orders — Contract = `enhanced_estimates.selling_price` + sum of approved CO `cost_impact`.
5. Projects with no `enhanced_estimates` row still show `$0` Contract (intentional — no signed contract yet).

## Out of scope

No schema changes. No edits to ProfitCenter, MyMoney, or other surfaces — those already read `enhanced_estimates` correctly.