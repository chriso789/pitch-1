

# Fix Overhead to Calculate on Full Tax-Included Selling Price

## Problem

Currently, overhead is calculated on the **pre-tax** selling price. The user expects overhead to be a percentage of the **final selling price (tax included)** -- because that's the actual contract value the customer pays.

**Screenshot numbers (current -- WRONG):**
- Direct Cost: $19,736.25
- Overhead (10%): $3,289.37 (= 10% of $32,893.75 pre-tax)
- Selling Price: $34,484.38 (includes tax)

**What the user expects (CORRECT):**
- Overhead should be 10% of the final $34,484.38, not the pre-tax subtotal

## Root Cause

In `useEstimatePricing.ts`, the algebraic formula solves for a pre-tax selling price and then applies overhead to that pre-tax number:

```
sellingPrice = directCost / (1 - overheadRate - profitRate)
overheadAmount = sellingPrice * overheadRate   // <-- pre-tax base
tax = sellingPrice * materialsRatio * taxRate
finalPrice = sellingPrice + tax
```

Overhead never accounts for the tax portion that gets added afterward.

## Fix: Updated Algebra

The new formula incorporates tax into the overhead base. If overhead should be a percentage of the final price (pre-tax + tax), we solve:

```
S = DC / (1 - oh*(1 + mr*t) - p)

where:
  S   = pre-tax selling price (intermediate)
  DC  = direct cost
  oh  = overhead rate (decimal)
  p   = profit rate (decimal)
  mr  = materials ratio (materialsTotal / directCost)
  t   = tax rate (decimal)

then:
  tax = S * mr * t
  finalPrice = S + tax
  overheadAmount = finalPrice * oh    <-- now on FULL price
  profitAmount = S * p
```

This ensures overhead is always calculated on the total contract value including tax.

## Files Modified (4 files)

### 1. `src/hooks/useEstimatePricing.ts` -- Core pricing engine

**Lines 151-166 (standard mode calculation):**

Replace:
```typescript
const divisor = 1 - overheadDecimal - profitDecimal;
sellingPrice = directCost / divisor;
overheadAmount = sellingPrice * overheadDecimal;
profitAmount = sellingPrice * profitDecimal;
```

With:
```typescript
const materialsRatio = directCost > 0 ? materialsTotal / directCost : 0;
const taxFactor = config.salesTaxEnabled ? materialsRatio * (config.salesTaxRate / 100) : 0;
const divisor = 1 - overheadDecimal * (1 + taxFactor) - profitDecimal;
sellingPrice = directCost / divisor;  // pre-tax intermediate
profitAmount = sellingPrice * profitDecimal;
// Overhead on FULL price (pre-tax + tax)
const taxAmount = sellingPrice * taxFactor;
overheadAmount = (sellingPrice + taxAmount) * overheadDecimal;
```

**Lines 132-150 (fixed price mode):** Update similarly -- derive overhead from the tax-included fixed price directly:
```typescript
overheadAmount = fixedPrice * (config.overheadPercent / 100);
```

### 2. `supabase/functions/update-estimate-line-items/index.ts` -- Edge function

**Lines 170-174:** Change overhead from pre-tax to full selling price:
```typescript
// OLD: overhead on pre-tax
const preTaxSellingPrice = finalSellingPrice - salesTaxAmount;
const overheadAmount = preTaxSellingPrice * (overheadPercent / 100);

// NEW: overhead on full selling price (tax included)
const overheadAmount = finalSellingPrice * (overheadPercent / 100);
```

### 3. `src/components/estimates/EstimateHyperlinkBar.tsx`

**Line 142 (updatePriceMutation):** Change overhead to use full price:
```typescript
// OLD
const overheadAmount = preTaxPrice * (overheadRate / 100);
// NEW
const overheadAmount = newPrice * (overheadRate / 100);
```

**Lines 211-216 (calculateRepOverhead):** Change to use full sale price:
```typescript
const salePrice = hyperlinkData?.sale_price || calculations?.selling_price || 0;
return salePrice * (salesRepOverheadRate / 100);  // full price, no tax subtraction
```

### 4. `src/components/estimates/RepProfitBreakdown.tsx`

**Lines 128-129:** Change overhead to use full selling price:
```typescript
// OLD
const preTaxSellingPrice = sellingPrice - salesTaxAmount;
const overheadAmount = preTaxSellingPrice * (overheadRate / 100);

// NEW: overhead on full selling price (tax included)
const overheadAmount = sellingPrice * (overheadRate / 100);
```

## Verification with Screenshot Numbers

With the fix applied to the user's example (DC=$19,736.25, OH=10%, Profit=30%, Tax=7%, materialsRatio=0.6908):

```
taxFactor = 0.6908 * 0.07 = 0.04836
divisor = 1 - 0.10*(1 + 0.04836) - 0.30 = 1 - 0.10484 - 0.30 = 0.59516
S_pretax = 19,736.25 / 0.59516 = $33,160
tax = 33,160 * 0.04836 = $1,604
finalPrice = $34,764
overhead = $34,764 * 0.10 = $3,476  (now 10% of FULL price)
profit = $33,160 * 0.30 = $9,948
```

Overhead is now correctly calculated on the total tax-included selling price.

