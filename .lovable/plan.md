

# Fix: Descriptions Reverting to Originals on Save

## Root Cause

Two issues cause description edits to be lost:

**1. No blur commit on the description editor.** The `DescriptionEditor` only commits changes when the user explicitly presses Enter or clicks the Check button. If a user edits a description and then directly clicks "Save Estimate" without confirming first, the pending text in the textarea is never committed to `lineItems` state. The save captures the old description value.

**2. `sort_order` not included in save payloads.** All three save functions (create, update, and ref-save) omit `sort_order` from the line items JSON. This causes items to lose their ordering on reload — a separate but related data integrity bug.

**3. Multi-trade stale state.** For multi-trade estimates, `updateLineItem` updates `lineItems` but not `tradeLineItems`. If the merge effect re-runs (e.g., after adding/deleting an item), stale `tradeLineItems` overwrites the edited descriptions in `lineItems`.

## Changes

### 1. `src/components/estimates/SectionedLineItemsTable.tsx` — Add blur commit

Add an `onBlur` handler to the `Textarea` in `DescriptionEditor` that auto-commits the description when focus leaves (e.g., when clicking Save). This ensures pending edits are written to `lineItems` before the save runs.

### 2. `src/components/estimates/MultiTemplateSelector.tsx` — Include `sort_order` in save + sync `tradeLineItems`

- Add `sort_order: item.sort_order` to all three save payload mappings (lines ~340, ~1410, ~1690)
- Wrap `updateLineItem` in a `handleUpdateLineItem` function that ALSO syncs the change into `tradeLineItems`, preventing the merge effect from overwriting edits
- Pass `handleUpdateLineItem` instead of `updateLineItem` to `SectionedLineItemsTable`

## Summary

| File | Change |
|------|--------|
| `SectionedLineItemsTable.tsx` | Add `onBlur` to auto-commit description edits |
| `MultiTemplateSelector.tsx` | Add `sort_order` to save payloads; sync updates to `tradeLineItems` |

