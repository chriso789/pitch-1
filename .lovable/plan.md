

# Build Estimate -- Multi-Trade System

## What Changes

The current "Select Estimate Template" card will be redesigned into a "Build Estimate" section that supports multiple trades per estimate. Instead of a single template dropdown, there will be:

1. A **"Roofing" trade** shown by default with its own template dropdown
2. An **"Add Trade" button** to add additional trade sections (Gutters, Siding, Interior Trades, Exterior Trades)
3. Each trade section gets its own template dropdown, line items, and subtotals
4. A combined total across all trades at the bottom

## Visual Layout

```text
+------------------------------------------+
|  Build Estimate                          |
+------------------------------------------+
|                                          |
|  [Roofing]                     [x remove]|
|  [ Select Roofing Template...  v ]       |
|  (line items for roofing appear here)    |
|                                          |
|  [Gutters]                     [x remove]|
|  [ Select Gutters Template...  v ]       |
|  (line items for gutters appear here)    |
|                                          |
|  [+ Add Trade]                           |
|  Options: Gutters, Siding, Interior,     |
|           Exterior Trades                |
|                                          |
+------------------------------------------+
```

## Technical Details

### File: `src/components/estimates/MultiTemplateSelector.tsx`

**Changes to the Card at line ~1904-1988:**

1. Rename the `CardTitle` from "Select Estimate Template" to "Build Estimate"
2. Introduce a **trades state array** to track multiple active trades. Each trade entry holds:
   - `tradeType` (e.g., "roofing", "gutters", "siding", "interior", "exterior")
   - `templateId` (selected template for that trade)
   - `lineItems` (calculated line items for that trade)
3. Initialize with one default trade: `{ tradeType: "roofing", templateId: "" }`
4. The existing `TemplateCombobox` becomes scoped per trade -- filter templates by `template_category` or `roof_type` matching the trade
5. Add an **"Add Trade" button** below the trade sections with a dropdown/popover listing available trades:
   - Gutters
   - Siding
   - Interior Trades
   - Exterior Trades
6. Each trade section shows as a collapsible sub-card with the trade name as header and a remove button (except the default roofing trade which stays but can be cleared)
7. Line items from all trades combine for the final estimate total

### New Trade Types Constant

```typescript
const AVAILABLE_TRADES = [
  { value: 'roofing', label: 'Roofing', default: true },
  { value: 'gutters', label: 'Gutters' },
  { value: 'siding', label: 'Siding' },
  { value: 'interior', label: 'Interior Trades' },
  { value: 'exterior', label: 'Exterior Trades' },
];
```

### Trade State Interface

```typescript
interface TradeSection {
  id: string;          // unique key for React
  tradeType: string;   // 'roofing' | 'gutters' | 'siding' | 'interior' | 'exterior'
  templateId: string;  // selected template ID
  label: string;       // display name
}
```

### Template Filtering

When rendering the `TemplateCombobox` for a trade, filter the templates list to show only templates matching that trade's `template_category`. For "roofing", show all roof-type templates (current behavior). For other trades, filter by `template_category` matching the trade value.

### Add Trade Button

A `DropdownMenu` or `Popover` with the list of trades not yet added. Once a trade is added, it's removed from the available list.

### Combining Line Items

The existing pricing hook (`useEstimatePricing`) will continue to receive all line items combined from all trade sections. Each trade's line items will be tagged with a `trade` field so they can be grouped in the `SectionedLineItemsTable`.

### Backward Compatibility

- Existing saved estimates (single-template) will load as a single "Roofing" trade
- The `selectedTemplateId` state maps to the first (roofing) trade for backward compat
- Save/load logic continues to work with the existing `enhanced_estimates` table
