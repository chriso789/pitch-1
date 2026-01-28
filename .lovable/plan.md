

# Plan: Bake Sales Tax Into Selling Price (Hide from Customer)

## Understanding the Requirement

Currently, sales tax is:
- Calculated separately as `salesTaxAmount`
- Saved as separate database fields (`sales_tax_amount`, `total_with_tax`)  
- Shown to customers on PDFs and UI as a separate line item

**What you want instead:**
- Sales tax should be **included in the selling price** (not a separate line)
- Customer sees **one total price** that already has tax baked in
- Internally, you can still track tax for accounting, but it's not visible to customers
- The saved `selling_price` should be the final price including tax

---

## Changes Summary

| Area | Current Behavior | New Behavior |
|------|-----------------|--------------|
| **Selling price calculation** | `sellingPrice` + `salesTaxAmount` = `totalWithTax` | `sellingPrice` already includes tax |
| **Customer PDF** | Shows "Sales Tax (7%)" line + "Total with tax" | Shows just "Total Investment" |
| **Internal view** | Shows tax breakdown | Still shows tax breakdown for accounting |
| **Database** | Saves separate `sales_tax_amount` and `total_with_tax` | Tax baked into `selling_price`, tax fields kept for accounting records |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useEstimatePricing.ts` | Make `sellingPrice` include tax; keep `salesTaxAmount` for internal tracking only |
| `src/components/estimates/EstimatePDFDocument.tsx` | Remove sales tax line from customer view; keep for internal view |
| `src/components/estimates/EstimateBreakdownCard.tsx` | Update display to show tax is included; clarify internal vs customer view |
| `src/components/estimates/SectionedLineItemsTable.tsx` | Remove customer-facing sales tax rows |
| `src/components/estimates/MultiTemplateSelector.tsx` | Update saved estimate to reflect tax-inclusive pricing |

---

## Technical Details

### 1. Update Pricing Hook (`useEstimatePricing.ts`)

The key change: Calculate `sellingPrice` to **include** tax for customer display, but still track `salesTaxAmount` internally.

**Current calculation:**
```typescript
// Current: Tax is separate
const sellingPrice = directCost / (1 - overheadDecimal - profitDecimal);
const salesTaxAmount = materialsSellingPortion * (taxRate / 100);
const totalWithTax = sellingPrice + salesTaxAmount;
```

**New calculation:**
```typescript
// New: Tax is included in selling price
const preTaxSellingPrice = directCost / (1 - overheadDecimal - profitDecimal);
const materialsRatio = directCost > 0 ? materialsTotal / directCost : 0;
const materialsPortion = preTaxSellingPrice * materialsRatio;
const salesTaxAmount = config.salesTaxEnabled 
  ? materialsPortion * (config.salesTaxRate / 100) 
  : 0;
const sellingPrice = preTaxSellingPrice + salesTaxAmount; // TAX BAKED IN

// Keep separate fields for internal accounting
return {
  sellingPrice,              // Customer-facing: includes tax
  preTaxSellingPrice,        // Internal: before tax
  salesTaxAmount,            // Internal: for accounting
  totalWithTax: sellingPrice // Now same as sellingPrice (for backward compatibility)
};
```

### 2. Update PDF Document (`EstimatePDFDocument.tsx`)

**Remove sales tax line for customer view:**
```tsx
// REMOVE this entire block for customer view:
{/* Sales Tax (if enabled) - ONLY show for internal view */}
{opts.showCostBreakdown && config.salesTaxEnabled && config.salesTaxRate > 0 && (
  <div className="flex justify-between text-xs">
    <span className="text-gray-600">Sales Tax ({config.salesTaxRate.toFixed(2)}%)</span>
    <span className="font-medium">{formatCurrency(breakdown.salesTaxAmount || 0)}</span>
  </div>
)}
```

**Customer sees:**
- "Your Investment" or "Total" → Just `sellingPrice` (which now includes tax)

**Internal view sees:**
- Pre-tax subtotal
- Sales tax line
- Total (same as selling price)

### 3. Update Breakdown Card (`EstimateBreakdownCard.tsx`)

**For customer/display view:**
- Show selling price as the final number
- Add small note: "Price includes applicable sales tax" (optional)
- Remove separate tax line display

**For internal view:**
- Keep tax breakdown visible for accounting
- Show "Pre-tax selling price", "Sales Tax", "Final Price"

### 4. Update Line Items Table (`SectionedLineItemsTable.tsx`)

**Remove these rows from customer-facing table:**
- "Selling Price (before tax)" row
- "Sales Tax on Materials" row
- "Total with Tax" row

**Just show:**
- Direct Cost Total (internal only)
- Total → the final `sellingPrice` (which includes tax)

### 5. Update Estimate Saving (`MultiTemplateSelector.tsx`)

**Database fields adjustment:**
```typescript
// Current save:
selling_price: breakdown.sellingPrice,          // Pre-tax
sales_tax_amount: breakdown.salesTaxAmount,     // Separate
total_with_tax: breakdown.totalWithTax,         // With tax

// New save:
selling_price: breakdown.sellingPrice,          // NOW INCLUDES TAX
sales_tax_amount: breakdown.salesTaxAmount,     // Still saved for accounting
total_with_tax: breakdown.sellingPrice,         // Same as selling_price (backward compat)
pre_tax_selling_price: breakdown.preTaxSellingPrice  // NEW: for internal records
```

---

## Customer vs Internal View

| View | What They See |
|------|---------------|
| **Customer PDF** | Materials/Labor items → **Total: $21,548.67** (tax included, not shown separately) |
| **Internal View** | Full breakdown: Pre-tax $20,611.08 + Tax $937.59 = Total $21,548.67 |

---

## Backward Compatibility

- Existing estimates with separate `sales_tax_amount` will still work
- `total_with_tax` field remains for any legacy queries
- Internal reports can still access tax amounts

---

## Database Schema (Optional Enhancement)

Consider adding a field to clarify tax inclusion:
```sql
ALTER TABLE enhanced_estimates 
ADD COLUMN pre_tax_selling_price NUMERIC(12,2);
```

This keeps the original pre-tax calculation for internal accounting while `selling_price` shows the customer-facing tax-inclusive amount.

---

## Summary

| What | Change |
|------|--------|
| **Customer sees** | Single total price (tax included, not shown separately) |
| **Internal sees** | Full breakdown with tax line for accounting |
| **Database** | `selling_price` = tax-inclusive; `sales_tax_amount` kept for records |
| **PDFs** | Customer PDFs show clean total; Internal PDFs show tax breakdown |
| **Files changed** | 5 files |

