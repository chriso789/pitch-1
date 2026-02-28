

# Fix: Trade grouping in line items table + Move add-ons to Preview panel

## Two Issues

### Issue 1: Added trades not showing as categories in the line items table
When manually adding items via "Add Material Item" / "Add Labor Item", `handleSaveNewItem` (line 716-726) creates items WITHOUT `trade_type` or `trade_label`. Since the `SectionedLineItemsTable` only activates multi-trade grouping when `tradeTypes.size > 1`, items missing `trade_type` break the grouping.

**Fix in `MultiTemplateSelector.tsx`:**
- In `handleSaveNewItem`, determine the current active trade context (from the first trade section with a selected template, or the roofing default) and set `trade_type` + `trade_label` on the new item
- Also update the item into the correct `tradeLineItems` bucket instead of appending to the flat `lineItems` directly

### Issue 2: Estimate Add-ons panel should be in Preview, not in the builder
The `EstimateAddonsPanel` (Cover Page, Fine Print, Photos, Measurements, Warranty, Smart Sign) is currently rendered inline in the builder between line items and the breakdown card. These controls already exist in the `EstimatePreviewPanel`'s left sidebar under "Extra Pages". The builder should NOT show them — they belong in the Preview workflow only.

**Fix in `MultiTemplateSelector.tsx`:**
- Remove the `EstimateAddonsPanel` render block (lines 2385-2393)
- Remove the `EstimateAddonsPanel` import
- Remove the `pdfOptions` state since it's only used by the add-ons panel (the Preview panel manages its own options state internally)

## Files to Change

### `src/components/estimates/MultiTemplateSelector.tsx`
1. **Remove** the `EstimateAddonsPanel` import and its render block (lines 2385-2393)
2. **Update `handleSaveNewItem`** to include `trade_type` and `trade_label` from the active trade section, and push item into the correct `tradeLineItems` bucket
3. Clean up unused `pdfOptions` state if no longer referenced elsewhere

### No changes needed to:
- `EstimateAddonsPanel.tsx` — keep the component, it may be reused later
- `SectionedLineItemsTable.tsx` — grouping logic is already correct
- `EstimatePreviewPanel.tsx` — already has all toggle controls in its sidebar

