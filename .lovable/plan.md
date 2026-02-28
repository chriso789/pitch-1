

# Fix: Adding trade wipes existing items + Remove stale editing UI

## Two Issues

### Issue 1: Adding a trade clears existing line items
When editing a loaded single-trade estimate, items live in `lineItems` state only (not in `tradeLineItems`). Adding a new trade creates a new `tradeSections` entry, which triggers the merge effect. The merge flattens `tradeLineItems` (which has no entries for the original roofing items) into `lineItems`, wiping everything.

**Fix in `MultiTemplateSelector.tsx`:**

In the "Add Trade" `onClick` handler (~line 2347-2354), before adding the new section, migrate existing `lineItems` into `tradeLineItems` under the current roofing section:

```typescript
onClick={() => {
  // Migrate existing lineItems into tradeLineItems for the current trade
  const currentRoofingSection = tradeSections.find(t => t.tradeType === 'roofing') || tradeSections[0];
  if (currentRoofingSection && lineItems.length > 0) {
    setTradeLineItems(prev => ({
      ...prev,
      [currentRoofingSection.id]: lineItems.map(item => ({
        ...item,
        trade_type: item.trade_type || currentRoofingSection.tradeType,
        trade_label: item.trade_label || currentRoofingSection.label,
      })),
    }));
  }
  
  const newSection = { id: crypto.randomUUID(), tradeType: trade.value, templateId: '', label: trade.label, isCollapsed: false };
  setTradeSections(prev => [...prev, newSection]);
  setTradeLineItems(prev => ({ ...prev, [newSection.id]: [] }));
}
```

### Issue 2: Remove "Recalculate" and "Create New Estimate" buttons when editing
The bar showing "Viewing saved estimate. Select an action below." with Recalculate/Create New Estimate is confusing during editing. The system should auto-recalculate as items change, and editing mode should feel seamless.

**Fix:** Replace the entire block (~lines 2267-2309) with a simple "Editing estimate [number]" indicator, or remove it entirely. The Save button already handles persistence.

Replace:
```tsx
{trade.tradeType === 'roofing' && isEditingLoadedEstimate && selectedTemplateId && (
  <div className="flex items-center ...">
    ...Viewing saved estimate...Recalculate...Create New Estimate...
  </div>
)}
```

With:
```tsx
{trade.tradeType === 'roofing' && isEditingLoadedEstimate && selectedTemplateId && (
  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
    <p className="text-sm text-green-700">
      Editing estimate {editingEstimateNumber}. Changes auto-save when you click Save Estimate.
    </p>
  </div>
)}
```

