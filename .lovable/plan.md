

## Plan: Fix Line Item Total Not Recalculating After Price Edit

### Problem
When you edit a line item's unit cost (e.g., change it to $25.00), the line total doesn't update. The display still shows the old total ($5,801.00 instead of 16.02 × $25.00 = $400.50).

### Root Cause
In `MultiTemplateSelector.tsx`, the `handleUpdateLineItem` wrapper syncs edits into `tradeLineItems` state — but it copies the update without recalculating `line_total`. Then a merge `useEffect` overwrites the correctly-calculated line items with the stale `tradeLineItems`, reverting the total.

### Fix

**File: `src/components/estimates/MultiTemplateSelector.tsx`** (~line 1897-1905)

In the `handleUpdateLineItem` function, recalculate `line_total` when syncing to `tradeLineItems`:

```typescript
setTradeLineItems(prev => {
  const next = { ...prev };
  for (const key of Object.keys(next)) {
    next[key] = next[key].map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, ...updates };
      // Recalculate line_total when qty or unit_cost changes
      if ('qty' in updates || 'unit_cost' in updates) {
        updated.line_total = updated.qty * updated.unit_cost;
      }
      return updated;
    });
  }
  return next;
});
```

Single-file, ~5-line change.

