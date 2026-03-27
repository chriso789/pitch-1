

## Plan: Fix AR Totals and Pipeline Stage Totals

### Two root causes identified

**1. Accounts Receivable shows $0 for Tristate**
The AR page uses `useActiveTenantId` (line 47) which reads from `profile.active_tenant_id`. Meanwhile, `usePipelineStages` internally uses `useEffectiveTenantId` which checks the company switcher first. When these return different tenant IDs, the stages load correctly but the pipeline_entries query filters by the wrong tenant, returning zero results.

**Fix:** Replace `useActiveTenantId` with `useEffectiveTenantId` in `AccountsReceivable.tsx` (same fix applied to Estimates page earlier).

**2. Pipeline board shows $0 for all stage totals (both tenants)**
Line 333 of `Pipeline.tsx` reads `entry.selling_price` — but `pipeline_entries` has no `selling_price` column. That value lives on `enhanced_estimates`, linked via `metadata.selected_estimate_id`. So `parseFloat(entry.selling_price)` always returns `NaN`, which falls back to `0`.

**Fix:** After fetching pipeline entries, batch-fetch estimate selling prices for entries that have a `selected_estimate_id` in their metadata, then merge those values into the stage total calculation.

### Changes

**File: `src/pages/AccountsReceivable.tsx`**
- Line 5: Replace `import { useActiveTenantId }` with `import { useEffectiveTenantId }`
- Line 47: Replace `const { activeTenantId } = useActiveTenantId()` with `const activeTenantId = useEffectiveTenantId()`

**File: `src/features/pipeline/components/Pipeline.tsx`**
- After the pipeline query returns data (around line 279), extract all `selected_estimate_id` values from entry metadata
- Batch-fetch `id, selling_price` from `enhanced_estimates` for those IDs
- Build a map of `pipeline_entry_id → selling_price`
- Update stage total calculation (line 332-334) to look up selling price from the estimate map instead of `entry.selling_price`
- Update the per-card rendering to include the looked-up selling price so individual cards can also display values

### Technical detail

```typescript
// Pipeline.tsx — after pipeline data loads
const estimateIds = (filteredData || [])
  .map(e => e.metadata?.selected_estimate_id)
  .filter(Boolean);

let estimatePriceMap = new Map();
if (estimateIds.length > 0) {
  const { data: estimates } = await supabase
    .from('enhanced_estimates')
    .select('id, pipeline_entry_id, selling_price')
    .in('id', estimateIds);
  (estimates || []).forEach(est => {
    estimatePriceMap.set(est.pipeline_entry_id, Number(est.selling_price) || 0);
  });
}

// Then in stage total calc:
const stageTotal = stageEntries.reduce((sum, entry) => {
  return sum + (estimatePriceMap.get(entry.id) || 0);
}, 0);
```

