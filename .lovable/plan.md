

# Fix Profit Labels & Remove Company Net

## Problem
The current "Gross Profit" label shows profit **before** overhead deduction, but overhead is a real cost. What's labeled "Net Profit" (after overhead) is what should be called **Gross Profit**. The "Company Net" line should be hidden from reps.

## Changes

### 1. `src/components/estimates/ProfitCenterPanel.tsx`
- **4-card summary (lines 280-291)**: Remove the "Gross Profit" card, rename "Net Profit" card to "Gross Profit", change from 4-col to 3-col grid
- **Detailed breakdown (lines 518-522)**: Remove the "Gross Profit" line that shows pre-overhead profit
- **Detailed breakdown (lines 524-533)**: Rename "Net Profit" → "Gross Profit"
- **Commission section (lines 548-551)**: Remove the "Company Net" line

### 2. `src/components/estimates/RepProfitBreakdown.tsx`
- **Line 263**: Rename "Net Profit" → "Gross Profit"
- **Lines 318-321**: Remove "Company Net" line

The underlying math stays the same — overhead is already deducted for the `netProfit` / `profitAfterOverhead` variables. This is purely a labeling and visibility change.

