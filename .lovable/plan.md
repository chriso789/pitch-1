
# Plan: Apply Sales Tax Only to Materials (Not Labor)

## Problem

Currently, sales tax (7%) is calculated on the **entire selling price** ($19,611.08), resulting in $1,372.78 tax.

**Current (incorrect):**
- Selling Price: $19,611.08
- Sales Tax: $19,611.08 × 7% = **$1,372.78**

**Expected (correct - tax only on materials):**
- Materials Cost: $8,708.00
- Materials with markup: ~$13,394 (materials portion of selling price)
- Sales Tax: $13,394 × 7% = **~$937.58**

In construction, labor (services) is typically tax-exempt - only tangible goods (materials) are taxable.

---

## Solution

Calculate the **materials portion of the selling price** and apply tax only to that amount.

**Formula:**
```
Materials Selling Portion = (Materials Cost / Direct Cost) × Selling Price
Sales Tax = Materials Selling Portion × Tax Rate
```

This proportionally allocates the markup between materials and labor, then taxes only the materials portion.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useEstimatePricing.ts` | Calculate tax on materials portion only |
| `src/components/estimates/EstimateBreakdownCard.tsx` | Update label to clarify "Sales Tax (on materials)" |
| `src/components/estimates/SectionedLineItemsTable.tsx` | Update label to clarify tax applies to materials only |

---

## Technical Details

### 1. Update useEstimatePricing.ts (lines 169-173)

**Current:**
```typescript
// Calculate sales tax (applied to selling price)
const salesTaxAmount = config.salesTaxEnabled 
  ? sellingPrice * (config.salesTaxRate / 100) 
  : 0;
```

**Fixed:**
```typescript
// Calculate sales tax (applied to MATERIALS portion only - labor is tax-exempt)
// Proportionally allocate selling price between materials and labor
const materialsRatio = directCost > 0 ? materialsTotal / directCost : 0;
const materialsSellingPortion = sellingPrice * materialsRatio;
const salesTaxAmount = config.salesTaxEnabled 
  ? materialsSellingPortion * (config.salesTaxRate / 100) 
  : 0;
```

### 2. Add materialsSellingPortion to PricingBreakdown

Add a new field to the breakdown interface so the UI can display what amount is being taxed:

```typescript
export interface PricingBreakdown {
  // ... existing fields
  materialsSellingPortion: number; // NEW - for tax display
  salesTaxAmount: number;
  totalWithTax: number;
}
```

### 3. Update UI Labels

**EstimateBreakdownCard.tsx** (line 193):
- Change: `Sales Tax ({config.salesTaxRate.toFixed(2)}%)`
- To: `Sales Tax on Materials ({config.salesTaxRate.toFixed(2)}%)`

**SectionedLineItemsTable.tsx** (line 480):
- Change: `Sales Tax ({salesTaxRate.toFixed(2)}%)`
- To: `Sales Tax on Materials ({salesTaxRate.toFixed(2)}%)`

---

## Expected Results

**Before (incorrect):**
| Item | Value |
|------|-------|
| Materials Cost | $8,708.00 |
| Labor Cost | $4,039.20 |
| Selling Price | $19,611.08 |
| Sales Tax (7%) | $1,372.78 (on full selling price) |
| **Total with Tax** | **$20,983.85** |

**After (correct):**
| Item | Value |
|------|-------|
| Materials Cost | $8,708.00 |
| Labor Cost | $4,039.20 |
| Selling Price | $19,611.08 |
| Materials Portion | ~$13,394.14 (68.3% of selling price) |
| Sales Tax (7% on materials) | ~$937.59 |
| **Total with Tax** | **~$20,548.67** |

**Calculation verification:**
- Materials ratio: $8,708 / $12,747.20 = 68.31%
- Materials selling portion: $19,611.08 × 68.31% = $13,394.14
- Tax: $13,394.14 × 7% = $937.59

---

## Summary

| What | Details |
|------|---------|
| Bug | Sales tax applied to entire selling price instead of materials only |
| Root cause | `useEstimatePricing.ts` didn't separate materials vs labor for tax |
| Fix | Calculate materials ratio, apply tax to materials portion only |
| Industry standard | Labor/services are tax-exempt in most construction jurisdictions |
| Files changed | 3 files |
