

## Merge Project Page Into Lead Page

### Concept

Once a lead passes "Ready for Approval" and becomes a "Project," there should be no separate Project Details page. The Lead Details page already handles this status -- it shows the `project` status badge and production stage. The fix is to **redirect the `/project/:id` route to the Lead Details page** using the pipeline entry ID, so there is only ONE detail page for the entire lead-to-project lifecycle.

The project-specific content (financial stats, budget, cost verification, commission, costs) will be added as additional sections/tabs within the Lead Details page when the status is `project`.

### What Changes

**1. Route redirect (`src/pages/ProjectDetails.tsx`)**
- Instead of rendering the old `ProjectDetails` component, look up the project's `pipeline_entry_id` and redirect to `/lead/{pipeline_entry_id}`
- This ensures every link to `/project/:id` lands on the unified Lead/Project page

**2. Add project-specific sections to Lead Details (`src/pages/LeadDetails.tsx`)**
- When the lead status is `project`, add new tabs/sections to the EstimateHyperlinkBar or below it:
  - **Financial Stats Grid** (6-card summary: Contract Value, Total Costs, Gross Profit, Net Profit, Budget Variance, Est. Completion)
  - **Budget** tab (BudgetTracker component)
  - **Cost Verification** tab (CostReconciliationPanel + InvoiceUploadCard)
  - **Commission** tab (existing commission breakdown)
  - **Costs** tab (project costs list)
  - **QBO Sync** button in the header actions area
- These sections only appear when `lead.status === 'project'` and a linked project record exists

**3. Fetch project data conditionally (`src/hooks/useLeadDetails.ts`)**
- Add a conditional query: when the pipeline entry has a linked project (via `projects` table), fetch `project_budget_items`, `project_costs`, `project_budget_snapshots`, and `estimates` for the financial calculations
- Add commission calculation via the existing `calculate_enhanced_rep_commission` RPC
- Expose this data through the hook so the Lead Details page can render the project sections

**4. Update navigation links**
- Anywhere in the app that links to `/project/:id` will still work because the route now redirects
- The pipeline board, contact profile, and any other places linking to projects will seamlessly land on the unified page

### What Stays the Same

- The Lead Details page layout (header, status dropdown, address, metadata, sales rep, contact card, internal notes, approval requirements, communication hub, estimate system) -- all unchanged
- The `projects` table and data model -- unchanged
- Pre-approval leads look exactly the same as today

### Technical Details

| File | Change |
|------|--------|
| `src/pages/ProjectDetails.tsx` | Replace component body with a redirect: query project's `pipeline_entry_id`, then `navigate(/lead/{id}, { replace: true })` |
| `src/pages/LeadDetails.tsx` | Add project-specific sections (financial stats, budget, cost verification, commission, costs) gated by `lead.status === 'project'` |
| `src/hooks/useLeadDetails.ts` | Add conditional project data query (budget items, costs, snapshots, commission) when status is `project` |
| `src/features/projects/components/ProjectDetails.tsx` | No longer used for the main view (kept for now but unused after redirect) |

### Data Flow

The project record is linked to a pipeline entry via `projects.pipeline_entry_id`. When the Lead Details page detects `status === 'project'`, it queries:

1. `projects` table for the project record (project_number, dates, etc.)
2. `project_budget_items` for budget tracking
3. `project_costs` for cost records
4. `project_budget_snapshots` for budget baseline
5. `estimates` for contract value
6. `calculate_enhanced_rep_commission` RPC for commission data

All of this data powers the additional financial sections that appear only in the project phase.

