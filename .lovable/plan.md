

# Fix Overhead Calculation Across All Profiles

## Problem

Overhead should always be calculated on the **pre-tax selling price**, but several components and the edge function calculate it on the **tax-included selling price**, inflating the overhead amount. Additionally, `RepProfitBreakdown` doesn't fetch the `overhead_rate` fallback field from profiles.

## Root Cause Analysis

The core pricing hook (`useEstimatePricing.ts`) correctly calculates overhead on the pre-tax amount. But when the data is saved and re-read, the stored `selling_price` **includes tax**. Other components then multiply overhead % by this inflated number.

## Bugs Found (5 locations)

### 1. Edge Function: `update-estimate-line-items` (line 172)
```
// BUG: finalSellingPrice includes sales tax
const overheadAmount = finalSellingPrice * (overheadPercent / 100);
```
**Fix**: Subtract `sales_tax_amount` before calculating overhead.

### 2. `EstimateHyperlinkBar.tsx` (line 140)
```
// BUG: newPrice is tax-included
const overheadAmount = newPrice * (overheadRate / 100);
```
**Fix**: Subtract the estimate's `sales_tax_amount` before computing overhead.

### 3. `EstimateHyperlinkBar.tsx` (lines 210-212)
```
// BUG: salePrice includes tax
const salePrice = hyperlinkData?.sale_price || ...;
return salePrice * (salesRepOverheadRate / 100);
```
**Fix**: Subtract `sales_tax_amount` from `salePrice`.

### 4. `RepProfitBreakdown.tsx` (lines 54-66)
**BUG**: Query only fetches `personal_overhead_rate`, not `overhead_rate`. Falls back to hardcoded `10` instead of using the profile's `overhead_rate` field.
**Fix**: Add `overhead_rate` to the SELECT query and apply the hierarchy: `personal_overhead_rate > 0 ? personal : base`.

### 5. `ProfitCenterPanel.tsx` (line 25-29)
**BUG**: `SalesRepData` interface doesn't include `overhead_rate` -- relies on `as any` cast.
**Fix**: Add `overhead_rate` to the interface for type safety.

## Files Modified

1. **`supabase/functions/update-estimate-line-items/index.ts`** -- Subtract sales tax before overhead calculation
2. **`src/components/estimates/EstimateHyperlinkBar.tsx`** -- Subtract sales tax in both overhead calculations
3. **`src/components/estimates/RepProfitBreakdown.tsx`** -- Fetch `overhead_rate` and apply hierarchy
4. **`src/components/estimates/ProfitCenterPanel.tsx`** -- Add `overhead_rate` to interface

## Technical Details

### Correct Overhead Formula (consistent everywhere)
```
preTaxSellingPrice = sellingPrice - salesTaxAmount
overheadAmount = preTaxSellingPrice * (overheadRate / 100)
```

### Correct Overhead Rate Hierarchy (consistent everywhere)
```
effectiveRate = personal_overhead_rate > 0 ? personal_overhead_rate : overhead_rate ?? 10
```

### Edge Function Change (update-estimate-line-items)

Around line 168-172, add sales tax subtraction:
```typescript
const salesTaxAmount = estimate.sales_tax_amount || 0;
const preTaxSellingPrice = finalSellingPrice - salesTaxAmount;
const overheadAmount = preTaxSellingPrice * (overheadPercent / 100);
```

### RepProfitBreakdown Query Fix

Add `overhead_rate` to both profile selects and use the hierarchy:
```typescript
profiles!pipeline_entries_assigned_to_fkey(
  first_name, last_name,
  overhead_rate,            // ADD THIS
  personal_overhead_rate,
  commission_rate, commission_structure
)
```
Then:
```typescript
const personalOH = primaryRep?.personal_overhead_rate ?? 0;
const baseOH = primaryRep?.overhead_rate ?? 10;
const primaryOverheadRate = personalOH > 0 ? personalOH : baseOH;
```

Same fix for secondary rep.

