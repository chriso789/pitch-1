

# Sync Dashboard Pipeline Stats with Kanban Board

## Problem

The dashboard "Pipeline Status" section uses **hardcoded stages** (Lead, Legal, Contingency, Project, Completed, Closed) with hardcoded status keys. Meanwhile, the Kanban pipeline board uses **dynamic stages** from `usePipelineStages()` loaded from the `pipeline_stages` database table. This causes two mismatches:

1. **Missing stages**: The dashboard omits stages like "Estimate Sent" and "Ready for Approval" that exist in the pipeline
2. **Wrong counts**: The hardcoded counting logic (`counts.lead`, `counts.legal_review`, etc.) doesn't account for all pipeline stage keys, so entries in unrecognized stages are silently dropped

For example, the Kanban shows 10 Leads but the dashboard shows only 3, because the dashboard query counts `lead` but the actual status key might be different (e.g., `new_lead`).

## Solution

Replace the hardcoded pipeline stats in the dashboard with the same `usePipelineStages()` hook the Kanban board uses. This ensures both views always show identical stages with identical counts.

## Changes

**File: `src/features/dashboard/components/Dashboard.tsx`**

### 1. Import and use `usePipelineStages`

Add the hook import and call it alongside existing hooks to get the dynamic stage definitions.

### 2. Replace hardcoded count buckets with dynamic counting

Instead of:
```
const counts = { lead: 0, legal_review: 0, contingency_signed: 0, ... };
data?.forEach(entry => { if (status in counts) counts[status]++; });
```

Use:
```
const counts: Record<string, number> = {};
stages.forEach(s => counts[s.key] = 0);
data?.forEach(entry => { if (entry.status in counts) counts[entry.status]++; });
```

This dynamically builds count buckets from whatever stages are configured in the database.

### 3. Replace hardcoded `dashboardPipelineData` array

Instead of the 6-item hardcoded array, map over the dynamic stages:
```
const dashboardPipelineData = stages
  .filter(s => !s.is_terminal)  // Optionally exclude terminal statuses like Lost/Canceled
  .map(stage => ({
    status: stage.name,
    count: pipelineStatusCounts[stage.key] || 0,
    color: stage.color,
    key: stage.key
  }));
```

This ensures every stage the Kanban shows also appears on the dashboard with accurate counts.

### 4. Convert Tailwind class colors for dashboard blocks

The dynamic stages store colors as Tailwind classes like `bg-blue-500`. The dashboard currently uses custom classes like `bg-status-lead`. The rendering already uses the `color` prop directly in `className`, so the dynamic stage colors will work as-is.

## Technical Details

| File | Change |
|------|--------|
| `src/features/dashboard/components/Dashboard.tsx` | Import `usePipelineStages`; replace hardcoded counting with dynamic stage-based counting; replace hardcoded `dashboardPipelineData` with stages-driven mapping |

## Result

- Dashboard "Pipeline Status" will show the exact same stages as the Kanban board
- Counts will match 1:1 between both views
- Adding/removing/reordering stages in the Pipeline Stage Manager will automatically update both views
- No more "missing" entries due to unrecognized status keys
