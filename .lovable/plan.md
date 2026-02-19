

# Show Line Item Notes in Estimate Preview

## Problem
Line item notes (Color/Specs) are saved in the database but never displayed in the estimate preview PDF. The preview templates only show `item.description` — they completely skip `item.notes`.

## Root Cause
Both PDF rendering components render descriptions but ignore notes:
- `EstimatePDFTemplate.tsx` (lines 268-273, 317-319): only checks `item.description`
- `EstimatePDFDocument.tsx` (lines 657-662): only checks `item.description`

The `notes` field is defined on the LineItem interface (line 9 of `useEstimatePricing.ts`) and is editable in the estimate builder via `SectionedLineItemsTable.tsx`, but never passed through to the preview.

## Changes

### 1. `src/components/estimates/EstimatePDFTemplate.tsx`
**Unified view (line ~273)** and **Traditional view (line ~319)**: After the description block, add a notes block:

```tsx
{item.notes && (
  <div className="text-xs text-gray-500 mt-0.5 leading-snug italic">
    {item.notes}
  </div>
)}
```

### 2. `src/components/estimates/EstimatePDFDocument.tsx`
**ItemsTable component (line ~662)**: Same addition after the description block:

```tsx
{item.notes && (
  <div className="text-[10px] text-gray-500 mt-0.5 leading-snug italic">
    {item.notes}
  </div>
)}
```

### 3. Verify notes data flows through
Check that the line items passed to the preview components include the `notes` field from the database. If the query fetching estimate line items doesn't select `notes`, that will also need to be added.

## Result
Each line item in the estimate preview will show its notes (e.g., "Charcoal", "Weathered Wood") beneath the item name, giving homeowners the specific details they need.
