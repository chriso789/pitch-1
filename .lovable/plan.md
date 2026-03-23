

## Plan: Fix Search, Add Color Field, Stop Price Drift

### Issue 1: Search Can't Find "Mariotti"

**Root Cause**: The `search_contacts_and_jobs` RPC filters leads/jobs by `p_location_id`. The user's current location is "West Coast" but the Mariotti lead is assigned to "Main Office". The contact row IS returned (contacts are tenant-wide), but the lead/job row is filtered out — so the job result disappears.

**Fix**: Update the RPC to remove the location filter on leads/jobs. Since the user wants company-wide search, the `p_location_id` filter should be removed from the leads query. Contacts are already tenant-wide.

**File**: New migration to update `search_contacts_and_jobs` — remove the location filter clause (`p_location_id IS NULL OR pe.location_id = p_location_id ...`) from the leads union.

---

### Issue 2: Add Product Color Field to Materials Tab

**Root Cause**: The `TemplateSectionSelector` (Materials tab on projects) has no `notes`/color column. Its `LineItem` interface only has `id, item_name, qty, unit, unit_cost, line_total`.

**Fix**: 
- Add a `notes` field to the `LineItem` interface in `TemplateSectionSelector`
- Add a "Color / Notes" column to the table
- Make it editable (inline input) and save it with the line items
- Preserve existing `notes` data when loading from `line_items` JSON

**File**: `src/components/estimates/TemplateSectionSelector.tsx`

---

### Issue 3: System Randomly Changing Estimate Prices

**Root Cause**: `TemplateSectionSelector.saveLineItemsMutation` (line 222) hardcodes `const sellingPrice = costPreProfit / 0.7` every time a material or labor line item is edited from the Materials/Labor tabs. This overwrites the actual saved selling price with a naive 30% margin calculation, ignoring:
- The estimate's actual saved `selling_price`
- Fixed price mode
- The rep's configured overhead/profit rates
- Any manual price adjustments made via EstimateHyperlinkBar

Every time a user edits a qty or cost in the Materials/Labor tab and it auto-saves, the selling price gets recalculated to `(materials + labor) / 0.7`, destroying the real price.

**Fix**: Change `TemplateSectionSelector.saveLineItemsMutation` to preserve the existing `selling_price` from the estimate record. Only update the `material_cost` or `labor_cost` column and the `line_items` JSON — do NOT touch `selling_price`.

```typescript
// BEFORE (broken):
const sellingPrice = costPreProfit / 0.7; // 30% margin
.update({
  line_items: updatedLineItems,
  [costKey]: total,
  selling_price: sellingPrice,  // <-- THIS DESTROYS THE REAL PRICE
})

// AFTER (fixed):
.update({
  line_items: updatedLineItems,
  [costKey]: total,
  // DO NOT update selling_price - preserve the value set by the estimate builder
})
```

**File**: `src/components/estimates/TemplateSectionSelector.tsx`

---

### Files to Change

1. **New migration** — Update `search_contacts_and_jobs` RPC to remove location filter on leads/jobs
2. **`src/components/estimates/TemplateSectionSelector.tsx`** — Add notes/color column + stop overwriting selling_price

