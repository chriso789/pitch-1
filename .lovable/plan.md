

# Fix: "Total Jobs" Showing Wrong Count

## Root Cause

In `ContactDetailsTab.tsx` line 89-93, the `projects` query fetches **ALL projects across the entire tenant** — it has no filter for the current contact:

```typescript
supabase
  .from('projects')
  .select('id, pipeline_entry_id')
  .not('pipeline_entry_id', 'is', null)  // ← no contact filter!
```

Then line 97 adds `pipelineCount + jobsCount`, double-counting pipeline entries AND adding every project in the system.

## Fix

Replace the `fetchJobCount` function to only count pipeline entries for this contact (which already includes converted projects). The `pipeline_entries` query already correctly filters by `contact_id` — we just need to stop adding the unfiltered projects count.

**Option A (simplest):** Just use the pipeline entries count, since every project originates from a pipeline entry:
```typescript
const { count } = await supabase
  .from('pipeline_entries')
  .select('id', { count: 'exact', head: true })
  .eq('contact_id', contact.id)
  .eq('is_deleted', false);
setJobCount(count || 0);
```

Also adds `is_deleted = false` filter so soft-deleted entries aren't counted.

**File:** `src/components/contact-profile/ContactDetailsTab.tsx` — lines 82-100

