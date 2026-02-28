

# Fix: Added trades (Gutters) not showing in line items table

## Root Cause

Two related bugs:

1. **Blank Template for non-roofing trades produces zero items.** When a user selects "Blank Template" for Gutters, `handleTradeTemplateSelect` sets `tradeLineItems[guttersSectionId] = []`. Since there are zero gutter-tagged items, the merge produces only roofing items, and `tradeTypes.size` stays at 1 — no multi-trade headers appear.

2. **"Add Item" buttons always tag items as the first trade.** `handleSaveNewItem` picks `tradeSections.find(t => !!t.templateId)` which is always Roofing (it's first). Even if the user intended to add a gutter item, it gets tagged `trade_type: 'roofing'`.

3. **In multi-trade mode, "Add Material/Labor Item" buttons don't render.** The `SectionedLineItemsTable` only renders the "Add" buttons in the single-trade `else` branch (lines 475-488), never inside the multi-trade `tradeGroups.map()` loop.

## Plan

### File 1: `src/components/estimates/SectionedLineItemsTable.tsx`

- Add a new prop: `onAddTradeItem?: (tradeType: string, type: 'material' | 'labor') => void`
- Inside the multi-trade `tradeGroups.map()` loop, after each trade's labor section, render "Add Material Item" and "Add Labor Item" buttons that call `onAddTradeItem(group.type, 'material'|'labor')`
- This ensures each trade section has its own add buttons

### File 2: `src/components/estimates/MultiTemplateSelector.tsx`

- Add state: `activeAddTradeType` to track which trade the user is adding an item to
- Add handler: `handleAddTradeLineItem(tradeType: string, type: 'material' | 'labor')` that sets `activeAddTradeType` and opens the inline add form
- Update `handleSaveNewItem`: when `activeAddTradeType` is set, use that trade's section instead of `tradeSections.find(t => !!t.templateId)` — ensuring the item gets the correct `trade_type` and goes into the correct `tradeLineItems` bucket
- Pass the new `onAddTradeItem` prop down to `SectionedLineItemsTable`
- Also fix `handleDeleteLineItem` to remove from `tradeLineItems` (not just `lineItems`), so deleted items don't get restored by the merge effect

