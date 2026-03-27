

## Plan: Make AR Dashboard Dynamic Based on Tenant Pipeline Stages

### Problem
The AR page hardcodes `AR_INCLUDED_STATUSES` with values like `project`, `completed`, `closed`, etc. Tristate's pipeline uses `contracted` (stage_order 7) as the "project approved" equivalent, and `project` means "In Production." Since `contracted` is not in the hardcoded list, Tristate's contracted jobs are excluded from AR totals.

### Solution
Replace the hardcoded status list with a dynamic lookup using the tenant's `pipeline_stages` table. Include all stages at or after the "contracted/project" threshold (stage_order >= the first post-approval stage) and exclude terminal stages like `lost`.

### Changes

**File: `src/pages/AccountsReceivable.tsx`**

1. Import `usePipelineStages` hook
2. Remove the hardcoded `AR_INCLUDED_STATUSES` constant
3. Compute AR-eligible statuses dynamically from the tenant's stages:
   - Fetch stages via `usePipelineStages()`
   - Define a threshold: include all stages with `stage_order >= 7` (where contracted/project typically starts) OR whose key matches known post-approval keys (`project`, `contracted`, `completed`, `closed`, `capped_out`, `in_production`, `production`, `install_scheduled`, `inspection_scheduled`)
   - Exclude terminal stages (`is_terminal === true`, e.g., `lost`)
4. Use the computed status keys in the `.in('status', ...)` query filter
5. Update the query key to include the derived statuses so it refetches when stages load

### Technical detail

```typescript
import { usePipelineStages } from '@/hooks/usePipelineStages';

// Inside component:
const { stages } = usePipelineStages();

// Determine AR-eligible statuses dynamically
// Include stages at or past "contracted/project" threshold (stage_order >= 7)
// and exclude terminal stages like "lost"
const arStatuses = useMemo(() => {
  // Find the first "post-approval" stage order
  const contractedStage = stages.find(s => 
    ['contracted', 'project'].includes(s.key) && !s.is_terminal
  );
  const threshold = contractedStage?.stage_order ?? 7;
  
  return stages
    .filter(s => s.stage_order >= threshold && s.is_active && !s.is_terminal)
    .map(s => s.key);
}, [stages]);
```

This makes the AR page work for any tenant's custom pipeline configuration without manual status mapping.

