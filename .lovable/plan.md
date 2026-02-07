
# Fix: Cover Page Shows "ROOFING ESTIMATE" Instead of Actual Estimate Name

## Root Cause

When you edit a saved estimate like "5V Mill Finish", the system loads the estimate data but **never populates the `estimateDisplayName` state variable** from the database field. 

The PDF export uses this fallback chain:
```typescript
const pdfEstimateName = estimateDisplayName || selectedTemplate?.name || 'ROOFING ESTIMATE';
```

Since `estimateDisplayName` is empty (cleared on line 388 but never repopulated), it falls through to the template name or ultimately "ROOFING ESTIMATE".

---

## What's Happening Step-by-Step

1. You click "Edit" on the saved estimate "5V Mill Finish"
2. The code at line 388 **clears** `estimateDisplayName` to an empty string
3. `loadEstimateForEditing()` fetches the estimate from the database (which has `display_name: "5V Mill Finish"`)
4. The function sets template ID, line items, pricing config... but **never** calls `setEstimateDisplayName(estimate.display_name)`
5. When you export PDF, `estimateDisplayName` is still empty → falls back to "ROOFING ESTIMATE"

---

## The Fix

Update `loadEstimateForEditing()` in `MultiTemplateSelector.tsx` to populate the display name and pricing tier from the loaded estimate.

### File: `src/components/estimates/MultiTemplateSelector.tsx`

**Location:** Inside `loadEstimateForEditing()` function, after loading line items (around line 460)

**Add these lines:**
```typescript
// Load display name and pricing tier from the estimate
if (estimate.display_name) {
  setEstimateDisplayName(estimate.display_name);
}
if (estimate.pricing_tier) {
  setEstimatePricingTier(estimate.pricing_tier);
}
```

This ensures that when editing an existing estimate:
- The display name input field shows the saved name
- The PDF cover page uses the correct estimate name
- The pricing tier badge displays correctly

---

## Summary

| Issue | Cause | Fix |
|-------|-------|-----|
| Cover page shows "ROOFING ESTIMATE" | `estimateDisplayName` not loaded from database | Add `setEstimateDisplayName(estimate.display_name)` in `loadEstimateForEditing()` |
| Pricing tier not shown when editing | `estimatePricingTier` not loaded from database | Add `setEstimatePricingTier(estimate.pricing_tier)` in `loadEstimateForEditing()` |

---

## Testing After Fix

1. Open an existing estimate (like "5V Mill Finish") for editing
2. Verify the "Estimate Display Name" input field shows "5V Mill Finish"
3. Export the PDF
4. Verify the cover page title shows "5V Mill Finish" instead of "ROOFING ESTIMATE"
