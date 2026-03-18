

# Refine Profit Center: Other Charges, Overhead Tab, Dump Fees, Pipeline Status Buttons

## Summary

Three areas to fix: (1) the overhead tab is a placeholder — needs real content showing permit fees, dump fees, and overhead invoices; (2) the profit calculation and summary don't account for "other charges" (overhead invoices like permits, dumpsters); (3) the dashboard pipeline status grid needs layout cleanup.

## Changes

### 1. Overhead Tab — Replace placeholder with real content (`src/pages/LeadDetails.tsx`, lines 709-722)

Replace the empty placeholder with a functional overhead section:
- Show the **percentage-based overhead** calculation (rate % of selling price)
- List all **overhead invoices** (permits, dumpster, disposal, etc.) fetched from `project_cost_invoices` where `invoice_type = 'overhead'`
- Add a **Dump Fee** section with adjustable price-per-dump and number-of-dumps fields, stored as an overhead invoice
- Include the overhead `InvoiceUploadCard` so users can add permits and other charges directly from this tab
- Show a total of all overhead charges (percentage + invoices)

### 2. Profit Calculation — Include overhead invoices in summary (`src/components/estimates/ProfitCenterPanel.tsx`)

The current profit calculation uses `effectiveOverheadCost` which is either the percentage-based overhead OR actual overhead invoices. But "other charges" like permits and dump fees that are uploaded as overhead invoices need to be:
- Shown as a separate "Other Charges" row in the Summary cost table (below the Overhead row)
- Add an "Other Charges" row that shows the total of overhead invoices broken down by category
- Update `totalCost` to ensure these are included (they already are since they're `invoice_type = 'overhead'`, but the UI needs to show them distinctly)

Actually, looking more closely — overhead invoices (permits, dumps, etc.) are already summed into `actualOverheadCost` and used as `effectiveOverheadCost`. The issue is that the user wants to see these **separately** from the percentage overhead, not replacing it. The percentage overhead covers insurance/office/admin, while permits and dump fees are additional project-specific charges.

**Updated approach**: Split overhead invoices into two buckets:
- Keep percentage-based overhead as "Company Overhead"
- Show overhead invoices (permits, dumps, etc.) as "Other Charges" — these are **additive**, not a replacement
- Update `totalCost = effectiveMaterialCost + effectiveLaborCost + overheadAmount + otherChargesTotal`
- Update `grossProfit = sellingPrice - totalCost`

### 3. Dump Fee per Job (`src/pages/LeadDetails.tsx` overhead section)

Add an inline form in the Overhead tab:
- **Price per dump** input (default from tenant settings or $350)
- **Number of dumps** input (default 1)
- **Total** auto-calculated
- On save, creates/updates an overhead invoice with `overhead_category = 'dump_fee'`

### 4. Pipeline Status Buttons — Improve layout (`src/features/dashboard/components/Dashboard.tsx`, lines 551-559)

The current grid `grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8` creates awkward wrapping. Clean up:
- Use `flex flex-wrap` with consistent min-width items instead of rigid grid
- Reduce padding on mobile, ensure text doesn't truncate awkwardly
- Use consistent sizing so all status boxes are equal width

### 5. Remove "Cost Verification" tab from Profit Center (`src/components/estimates/ProfitCenterPanel.tsx`)

The user asked "what is this cost verification button?" — it's redundant with the Budget tab and adds confusion. Remove the tab from the Profit Center panel.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/LeadDetails.tsx` | Replace overhead placeholder with functional overhead panel (invoices list, dump fee form, overhead invoice upload) |
| `src/components/estimates/ProfitCenterPanel.tsx` | Split overhead into "Company Overhead" + "Other Charges" rows; remove Cost Verification tab; update totalCost calculation |
| `src/features/dashboard/components/Dashboard.tsx` | Clean up pipeline status grid layout for better fit |
| `src/components/estimates/EstimateHyperlinkBar.tsx` | Update overhead bar cell to show combined overhead + other charges total |

