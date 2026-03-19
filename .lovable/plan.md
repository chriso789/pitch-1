

# Add Drag-to-Reorder for Estimate Line Items

## Problem
Line items in the estimate editor have no way to be rearranged. Users need to drag items up/down to control the order they appear in the estimate and PDF.

## Approach
Add a drag handle (grip icon) to the left side of each line item row using `@dnd-kit` (already installed in the project). When items are dropped in a new position, update `sort_order` on all affected items.

## Changes

### 1. `src/components/estimates/SectionedLineItemsTable.tsx`

- Add new prop `onReorderItems: (reorderedIds: string[]) => void` to receive reorder events
- Import `@dnd-kit/core` and `@dnd-kit/sortable` (already used elsewhere in the project)
- Convert `renderItemRow` from a render function to a `SortableItemRow` component that uses `useSortable` hook
- Add a `GripVertical` drag handle as the first element in each table row (only when `editable` is true)
- Wrap each section's item rows in `DndContext` + `SortableContext` so items can be reordered within their section (materials reorder among materials, labor among labor)
- On drag end, compute the new order and call `onReorderItems` with updated sort orders

### 2. `src/components/estimates/MultiTemplateSelector.tsx`

- Add a `handleReorderItems` function that takes the new ordered IDs and updates `sort_order` on each line item via `setLineItems`
- Pass `onReorderItems={handleReorderItems}` to `SectionedLineItemsTable`

### 3. `src/hooks/useEstimatePricing.ts`

No changes needed — items already sort by `sort_order`, so updating that field will automatically reflect the new order.

## UI Details
- Drag handle appears on hover (left side of the item name column) — same pattern as `PageOrderManager` and template editors
- Table column layout: add a narrow first column for the grip handle when editable
- Items reorder within their section (materials stay with materials, labor with labor)
- Within multi-trade layout, items reorder within their trade+type group

