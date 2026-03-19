

# Expand Description Editor to Full Textarea

## Problem
The inline description editor uses a single-line `Input` field, making it hard to see and edit long descriptions. Users need a multi-line textarea that shows the full description at once.

## Changes

### `src/components/estimates/SectionedLineItemsTable.tsx`

Replace the single-line `Input` in the `DescriptionEditor` component (lines 233-257) with a `Textarea`:

1. Swap `<Input>` for `<Textarea>` from `@/components/ui/textarea`
2. Set `rows={3}` with `min-h-[60px]` so the full description is visible
3. Keep the same confirm/cancel buttons (check/X) but position them below or to the right
4. Keep Enter behavior as Shift+Enter for newlines, plain Enter to save (or just rely on the check button)
5. Auto-focus and select all text on open

Layout change:
- Current: single-line input + icons inline → `flex items-center`
- New: textarea on its own row, confirm/cancel icons below-right → `flex flex-col`

| File | Change |
|------|--------|
| `src/components/estimates/SectionedLineItemsTable.tsx` | Replace `Input` with `Textarea` in `DescriptionEditor`, adjust layout to stack vertically |

