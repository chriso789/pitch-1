
# Fix: Fixed Price Override Should Be the Final Total (Tax Included)

## Problem

When a user enters a Fixed Price Override of $58,650, the system currently **adds sales tax on top**, resulting in a final price of $61,303.84. The user expects $58,650 to BE the final customer-facing selling price, with the system back-calculating the pre-tax amounts to fit within that total.

---

## Root Cause

In `src/hooks/useEstimatePricing.ts` (lines 132-183):

```typescript
if (isFixedPrice) {
  sellingPrice = fixedPrice!;  // ← Treated as PRE-TAX
  // ... calculations ...
}

// Later:
const finalSellingPrice = sellingPrice + salesTaxAmount;  // ← Tax ADDED on top
```

The fixed price is treated as the pre-tax price, then sales tax is added, which inflates the final total beyond what the user entered.

---

## Solution

When fixed price is enabled, treat the user's input as the **FINAL selling price (tax included)**, and back-calculate the pre-tax selling price mathematically:

```text
Given:
  - fixedPrice = Final price user wants (includes tax)
  - taxRate = e.g., 7%
  - materialsRatio = materials portion of direct costs

We need:
  preTaxSellingPrice = fixedPrice / (1 + taxRate × materialsRatio)
```

Then calculate overhead and profit from this derived pre-tax amount.

---

## Technical Changes

### File: `src/hooks/useEstimatePricing.ts`

**Change the fixed price logic (lines 132-137):**

```typescript
if (isFixedPrice) {
  // Fixed price mode: user-entered price IS the final tax-included price
  // Back-calculate the pre-tax selling price to make everything fit
  
  // Calculate materials ratio first (for tax calculation)
  const materialsRatio = directCost > 0 ? materialsTotal / directCost : 0;
  
  // Derive pre-tax selling price from fixed price
  // fixedPrice = preTaxSelling + (preTaxSelling × materialsRatio × taxRate)
  // fixedPrice = preTaxSelling × (1 + materialsRatio × taxRate)
  // preTaxSelling = fixedPrice / (1 + materialsRatio × taxRate)
  const taxMultiplier = config.salesTaxEnabled 
    ? 1 + (materialsRatio * (config.salesTaxRate / 100))
    : 1;
  
  sellingPrice = fixedPrice! / taxMultiplier;  // Pre-tax selling price
  overheadAmount = sellingPrice * (config.overheadPercent / 100);
  profitAmount = sellingPrice - directCost - overheadAmount;
  actualProfitMargin = sellingPrice > 0 ? (profitAmount / sellingPrice) * 100 : 0;
}
```

**Keep the rest of the calculation the same**, because now:
- `sellingPrice` = derived pre-tax amount
- `salesTaxAmount` = calculated from `sellingPrice × materialsRatio × taxRate`
- `finalSellingPrice = sellingPrice + salesTaxAmount` = equals original `fixedPrice` ✓

---

## Expected Result After Fix

**User Input:**
- Fixed Price: $58,650

**System Calculates:**
- Pre-tax selling price: ~$55,996 (back-calculated to include tax buffer)
- Sales Tax (7% of materials portion): ~$2,654
- **Final Selling Price: $58,650** (exactly what user entered) ✓

**Displayed:**
- Profit margin adjusts based on the lower pre-tax price
- Tax still shows as "included in total"
- Customer sees their exact entered price

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useEstimatePricing.ts` | Update fixed price calculation to back-calculate pre-tax amount from user's tax-included total |

---

## Testing Plan

1. Enable Fixed Price Override
2. Enter a round number like $60,000
3. Verify the Selling Price displays exactly $60,000 (not $60,000 + tax)
4. Verify the sales tax line shows the embedded tax amount
5. Verify profit margin and overhead are calculated from the pre-tax portion
6. Test with sales tax disabled to ensure behavior is unchanged
