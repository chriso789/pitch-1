

## Root Cause Analysis: 90% Profit Margin Bug

### What Happened

The bug had **two layers**:

**Layer 1 — Stale database values (the original sin)**

When estimates were first saved by `MultiTemplateSelector.tsx`, the `actual_profit_percent` was computed using `selling_price` (which **includes sales tax**) as if it were revenue. Tax collected is pass-through, not profit — so the formula was:

```text
WRONG:  profit = sellingPrice - materials - labor - overhead
        margin = profit / sellingPrice

RIGHT:  profit = (sellingPrice - salesTax) - materials - labor - overhead
        margin = profit / (sellingPrice - salesTax)
```

For Andrea Iacono, if the selling price was ~$15,000 with ~$1,000 tax and ~$1,500 in costs, the wrong formula would yield an inflated profit %. These wrong values were written to `actual_profit_percent` in the `enhanced_estimates` table.

**Layer 2 — The HyperlinkBar trusted the stored value**

The `api_estimate_hyperlink_bar` RPC (line 95) reads `actual_profit_percent` directly from the database and returns it as `margin_pct`. The `EstimateHyperlinkBar` component was **displaying `margin_pct` from the RPC verbatim** without recalculating. So even after the save formula was fixed, old estimates retained the stale 90% value in the database and the bar kept showing it.

### What Was Fixed

1. **Save path** (`MultiTemplateSelector.tsx` lines 1602-1610): Now uses `breakdown.preTaxSellingPrice` instead of `breakdown.sellingPrice` for profit calculations before writing to DB.

2. **Display path** (`EstimateHyperlinkBar.tsx` line 307): Now **ignores** the stored `margin_pct` and recalculates live from materials, labor, overhead, and sale price. This means even old estimates with stale DB values display correctly.

3. **Price override path** (`EstimateHyperlinkBar.tsx` lines 168-174): When a user adjusts the price via the slider, it now subtracts `salesTaxAmount` before computing overhead and profit.

### How to Prevent This From Recurring

Two guardrails are needed:

#### 1. Add a database-level constraint/trigger (migration)

Create a CHECK constraint or trigger on `enhanced_estimates` that validates `actual_profit_percent` is between -100% and +85% (reasonable construction industry bounds). This catches obviously wrong values at write time.

```sql
ALTER TABLE enhanced_estimates
ADD CONSTRAINT chk_profit_percent_range
CHECK (actual_profit_percent IS NULL OR actual_profit_percent BETWEEN -100 AND 85);
```

#### 2. Add a unit test for the pricing calculation

Create a Vitest test in `src/hooks/__tests__/useEstimatePricing.test.ts` that verifies:
- Profit margin is calculated from pre-tax revenue
- Sales tax does not inflate profit
- A known scenario (e.g., $10K sale, $700 tax, $6K costs) produces the expected margin (~33%, not ~40%)

### Files to Create/Modify

| File | Change |
|------|--------|
| `supabase/migrations/new_migration.sql` | Add CHECK constraint on `actual_profit_percent` range |
| `src/hooks/__tests__/useEstimatePricing.test.ts` | Unit test: profit excludes tax from revenue denominator |

