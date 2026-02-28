

# Fix: Trades not restoring when loading a saved estimate

## Root Cause

When `loadEstimateForEditing` loads a saved estimate (line 562), it correctly reads items with `trade_type`/`trade_label` from the JSON, but it **never restores `tradeSections`**. The state stays as the default `[{ tradeType: 'roofing' }]`.

Since `activeTrades` is derived from `tradeSections` (line 2389: `tradeSections.length > 1 ? tradeSections.map(...)`) and requires `tradeSections.length > 1` to activate multi-trade mode, a saved estimate with Gutters items loads as single-trade — merging everything into one flat Materials/Labor view.

## Fix

### `src/components/estimates/MultiTemplateSelector.tsx` — `loadEstimateForEditing` (~line 593-612)

After loading `allItems`, extract unique trade types from the items and reconstruct `tradeSections`:

```typescript
// After building allItems, restore tradeSections from saved trade data
const tradeTypesInEstimate = new Map<string, string>();
allItems.forEach(item => {
  if (item.trade_type && !tradeTypesInEstimate.has(item.trade_type)) {
    tradeTypesInEstimate.set(item.trade_type, item.trade_label || item.trade_type);
  }
});

// If we found multiple trades, restore tradeSections
if (tradeTypesInEstimate.size > 1) {
  const restoredSections: TradeSection[] = Array.from(tradeTypesInEstimate.entries()).map(([type, label]) => ({
    id: crypto.randomUUID(),
    tradeType: type,
    templateId: '', // Template already applied
    label,
    isCollapsed: false,
  }));
  setTradeSections(restoredSections);

  // Also populate tradeLineItems per section
  const newTradeLineItems: Record<string, LineItem[]> = {};
  restoredSections.forEach(section => {
    newTradeLineItems[section.id] = allItems.filter(i => i.trade_type === section.tradeType);
  });
  setTradeLineItems(newTradeLineItems);
}
```

This ensures that when a multi-trade estimate is loaded for editing, the trade sections (Roofing, Gutters, etc.) are properly reconstructed and items appear under their correct trade headers.

