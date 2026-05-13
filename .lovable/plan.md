# Fix: "Save Line Items to Template" dialog hides most items

## Diagnosis
- Confirmed via `src/components/estimates/MultiTemplateSelector.tsx` (line 2853) that the dialog receives the full `lineItems` array — nothing is filtered upstream.
- In `UpdateTemplateDialog.tsx`, the items state is built from all non-`change_order` line items (lines 78–95) and rendered with `items.map(...)` (line 360) — no slice/limit. The header counter ("18 materials, 0 labor items will be saved") matches the real count, so all 18 items **are** in state.
- The actual bug is presentational: the editable list is wrapped in `<ScrollArea className="flex-1 max-h-[300px] border rounded-md">` (line 355). The `max-h-[300px]` cap means only ~2 items are visible at once even though the parent dialog is `max-h-[90vh]`. There is no visible affordance telling the user the list is internally scrollable, so it looks like items are missing.
- A second smaller issue: the "Update Existing" template picker uses `max-h-[180px]` for the same reason but is less impactful.

## Fix

**`src/components/estimates/UpdateTemplateDialog.tsx`**
1. Make the editable line-items section grow to fill the remaining dialog height instead of being capped at 300px:
   - Change the wrapper `<div className="mt-3 flex-1 overflow-hidden flex flex-col">` to keep `flex-1` (it already does) and remove the `max-h-[300px]` from the inner `ScrollArea`, replacing it with `className="flex-1 border rounded-md"` so it expands within the flex column.
2. Add a small header above the list showing the live count, e.g. `Edit Line Items (18)`, using `items.length`. This makes it obvious all items are loaded and the list just needs to be scrolled.
3. Bump the templates picker `ScrollArea` from `max-h-[180px]` to `max-h-[220px]` so longer template lists aren't clipped either (minor polish, same root cause).

No data, query, or save-logic changes — the underlying items are already complete.

## Out of scope
- No changes to `MultiTemplateSelector.tsx` or any DB write path.
- No change to which item types are saved (still excludes `change_order`, includes all materials and labor).
