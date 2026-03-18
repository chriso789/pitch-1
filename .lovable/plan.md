

# Project Photo Stages + Auto-Populate Budget from Estimate

## Two Changes

### 1. Replace Approval Card with Project Photo Upload Steps
When `lead.status` is `project` or `completed`, show a new **"Project Photo Documentation"** card in the same location where the Approval Requirements card was. It displays three step-like upload buttons:

- **Before Photos** (blue) — pre-work documentation
- **In Progress Photos** (orange) — during construction
- **Final Photos** (green) — completed work

Each button opens the existing photo upload flow (using `usePhotos` hook) with the category pre-set (`before`, `during`, `after`). Show a count badge of photos already uploaded per category. Uses a stepper-like visual with circles/connectors showing progress through the build process.

**File**: New component `src/components/lead-details/ProjectPhotoSteps.tsx`
**File**: `src/pages/LeadDetails.tsx` — add the new card in an `else` branch where the approval card is hidden (lines 1061-1080), rendering `ProjectPhotoSteps` when status is `project` or `completed`.

### 2. Auto-Populate Budget from Selected Estimate on Project Approval
When `handleApproveToProject` runs successfully (line 540-573), after updating the status to `project`, seed the `project_budget_items` table with line items from the selected estimate.

**Logic in `handleApproveToProject`**:
1. Read `selected_estimate_id` from `pipeline_entries.metadata`
2. Fetch the `enhanced_estimates` record (material_cost, labor_cost, overhead_amount, line_items JSONB)
3. Parse `line_items` array and insert each as a `project_budget_items` row with `category` mapped from the line item type (Material/Labor), `item_name`, `budgeted_quantity`, `budgeted_unit_cost`, and computed `budgeted_total_cost`
4. If no line_items exist, create summary-level budget items for Materials and Labor totals

**File**: `src/pages/LeadDetails.tsx` — extend `handleApproveToProject` function.

### Summary of Changes
1. **`src/components/lead-details/ProjectPhotoSteps.tsx`** — New component with 3-step photo upload buttons (Before / In Progress / Final) using existing `usePhotos` hook
2. **`src/pages/LeadDetails.tsx`** — Show `ProjectPhotoSteps` when status is `project`/`completed`; seed budget items from estimate on approval

