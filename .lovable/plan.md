
# Fix: Multi-Trade Line Items Not Merging Into Single Estimate

## Problem

When a user adds a second trade (e.g., Gutters with Blank Template), it only creates a UI section in the "Build Estimate" card but **never fetches or merges line items** into the estimate. The root cause:

1. **Only the `roofing` trade triggers `handleTemplateSelect`** (line 2081-2083) — non-roofing trades set `templateId` on the `TradeSection` object but nothing loads their items
2. **Single `lineItems` state** — there's only one `lineItems` array driven by `selectedTemplateId`, which only tracks the roofing trade
3. **Non-roofing templates with items are ignored** — their items are never fetched from `estimate_calc_template_items`
4. **Blank Template for non-roofing trades** does nothing at all — no items appear, no section shows

## Solution

Make every trade section independently fetch its template items, then **merge all trade line items into the unified `lineItems` array** that feeds the pricing engine, breakdown card, PDF, and save logic.

### Architecture: Per-Trade Item Storage + Merge

Introduce a `tradeLineItems` map (`Record<string, LineItem[]>`) keyed by trade section ID. When any trade's template is selected:
- Fetch that template's items (or start empty for Blank Template)
- Store them in `tradeLineItems[sectionId]`
- Tag each item with a `trade_type` field so they can be grouped in the UI
- Merge all trade items into the single `lineItems` array via a `useEffect`

This preserves backward compatibility — the pricing engine, breakdown card, PDF generation, and save logic all continue operating on the flat `lineItems` array.

### Changes to `MultiTemplateSelector.tsx`

**1. New state:**
```typescript
const [tradeLineItems, setTradeLineItems] = useState<Record<string, LineItem[]>>({});
```

**2. Extend `LineItem` type** (in `useEstimatePricing.ts`):
Add optional `trade_type?: string` and `trade_label?: string` fields so items carry their trade context.

**3. Make template selection work for ALL trades** (line ~2076-2083):
Remove the `if (trade.tradeType === 'roofing')` guard. Instead, call a new `handleTradeTemplateSelect(trade.id, trade.tradeType, templateId)` function that:
- Fetches template items for the given templateId (or sets empty array for blank)
- Tags each item with `trade_type` and `trade_label`
- Updates `tradeLineItems[trade.id]`
- For roofing, also maintains `selectedTemplateId` for backward compat

**4. Merge effect:**
```typescript
useEffect(() => {
  const merged = Object.values(tradeLineItems).flat();
  setLineItems(merged);
}, [tradeLineItems]);
```

**5. Delete trade handler** (line ~2058-2063):
When removing a trade section, also delete its items from `tradeLineItems`.

**6. Line items table: Show trade headers**
In the `SectionedLineItemsTable` or above it, group items by `trade_type` and show a trade header (e.g., "🏠 Roofing", "🔧 Gutters") before each group's materials/labor sections. This makes the combined estimate clear.

**7. Save logic:**
The `lineItemsJson` in `handleCreateEstimate` already serializes `materialItems` and `laborItems` from the pricing hook. Since items now carry `trade_type`, add it to the serialized JSON so the estimate record preserves trade context.

**8. shouldShowTemplateContent:**
Update to also trigger when any non-roofing trade has a template selected (currently only checks `selectedTemplateId` which is roofing-only).

### Changes to `SectionedLineItemsTable.tsx`

Add an optional `tradeSections` prop. When provided, group items by `trade_type` and render a trade header row before each group's materials/labor. When adding items inline, include a trade selector so the item goes to the correct trade.

### Changes to `useEstimatePricing.ts`

Add `trade_type?: string` and `trade_label?: string` to the `LineItem` interface. No calculation logic changes needed — the pricing engine already sums all items regardless.

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useEstimatePricing.ts` | Add `trade_type` and `trade_label` to `LineItem` interface |
| `src/components/estimates/MultiTemplateSelector.tsx` | Add `tradeLineItems` state, `handleTradeTemplateSelect`, merge effect, update shouldShowTemplateContent, update save serialization, update trade delete handler |
| `src/components/estimates/SectionedLineItemsTable.tsx` | Add trade grouping headers when multi-trade items present |
