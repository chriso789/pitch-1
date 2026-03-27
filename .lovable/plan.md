

## Plan: Force Pipeline Rebuild (Cache Bust)

### Problem
The pipeline was working previously but now shows empty again. The source code is correct — it uses `effectiveTenantId`, queries `pipeline_entries` properly, and handles orphaned statuses. The UI renders filters and layout correctly but shows "No pipeline entries found," which indicates a stale cached build artifact (same pattern as the earlier `setResolvedTenantId` issue).

### Fix
Update the cache-bust comment at the top of `Pipeline.tsx` (line 1) with a new timestamp to force Vite to rebuild the module and clear any stale compiled version.

### File
| File | Change |
|------|--------|
| `src/features/pipeline/components/Pipeline.tsx` | Update line 1 comment timestamp to force rebuild |

Single-line change — no logic modifications needed.

