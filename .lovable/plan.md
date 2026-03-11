

# Plan: Fix Commission Rate Not Reflecting Current Rep Rate (60% vs 50%)

## Root Cause

When editing an existing estimate, `loadEstimateForEditing` (line 654-661 in `MultiTemplateSelector.tsx`) calls `setConfig` with the **saved** commission rate from the estimate record:

```typescript
repCommissionPercent: estimate.rep_commission_percent || 5,  // Saved as 50%
```

This overwrites the correct 60% that `fetchAssignedRepRates` (line 414) already set from the rep's current profile. Both effects fire on mount, but `loadEstimateForEditing` resolves last, stomping the current rate with the stale saved value.

The estimate `OBR-00033` has `rep_commission_percent: 50` saved in the database, while Test Rep's profile now has `commission_rate: 60`.

## Fix

**File: `src/components/estimates/MultiTemplateSelector.tsx` (lines 654-661)**

Remove `repCommissionPercent` and `commissionStructure` from the `setConfig` call inside `loadEstimateForEditing`. The rep's **current** profile rates should always be authoritative — these are set by the `fetchAssignedRepRates` effect.

```typescript
// Before (line 654-661):
setConfig({
  overheadPercent: estimate.overhead_percent || 15,
  profitMarginPercent: targetMargin,
  repCommissionPercent: estimate.rep_commission_percent || 5,
  salesTaxEnabled: (estimate.sales_tax_rate || 0) > 0,
  salesTaxRate: estimate.sales_tax_rate || 0,
  ...(calcMetadata?.pricing_config?.commissionStructure ? { commissionStructure: calcMetadata.pricing_config.commissionStructure } : {}),
});

// After:
setConfig({
  overheadPercent: estimate.overhead_percent || 15,
  profitMarginPercent: targetMargin,
  salesTaxEnabled: (estimate.sales_tax_rate || 0) > 0,
  salesTaxRate: estimate.sales_tax_rate || 0,
});
```

To handle the race condition (estimate loads before rep rates arrive), also ensure `fetchAssignedRepRates` re-fires after estimate loading by adding a re-trigger. Specifically, after setting config in `loadEstimateForEditing`, re-call `fetchAssignedRepRates` or trigger the effect to re-run by depending on `existingEstimateId`.

The simplest approach: change the `fetchAssignedRepRates` useEffect dependency to also include `existingEstimateId`, so it re-runs after an estimate is loaded, always applying the current rep rate last.

## Summary
- 1 file changed: `MultiTemplateSelector.tsx`
- Remove saved `repCommissionPercent`/`commissionStructure` from estimate load config
- Add `existingEstimateId` to `fetchAssignedRepRates` effect deps so current rep rates always win

