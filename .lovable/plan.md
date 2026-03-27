

## Plan: Fix Accounts Receivable to Show All Project-Stage Entries

### Root cause

Two bugs in `src/pages/AccountsReceivable.tsx`:

1. **Line 53**: `.eq('status', 'project')` — only fetches entries with status exactly `'project'`, missing `'completed'` and any other post-project statuses. According to the pipeline architecture, entries can be in stages like `project`, `completed`, `inspection_scheduled`, etc.

2. **Line 98**: `.eq('status', 'approved')` on `enhanced_estimates` — the estimate data is read from `selected_estimate_id` in the pipeline entry's metadata (as the `api_estimate_hyperlink_bar` function does), not by filtering on an estimate `status` field. This filter likely excludes all estimates, resulting in $0.00 across the board.

### Fix

**File: `src/pages/AccountsReceivable.tsx`**

1. **Broaden pipeline entry query** (line 53): Replace `.eq('status', 'project')` with `.eq('is_deleted', false)` and remove the status filter entirely, or use `.in('status', ['project', 'completed'])`. Better approach: fetch all non-deleted entries and use the `selected_estimate_id` from metadata to pull financials — this matches how the rest of the app works.

2. **Fix estimate lookup** (lines 91-103): Instead of querying `enhanced_estimates` filtered by `status = 'approved'`, query using the `selected_estimate_id` stored in each pipeline entry's `metadata` field. This mirrors the `api_estimate_hyperlink_bar` RPC logic:
   - Add `metadata` to the pipeline_entries select
   - Extract `metadata.selected_estimate_id` for each entry
   - Batch-fetch those estimate IDs from `enhanced_estimates` (no status filter)
   - Map selling_price, material_cost, labor_cost by pipeline_entry_id

3. **Include completed projects in the list**: Show entries with status `project` or `completed` (and any other post-approval statuses) so that all active/finished jobs appear in AR totals.

### Technical detail

```typescript
// Pipeline entries query — include project + completed
.in('status', ['project', 'completed'])

// Extract selected_estimate_ids from metadata
const estimateIds = projects
  .map(p => p.metadata?.selected_estimate_id)
  .filter(Boolean);

// Fetch estimates by ID (no status filter)
const { data } = await supabase
  .from('enhanced_estimates')
  .select('id, pipeline_entry_id, selling_price, material_cost, labor_cost')
  .in('id', estimateIds);
```

### Files to modify

| File | Change |
|------|--------|
| `src/pages/AccountsReceivable.tsx` | Broaden status filter to include `project` + `completed`; fix estimate lookup to use `selected_estimate_id` from metadata instead of `status = 'approved'` |

