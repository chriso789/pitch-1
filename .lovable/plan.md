

## Fix: Deleted Pipeline Entry Still Showing on Contact Profile

### Root Cause

The pipeline entry for this contact (ID: `be2da4f5-...`) has `is_deleted: true` in the database. The Pipeline Kanban board correctly filters these out with `.eq('is_deleted', false)`, but the **Contact Profile page** does not apply this filter. That's why:

- The contact profile shows "Contingency Signed" with a pipeline card
- The Pipeline board does not show this entry

This is not a sync issue -- the entry was soft-deleted but the contact profile page never checks the `is_deleted` flag.

### Fix

**File: `src/pages/ContactProfile.tsx` (line ~93)**

Add `.eq('is_deleted', false)` to the pipeline entries query so deleted entries are excluded from the contact profile, matching the pipeline board behavior:

```typescript
const { data: pipelineData } = await supabase
  .from('pipeline_entries')
  .select('*')
  .eq('contact_id', id)
  .eq('is_deleted', false)  // ADD THIS LINE
  .order('created_at', { ascending: false });
```

This single-line change ensures the contact profile page and the pipeline kanban board show consistent data. If an entry is soft-deleted, it won't appear in either place.

