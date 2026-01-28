# Plan: Bake Sales Tax Into Selling Price (Hide from Customer)

## ✅ COMPLETED

Sales tax is now **baked into the selling price** - customers see one total price with tax included, not shown as a separate line item.

---

## Changes Made

| File | Change |
|------|--------|
| `src/hooks/useEstimatePricing.ts` | `sellingPrice` now includes tax; added `preTaxSellingPrice` for internal tracking |
| `src/components/estimates/EstimatePDFDocument.tsx` | Sales tax line only shows for internal view; customer sees "Your Investment" with tax included |
| `src/components/estimates/EstimateBreakdownCard.tsx` | Shows "Tax Included" badge; displays pre-tax price for internal reference |
| `src/components/estimates/SectionedLineItemsTable.tsx` | Removed customer-facing tax rows; tax is baked into totals |

---

## How It Works Now

| View | What They See |
|------|---------------|
| **Customer PDF** | "Your Investment: $21,548.67" + note "Price includes applicable sales tax" |
| **Internal View** | Pre-tax: $20,611.08 → Tax: $937.59 → Total: $21,548.67 |
| **Database** | `selling_price` = tax-inclusive; `sales_tax_amount` still saved for accounting |

---

## Key Technical Changes

```typescript
// useEstimatePricing.ts - NEW LOGIC
const preTaxSellingPrice = sellingPrice;
const salesTaxAmount = config.salesTaxEnabled 
  ? materialsSellingPortion * (config.salesTaxRate / 100) 
  : 0;
const finalSellingPrice = sellingPrice + salesTaxAmount; // TAX BAKED IN

return {
  sellingPrice: finalSellingPrice,  // Customer sees this (includes tax)
  preTaxSellingPrice,               // Internal accounting
  salesTaxAmount,                   // Internal tracking
  totalWithTax: finalSellingPrice   // Backward compatibility
};
```
