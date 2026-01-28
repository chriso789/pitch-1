

# Fix: Show Actual Profit Margin Without Variance Indicators

## Problem

In the **Saved Estimates list**, the profit display shows a down arrow (TrendingDown) for any profit margin below 25%, which makes it look like the profit has decreased from some original value. This is confusing because the value shown (e.g., "10.8% Profit") is the **actual profit margin**, not a change/variance.

| Current Display | User Perception |
|-----------------|-----------------|
| ↘ 10.8% Profit (red with down arrow) | "Profit dropped by 10.8%?" |
| ↗ 30.0% Profit (green with up arrow) | "Profit increased by 30%?" |

## Root Cause

The code uses `TrendingUp` / `TrendingDown` icons based on whether profit is above or below 25%, but these icons visually suggest a **change** rather than an **absolute value**.

**Current code** (lines 366-373 in `SavedEstimatesList.tsx`):
```tsx
<span className={`flex items-center gap-1 ${getProfitColor(estimate.actual_profit_percent || 0)}`}>
  {(estimate.actual_profit_percent || 0) >= 25 ? (
    <TrendingUp className="h-3 w-3" />
  ) : (
    <TrendingDown className="h-3 w-3" />
  )}
  {(estimate.actual_profit_percent || 0).toFixed(1)}% Profit
</span>
```

## Solution

Replace the trending icons with a neutral icon (or no icon) that clearly indicates this is a static profit percentage, not a delta/variance.

**Option A - Use Percent icon** (clearest):
```tsx
<span className={`flex items-center gap-1 ${getProfitColor(estimate.actual_profit_percent || 0)}`}>
  <Percent className="h-3 w-3" />
  {(estimate.actual_profit_percent || 0).toFixed(1)}% Margin
</span>
```

**Option B - Remove icon entirely** (simplest):
```tsx
<span className={`${getProfitColor(estimate.actual_profit_percent || 0)}`}>
  {(estimate.actual_profit_percent || 0).toFixed(1)}% Margin
</span>
```

The label should also change from "Profit" to "Margin" to clarify this is a percentage of the selling price.

## File to Modify

| File | Change |
|------|--------|
| `src/components/estimates/SavedEstimatesList.tsx` | Replace TrendingUp/TrendingDown icons with a neutral Percent icon and change label from "Profit" to "Margin" |

## Visual Result

**Before:**
```
↘ 10.8% Profit    (red, looks like decline)
↗ 30.0% Profit    (green, looks like increase)
```

**After:**
```
% 10.8% Margin    (red color = low margin)
% 30.0% Margin    (green color = healthy margin)
```

The color still communicates margin health (green ≥30%, yellow ≥20%, red <20%) without the misleading directional arrows.

