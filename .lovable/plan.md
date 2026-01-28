
# Plan: Fix Sales Tax Display in Estimates

## Problem

In the estimate line items table, the "Total with Tax" row incorrectly calculates the final total as:
```
materialsTotal + laborTotal + salesTaxAmount
```

This is **wrong** because:
- `materialsTotal + laborTotal` = Direct Cost (internal cost to company)
- `salesTaxAmount` is calculated on the **selling price** (customer-facing price)
- Adding tax to direct cost produces an incorrect number

**Example:**
- Materials: $3,000, Labor: $2,000 → Direct Cost = $5,000
- Selling Price (with markup): $8,333
- Sales Tax (7%): $583.31 (7% of $8,333)
- **Wrong display**: $5,000 + $583.31 = $5,583.31
- **Correct display**: $8,333 + $583.31 = $8,916.31

---

## Solution

Update `SectionedLineItemsTable` to receive and display the correct `sellingPrice` and `totalWithTax` values from the pricing breakdown, instead of incorrectly adding tax to direct costs.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/SectionedLineItemsTable.tsx` | Add props for `sellingPrice` and `totalWithTax`, update display logic |
| `src/components/estimates/MultiTemplateSelector.tsx` | Pass `sellingPrice` and `totalWithTax` to SectionedLineItemsTable |

---

## Technical Details

### 1. Update SectionedLineItemsTable Props

Add two new optional props:
```typescript
interface SectionedLineItemsTableProps {
  // ... existing props
  sellingPrice?: number;    // Pre-tax selling price
  totalWithTax?: number;    // Final total including tax
}
```

### 2. Update the Display Logic

**Current (incorrect) - line 479:**
```typescript
{formatCurrency(materialsTotal + laborTotal + salesTaxAmount)}
```

**Fixed:**
```typescript
{formatCurrency(totalWithTax ?? (materialsTotal + laborTotal + salesTaxAmount))}
```

Also update the pre-tax subtotal display to show `sellingPrice` instead of `directCost`:
- Current: Shows "Direct Cost Total" then adds tax
- Fixed: Show "Subtotal (before tax)" as `sellingPrice`, then tax, then total

### 3. Update MultiTemplateSelector

Pass the additional breakdown values:
```typescript
<SectionedLineItemsTable
  // ... existing props
  salesTaxEnabled={config.salesTaxEnabled}
  salesTaxRate={config.salesTaxRate}
  salesTaxAmount={breakdown.salesTaxAmount}
  sellingPrice={breakdown.sellingPrice}           // NEW
  totalWithTax={breakdown.totalWithTax}           // NEW
/>
```

---

## Visual Change

**Before (incorrect):**
| Row | Value |
|-----|-------|
| Direct Cost Total | $5,000.00 |
| Sales Tax (7.00%) | $583.31 |
| Total with Tax | $5,583.31 ← WRONG |

**After (correct):**
| Row | Value |
|-----|-------|
| Direct Cost Total | $5,000.00 |
| Selling Price | $8,333.33 |
| Sales Tax (7.00%) | $583.31 |
| Total with Tax | $8,916.64 ← CORRECT |

---

## Alternative Simpler Approach

If showing the selling price in the line items table is not desired (since this table is for internal cost tracking), simply:
1. Remove the sales tax display entirely from `SectionedLineItemsTable`
2. Keep sales tax display only in `EstimateBreakdownCard` where it's already correct

This would be a cleaner separation:
- **Line items table**: Shows materials, labor, and direct costs (internal view)
- **Breakdown card**: Shows overhead, profit, selling price, tax, and total (customer-facing calculations)

---

## Recommendation

I recommend **Option 1** (the full fix) as it provides a complete view in the line items table. However, if you prefer keeping the line items table focused only on internal costs, Option 2 (removing tax from this table) would be cleaner.

---

## Summary

| What | Details |
|------|---------|
| Bug | Sales tax added to direct cost instead of selling price |
| Root cause | `SectionedLineItemsTable` didn't receive `sellingPrice` or `totalWithTax` |
| Fix | Pass and display correct values from breakdown |
| Files changed | 2 files |
