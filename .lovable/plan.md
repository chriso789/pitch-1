

# Fix: Trade sections not restoring when editing saved estimates

## Problem
The estimate `OBR-00036-il2y` was saved before the `trade_type`/`trade_label` fix was applied. The DB shows gutter items (`Install 6" Gutter`, `Install Aluminum Fascia`, `Install Aluminum Soffit`) in the `labor` array with **no** `trade_type` or `trade_label` fields. When `loadEstimateForEditing` runs, the restoration logic finds zero items with trade metadata, so `tradeTypesInEstimate.size` stays at 1 or 0, and everything renders as single-trade (merged).

Additionally, when `isEditingLoadedEstimate` is true:
1. The merge effect (line 548) is skipped, so `tradeLineItems` changes are ignored
2. `handleSaveNewItem` adds to flat `lineItems` (line 787) but NOT to `tradeLineItems`, so new items don't appear under their trade section

## Fix (2 changes in `MultiTemplateSelector.tsx`)

### Change 1: Restore `tradeLineItems` for editing mode
In `loadEstimateForEditing`, after restoring `tradeSections`, also need to **re-set `lineItems`** after populating `tradeLineItems` — because the merge effect is skipped in edit mode. Instead, we should **not skip** the merge when we explicitly restored trade sections.

Update the merge effect guard (line 546-554): Instead of blanket-skipping when `isEditingLoadedEstimate`, add a flag like `tradeRestored` that gets set to `true` when tradeSections are restored from saved data. When `tradeRestored` is true, allow the merge to run once.

Simpler approach: After setting `tradeLineItems` in `loadEstimateForEditing`, set `isEditingLoadedEstimate` to `false` briefly so the merge runs, then back to `true`. 

**Simplest approach**: Just don't rely on the merge effect at all for loaded estimates. The `SectionedLineItemsTable` already receives `materialItems` and `laborItems` which are derived from `lineItems`. The multi-trade grouping in the table uses `item.trade_type` to filter items into groups. So the real fix is: **the items themselves need `trade_type`**.

### Change 2: `handleSaveNewItem` — also update `tradeLineItems` when editing loaded estimate
Line 781: The condition `!isEditingLoadedEstimate` prevents adding to `tradeLineItems`. Remove this guard so items always go into the per-trade bucket, and trigger a one-time merge.

## Actual minimal fix

### `MultiTemplateSelector.tsx` — `loadEstimateForEditing` (~line 610-637)

When `tradeTypesInEstimate.size > 1`, after setting `tradeLineItems`, also update the flat `lineItems` to ensure every item has its `trade_type` tag (they should already from DB, but this handles edge cases).

When `tradeTypesInEstimate.size <= 1` but `tradeTypesInEstimate.size === 1`, still restore that single trade section so the system knows the trade context (this handles loading a single-trade estimate correctly).

**The real fix for THIS estimate**: The data was saved without trade metadata. We need to handle this in `loadEstimateForEditing` by detecting items that came from a multi-trade context but lost their metadata. Since the user chose "no auto-tagging," the only way to fix this specific estimate is to re-add the gutter trade, re-assign items, and re-save.

BUT — we can prevent this from happening again going forward. The `handleSaveLineItemChanges` fix (already applied) ensures `trade_type`/`trade_label` are saved. The remaining bug is:

### Fix A: `handleSaveNewItem` — allow `tradeLineItems` update in edit mode
```
Line 781: if (targetTradeSection && !isEditingLoadedEstimate) {
Change to: if (targetTradeSection) {
```
This ensures items added while editing a loaded estimate also go into `tradeLineItems`.

### Fix B: Allow merge effect to run after trade restoration
```
Line 548: if (isEditingLoadedEstimate) return;
Change to: if (isEditingLoadedEstimate && Object.keys(tradeLineItems).length === 0) return;
```
When `tradeLineItems` has entries (from restoration), allow the merge to update `lineItems` with proper trade tags.

### Fix C: In `loadEstimateForEditing`, when restoring trade sections, set `isEditingLoadedEstimate` AFTER the trade state is set
Move line 591 (`setIsEditingLoadedEstimate(true)`) to AFTER the trade restoration block (after line 636), so the merge effect can process the initial `tradeLineItems` before being locked out.

## Implementation order
1. Move `setIsEditingLoadedEstimate(true)` to after trade restoration (Fix C)
2. Remove `!isEditingLoadedEstimate` guard from `handleSaveNewItem` (Fix A)  
3. Update merge effect guard to allow merging when `tradeLineItems` has data (Fix B)

