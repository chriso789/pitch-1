

# Fix Profit Center Summary Tab — Show Overhead in Cost Breakdown

## Problem
The **Summary tab** cost comparison table only shows Materials and Labor rows. The overhead percentage and actual overhead invoices are deducted in the math (`netProfit = grossProfit - overheadAmount`) but never shown as line items in the table. This makes the profit number seem wrong to the user — they can't see where the costs went.

Also, the label on line 387 still says "Net Profit" — should be "Gross Profit" per the earlier rename.

## Changes — `src/components/estimates/ProfitCenterPanel.tsx`

### 1. Add overhead row to the Summary cost comparison table (after line 380)
Add a row showing Company Overhead (percentage-based) as a cost line, similar to Materials and Labor. If there are actual overhead invoices, show those too.

### 2. Rename "Net Profit" → "Gross Profit" on line 387
The label in the Summary section still says "Net Profit" — align it with the card label and the Details tab.

### 3. Include overhead in "Total Costs" card
Currently `totalCost = effectiveMaterialCost + effectiveLaborCost + actualOverheadCost`. This should also include the percentage-based `overheadAmount` so the Total Costs card accurately reflects all deductions:
```
totalCost = effectiveMaterialCost + effectiveLaborCost + overheadAmount
```
(The `actualOverheadCost` from invoices would replace `overheadAmount` when overhead invoices exist, similar to how actuals replace estimates for materials/labor.)

This ensures: Contract Value − Total Costs = Gross Profit, which is what the user expects from the 3-card summary.

