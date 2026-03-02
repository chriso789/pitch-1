

# Fix Stored Profit Percent to Match Actual Selling Price

## Problem
Estimate OBR-00036 shows 11.2% margin at $47,193 — but the real gross margin at that price is **22.5%**. The stored `actual_profit_percent` (11.23) and `actual_profit_amount` ($5,299.35) are stale/incorrect. $5,299.35 is exactly half the true gross profit ($10,598.71), suggesting the commission was incorrectly subtracted before saving the profit figures.

## Fix: Two Parts

### 1. Data Fix — Correct this estimate's stored values
Run a SQL update to recalculate `actual_profit_percent` and `actual_profit_amount` from the stored cost/price columns:

```sql
UPDATE enhanced_estimates
SET 
  actual_profit_amount = selling_price - material_cost - labor_cost - overhead_amount,
  actual_profit_percent = ROUND(
    ((selling_price - material_cost - labor_cost - overhead_amount) / NULLIF(selling_price, 0)) * 100, 
    2
  )
WHERE id = '1edd9e21-2456-422e-bab0-bf1faed1e008';
```

This will set: profit = $10,598.71, margin = 22.46%.

### 2. Code Fix — Prevent future mismatches on save
In `MultiTemplateSelector.tsx`, the save block (line 1596–1597) writes:
```ts
actual_profit_amount: breakdown.profitAmount,
actual_profit_percent: breakdown.actualProfitMargin,
```

`breakdown.profitAmount` comes from `useEstimatePricing` line 169: `sellingPrice * profitDecimal` (target-based, not actual). For fixed-price scenarios it back-calculates correctly, but if the config drifts from reality, the saved value is wrong.

**Fix:** Before saving, always recompute actual margin from the final numbers being persisted:
```ts
const savedSellingPrice = breakdown.sellingPrice;
const savedDirectCost = breakdown.materialsTotal + breakdown.laborTotal;
const savedOverhead = breakdown.overheadAmount;
const savedGrossProfit = savedSellingPrice - savedDirectCost - savedOverhead;
const savedActualMargin = savedSellingPrice > 0 
  ? (savedGrossProfit / savedSellingPrice) * 100 
  : 0;

// Then use savedGrossProfit and savedActualMargin in the insert/update
```

This guarantees the stored percentage always reflects the actual arithmetic of the saved price/cost columns, regardless of which pricing mode produced them.

### Files Changed
- **Migration SQL**: Update the one estimate record
- **`src/components/estimates/MultiTemplateSelector.tsx`** (lines ~1596-1597): Recompute actual profit from final values before insert/update

