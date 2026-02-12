

## Move Project Financial Data Into the Profit Tab

### What's Happening Now

The Lead Details page currently shows TWO separate financial areas when a lead becomes a project:

1. **Profit tab** (in the EstimateHyperlinkBar) -- renders `ProfitCenterPanel` with selling price, cost comparison (original vs actual), invoices, commission breakdown
2. **ProjectFinancialSections** (below the hyperlink bar) -- a 6-card stats grid + 4 tabs (Budget, Cost Verification, Commission, Project Costs)

These overlap significantly: both show contract value, costs, gross profit, net profit, and commission. The estimate window already provides the reference data needed.

### Plan

**File: `src/pages/LeadDetails.tsx`**

1. **Remove the `ProjectFinancialSections` component entirely** (lines 230-385) -- delete the component definition and its rendering block (lines 1417-1423)

2. **Remove the standalone `ProfitSection` wrapper** (lines 223-228) since it just wraps `ProfitCenterPanel`

3. **Enhance the `profit` case in `renderActiveSection()`** (line 806-807) to include the merged content:
   - When `lead.status === 'project'` and `projectData` exists: render `ProfitCenterPanel` (existing) PLUS additional project-only tabs for **Budget** (`BudgetTracker`) and **Cost Verification** (`CostReconciliationPanel` + `InvoiceUploadCard`)
   - When NOT a project: render `ProfitCenterPanel` only (same as today)

**File: `src/components/estimates/ProfitCenterPanel.tsx`**

4. **Add a `projectId` optional prop** to `ProfitCenterPanel` so it can conditionally render the Budget and Cost Verification tabs alongside the existing Summary/Invoices/Details tabs

5. **Merge the commission tab content** from `ProjectFinancialSections` into the existing "Details" breakdown tab in `ProfitCenterPanel` (it already shows commission -- just ensure the data matches)

6. **Add a compact financial stats summary row** at the top of ProfitCenterPanel when projectId is present -- showing Contract Value, Total Costs, Gross Profit, Net Profit inline (replacing the separate 6-card grid)

### Result

- Clicking "Profit" in the EstimateHyperlinkBar shows everything: profit breakdown, invoices, commission, and (for projects) budget tracking and cost verification
- No more duplicate financial sections floating below the hyperlink bar
- The estimate tab stays focused on measurements, materials, labor -- the creation workflow
- The profit tab becomes the single destination for all financial tracking during and after project completion

### Technical Details

| Change | Location | Detail |
|--------|----------|--------|
| Delete `ProjectFinancialSections` | LeadDetails.tsx lines 230-385, 1417-1423 | Remove component + render call |
| Delete `ProfitSection` wrapper | LeadDetails.tsx lines 223-228 | Inline `ProfitCenterPanel` directly |
| Add `projectId` prop | ProfitCenterPanel.tsx | Optional prop, when present adds Budget + Cost Verification tabs |
| Expand TabsList | ProfitCenterPanel.tsx | From 3 tabs (Summary, Invoices, Details) to 5 tabs when project (+ Budget, Cost Verification) |
| Add stats row | ProfitCenterPanel.tsx | Compact 4-value summary at top when projectId present |
| Import BudgetTracker | ProfitCenterPanel.tsx | For budget tab content |
| Import CostReconciliationPanel | ProfitCenterPanel.tsx | For cost verification tab content |
