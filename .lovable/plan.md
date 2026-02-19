

# Fix Estimate Preview: Exit Button and Missing Line Item Notes

## Problem 1: Can't Exit Preview
The estimate preview dialog's close button (X) is positioned at `right-4 top-4` but it may be obscured by the DialogHeader content or have a low z-index. Additionally, there is no explicit "Close" or "Back" button in the panel's UI -- the only way to exit is the small X icon, which can be hard to find on the large full-screen dialog.

## Problem 2: Line Item Notes Not Showing
The `notes` and `description` fields are **stripped out** when saving estimates. All three save functions in `MultiTemplateSelector.tsx` explicitly map line items without including `notes` or `description`:

```text
materials: materialItems.map(item => ({
  id: item.id,
  item_name: item.item_name,
  qty: item.qty,
  ...
  // notes and description are MISSING here
}))
```

This means:
- Fresh estimates show notes (they're in memory from template calculation)
- Saved/reloaded estimates lose notes (stripped during save, never restored from DB)

The rendering code we added previously is correct -- the data just isn't being persisted.

## Changes

### 1. `src/components/estimates/MultiTemplateSelector.tsx`

**Add `notes` and `description` to all three save functions** (lines ~330-342, ~1222-1244, ~1483-1505):

Add these two fields to each material and labor item mapping:

```typescript
materials: materialItems.map(item => ({
  id: item.id,
  item_name: item.item_name,
  description: item.description,  // ADD
  notes: item.notes,              // ADD
  qty: item.qty,
  qty_original: item.qty_original,
  unit: item.unit,
  unit_cost: item.unit_cost,
  unit_cost_original: item.unit_cost_original,
  line_total: item.line_total,
  is_override: item.is_override,
})),
```

Same for labor items in each location.

**Remove the floating FAB button** (lines ~2403-2414) since there's already an inline Preview button. This was supposed to be done in the previous approved plan but wasn't executed yet.

### 2. `src/components/estimates/EstimatePreviewPanel.tsx`

**Add explicit Close button** to the dialog header alongside the existing controls, and ensure the X button has a high enough z-index:

- Add a visible "Close" button with an X icon in the DialogHeader area
- Ensure the Radix close button has `z-50` so it's never obscured by header content

### 3. Verify edge function preserves notes

Check that the `update-estimate-line-items` edge function passes through the full line item JSON (including `notes` and `description`) to the database without stripping fields. If it does a selective pick, those fields need to be added there too.

## Result
- Users can close the preview via a clearly visible Close button
- Line item notes (Color/Specs like "Charcoal", "Weathered Wood") persist through save/reload and display in the preview
