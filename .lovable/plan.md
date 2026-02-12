

## Fix: Budget and Cost Verification Tabs Not Appearing

### Problem
The Budget and Cost Verification tabs inside the Profit Center panel are not showing because the code checks `lead?.status === 'project'` before passing the `projectId` prop. However, leads that have been converted to projects can have other statuses like `completed`, `legal_review`, `ready_for_approval`, etc. Your current lead has status `completed`, so the check fails and `projectId` is never passed.

### Fix

**File: `src/pages/LeadDetails.tsx` (line 645)**

Change the condition from checking for a specific status string to simply checking if `projectData` exists (which already confirms a project record is linked):

```typescript
// Before (broken):
projectId={lead?.status === 'project' && projectData ? projectData.project.id : undefined}

// After (fixed):
projectId={projectData?.project?.id}
```

This is a one-line fix. If `projectData` exists, the project tabs show. If not, they don't. No need to check the status string at all.

### Result
The Budget and Cost Verification tabs will appear for any lead that has been converted to a project, regardless of the pipeline status.

### Technical Details

| File | Line | Change |
|------|------|--------|
| `src/pages/LeadDetails.tsx` | 645 | Replace `lead?.status === 'project' && projectData ? projectData.project.id : undefined` with `projectData?.project?.id` |

