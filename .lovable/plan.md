

# Fix: Profit Button Not Updating with Estimate Changes

## Problem

The "Profit" button in the hyperlink bar shows a static 30% value even when the estimate's selling price changes. When using the "Quick Price Adjust" slider or when the estimate is updated, the profit percentage displayed doesn't reflect the actual calculated margin.

Looking at the screenshot: The Profit Center shows "32.9% Margin" but the Profit button shows "30%".

---

## Root Cause Analysis

The issue has two parts:

### 1. Quick Price Adjust doesn't recalculate profit

In `EstimateHyperlinkBar.tsx` (lines 125-129), when the price slider is used:

```typescript
.update({ selling_price: newPrice })
```

This only updates `selling_price` but does NOT recalculate:
- `overhead_amount` (depends on selling price)
- `actual_profit_amount` (selling price - costs - overhead)
- `actual_profit_percent` (profit / selling price * 100)

### 2. RPC reads stale values

The `api_estimate_hyperlink_bar` function reads `actual_profit_percent` from the database (line 49):

```sql
COALESCE(actual_profit_percent, 30)
```

Since this value isn't updated when the price changes, it shows the old percentage.

---

## Solution

Update the Quick Price Adjust mutation in `EstimateHyperlinkBar.tsx` to recalculate and store all dependent profit values when the selling price changes.

### Implementation

**File:** `src/components/estimates/EstimateHyperlinkBar.tsx`

Update the `updatePriceMutation` to:
1. Fetch the current estimate costs (materials, labor, overhead rate)
2. Recalculate overhead based on new price
3. Calculate new profit amount and percentage
4. Update all fields together

```typescript
const updatePriceMutation = useMutation({
  mutationFn: async (newPrice: number) => {
    if (!hyperlinkData?.selected_estimate_id) {
      throw new Error('No estimate selected');
    }
    
    // Fetch current estimate to get cost data
    const { data: estimate, error: fetchError } = await supabase
      .from('enhanced_estimates')
      .select('material_cost, labor_cost, overhead_percent')
      .eq('id', hyperlinkData.selected_estimate_id)
      .single();
    
    if (fetchError || !estimate) {
      throw new Error('Could not fetch estimate');
    }
    
    // Recalculate dependent values
    const directCost = (estimate.material_cost || 0) + (estimate.labor_cost || 0);
    const overheadRate = estimate.overhead_percent || salesRepOverheadRate;
    const overheadAmount = newPrice * (overheadRate / 100);
    const profitAmount = newPrice - directCost - overheadAmount;
    const profitPercent = newPrice > 0 ? (profitAmount / newPrice) * 100 : 0;
    
    // Update all values together
    const { error } = await supabase
      .from('enhanced_estimates')
      .update({
        selling_price: newPrice,
        overhead_amount: Math.round(overheadAmount * 100) / 100,
        actual_profit_amount: Math.round(profitAmount * 100) / 100,
        actual_profit_percent: Math.round(profitPercent * 100) / 100,
      })
      .eq('id', hyperlinkData.selected_estimate_id);
    
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['hyperlink-data', pipelineEntryId] });
    queryClient.invalidateQueries({ queryKey: ['profit-center-data', pipelineEntryId] });
    toast.success('Price updated');
    setIsAdjusting(false);
    setPriceAdjustment(0);
  },
  onError: (error: Error) => {
    toast.error(`Failed to update price: ${error.message}`);
  },
});
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/EstimateHyperlinkBar.tsx` | Update `updatePriceMutation` to recalculate and store overhead, profit amount, and profit percent when selling price changes |

---

## Expected Result

**Before:**
- Selling Price: $19,631
- Profit button: 30% (static)
- Profit Center: 32.9% Margin (actual calculation)

**After:**
- Selling Price: $19,631  
- Profit button: 32.9% (matches Profit Center)
- Both values update together when price changes

---

## Technical Notes

- The Profit Center panel calculates margin dynamically from the stored values
- The Hyperlink Bar reads `margin_pct` from the RPC which reads `actual_profit_percent` from the database
- This fix ensures both sources use the same stored values that are updated together
- Commission is not included in the overhead-adjusted profit calculation for the hyperlink bar display (matches current behavior)

