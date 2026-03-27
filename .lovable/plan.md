

## Plan: Fix AR Estimate Totals — Query by pipeline_entry_id Instead of Metadata

### Root Cause
The AR page (lines 117-124) extracts estimate IDs from `metadata.selected_estimate_id` or `metadata.enhanced_estimate_id`. Most pipeline entries — especially Tristate's "In Production," "Complete," and "Capped Out" jobs — **don't have these metadata keys set**. So `estimateIds` comes back empty, no estimates are fetched, and everything shows $0.

### Fix
Instead of relying on metadata to find estimates, query `enhanced_estimates` directly using the pipeline entry IDs. For entries with multiple estimates, pick the one with the highest `selling_price` (the "active" build estimate) or the one matching `metadata.selected_estimate_id` if present.

### Changes

**File: `src/pages/AccountsReceivable.tsx`**

1. **Remove metadata-based estimate ID extraction** (lines 117-124) — delete the `estimateIds` useMemo that reads from metadata

2. **Replace estimate query** (lines 126-138) — query `enhanced_estimates` by `pipeline_entry_id` using the project IDs directly:
```typescript
const projectIds = useMemo(() => (projects || []).map(p => p.id), [projects]);

const { data: estimates } = useQuery({
  queryKey: ['ar-estimates', activeTenantId, projectIds],
  queryFn: async () => {
    if (projectIds.length === 0) return [];
    const { data, error } = await supabase
      .from('enhanced_estimates')
      .select('id, pipeline_entry_id, selling_price, material_cost, labor_cost')
      .in('pipeline_entry_id', projectIds);
    if (error) throw error;
    return (data || []) as any[];
  },
  enabled: !!activeTenantId && projectIds.length > 0,
});
```

3. **Update estimate map building** (lines 146-153) — when multiple estimates exist per entry, prefer the one matching `metadata.selected_estimate_id`, otherwise use the highest selling price:
```typescript
const estimateMap = new Map();
const grouped = new Map();
(estimates || []).forEach(e => {
  const list = grouped.get(e.pipeline_entry_id) || [];
  list.push(e);
  grouped.set(e.pipeline_entry_id, list);
});
grouped.forEach((list, entryId) => {
  const project = projects.find(p => p.id === entryId);
  const selectedId = project?.metadata?.selected_estimate_id 
    ?? project?.metadata?.enhanced_estimate_id;
  const picked = list.find(e => e.id === selectedId) 
    || list.sort((a, b) => Number(b.selling_price) - Number(a.selling_price))[0];
  if (picked) {
    estimateMap.set(entryId, {
      selling_price: Number(picked.selling_price) || 0,
      material_cost: Number(picked.material_cost) || 0,
      labor_cost: Number(picked.labor_cost) || 0,
    });
  }
});
```

### Also apply same fix to Pipeline.tsx
**File: `src/features/pipeline/components/Pipeline.tsx`** (~line 322-340)

Same problem: metadata-based lookup misses entries. Change to query by `pipeline_entry_id` using all filtered entry IDs, then pick the selected or highest-priced estimate per entry.

### Summary
Two files, same pattern: stop depending on metadata keys that aren't reliably set. Query estimates by `pipeline_entry_id` directly, then pick the correct one per entry.

