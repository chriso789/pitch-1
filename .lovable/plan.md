

# Fix Pipeline Kanban Board to Show "Estimate Sent" Stage

## Problem

The Pipeline page (`Pipeline.tsx`) uses a **hardcoded** `jobStages` array (lines 76-84) that only includes 7 stages:
- Leads, Legal Review, Contingency Signed, Ready for Approval, Project, Completed, Closed

It is missing **Estimate Sent** (and any other stages configured in the database). Meanwhile, the Dashboard already uses the dynamic `usePipelineStages()` hook and correctly shows all stages including "Estimate Sent."

## Solution

Replace the hardcoded `jobStages` array in `Pipeline.tsx` with dynamic stages from the `usePipelineStages()` hook -- the same approach already used by `KanbanPipeline.tsx` and the Dashboard.

## Changes

**File: `src/features/pipeline/components/Pipeline.tsx`**

1. **Import `usePipelineStages`** at the top of the file.

2. **Replace the hardcoded `jobStages` array** (lines 76-84) with the dynamic `stages` from the hook:
   ```
   const { stages: dynamicStages } = usePipelineStages();

   // Map dynamic stages to the format Pipeline.tsx expects (with icons)
   const jobStages = dynamicStages.map(stage => ({
     name: stage.name,
     key: stage.key,
     color: stage.color,
     icon: DefaultStageIcon, // Use a generic icon
   }));
   ```

3. **No other changes needed** -- the rest of the component (`fetchPipelineData`, `handleDragEnd`, rendering) already iterates over `jobStages` dynamically, so swapping the source is sufficient.

## Technical Details

| File | Change |
|------|--------|
| `src/features/pipeline/components/Pipeline.tsx` | Import `usePipelineStages`; replace hardcoded `jobStages` with dynamic stages from hook |

## Result

- The Pipeline Kanban board will show **all** configured stages, including "Estimate Sent"
- Stage order, names, and colors will stay synchronized with the Dashboard and the Pipeline Stage Manager
- Adding or removing stages in the manager will automatically update the Pipeline board
