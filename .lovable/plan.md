

## Plan: Fix Pipeline "setResolvedTenantId" Runtime Error

### Root cause

The console shows `ReferenceError: setResolvedTenantId is not defined` inside `fetchPipelineData`. The previous edit removed the `setResolvedTenantId` state variable but a reference to it was left in the compiled build cache. The current source code is actually clean — no reference to `setResolvedTenantId` exists anywhere.

The fix is to trigger a clean rebuild by making a small no-op change to `Pipeline.tsx` (e.g., adding a whitespace line or updating a comment). This will force Vite to recompile the file and serve the corrected version.

### What I will do

1. **Touch `Pipeline.tsx`** — Add/update a comment at the top of the file to force a rebuild of the module and clear the stale cached version that still references the removed `setResolvedTenantId` variable.

### Files to modify

| File | Change |
|------|--------|
| `src/features/pipeline/components/Pipeline.tsx` | Add a timestamp comment to force rebuild |

This is a one-line change that will clear the stale cache and restore the pipeline for Tristate.

