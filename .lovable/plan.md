

# Fix: Trade data missing from saved estimate line items

## Problem
When saving an existing estimate via `handleSaveLineItemChanges`, the `lineItemsJson` object strips `trade_type` and `trade_label` from both material and labor items. The create path (`handleCreateEstimate`) correctly includes these fields (lines 1373-1374, 1388-1389), but the update path (lines 1629-1656) omits them. This means when the estimate is reloaded or the PDF regenerated, all trade grouping information is lost.

## Fix

### `src/components/estimates/MultiTemplateSelector.tsx`

In `handleSaveLineItemChanges` (~lines 1629-1656), add `trade_type` and `trade_label` to both the `materials` and `labor` item maps — matching what `handleCreateEstimate` already does:

```diff
  materials: materialItems.map(item => ({
    ...existing fields...
    is_override: item.is_override,
+   trade_type: item.trade_type,
+   trade_label: item.trade_label,
  })),
  labor: laborItems.map(item => ({
    ...existing fields...
    is_override: item.is_override,
+   trade_type: item.trade_type,
+   trade_label: item.trade_label,
  })),
```

This is a 4-line addition — the root cause of the missing trade categories in saved estimates.

