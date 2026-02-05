
# Fix Pipeline Search & Nicole Walker Visibility

## Issues Identified

### Issue 1: Pipeline Search Not Filtering Leads
**Root Cause:** The `filterBySearch` function in `Pipeline.tsx` searches by `job.job_number` but pipeline entries use `clj_formatted_number` field.

**Current Code (Line 167):**
```typescript
const jobNumber = (job.job_number || '').toLowerCase();
```

**Fix:** Search by `clj_formatted_number` instead of `job_number`

---

### Issue 2: Nicole Walker (3344-1-0) Not Showing in Pipeline
**Root Cause:** There are TWO "East Coast" locations in the database:

| ID | Name | Length |
|----|------|--------|
| `acb2ee85-...` | "East Coast" | 10 chars |
| `a3615f0d-...` | "East Coast " | 11 chars (trailing space!) |

Nicole Walker is assigned to the duplicate location with the trailing space. When the user selects "East Coast" from the dropdown, they get the first one, but Nicole is in the second one.

**Fix:** Clean up the duplicate location data (move records and delete the duplicate)

---

## Technical Changes

### File 1: `src/features/pipeline/components/Pipeline.tsx`

**Fix the search filter function (lines 159-174):**

```typescript
const filterBySearch = (data: any[]) => {
  if (!searchQuery) return data;
  
  const query = searchQuery.toLowerCase();
  return data.filter(job => {
    const contact = job.contacts;
    const fullName = `${contact?.first_name || ''} ${contact?.last_name || ''}`.toLowerCase();
    // FIX: Use clj_formatted_number instead of job_number
    const cljNumber = (job.clj_formatted_number || '').toLowerCase();
    const address = `${contact?.address_street || ''} ${contact?.address_city || ''}`.toLowerCase();
    
    return fullName.includes(query) || 
           cljNumber.includes(query) || 
           address.includes(query);
  });
};
```

### Database Cleanup: Merge Duplicate "East Coast" Locations

**Step 1: Move records from duplicate location to canonical one:**
```sql
-- Update pipeline_entries from duplicate to canonical "East Coast"
UPDATE pipeline_entries 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Update contacts from duplicate to canonical
UPDATE contacts 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Update any other tables that reference this location
UPDATE projects 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';
```

**Step 2: Delete the duplicate location:**
```sql
DELETE FROM locations 
WHERE id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';
```

---

## Summary of Changes

| Change Type | Target | Description |
|-------------|--------|-------------|
| Code Fix | `Pipeline.tsx` | Fix search to use `clj_formatted_number` |
| Data Fix | Database | Merge duplicate "East Coast" locations |

---

## Why Search Wasn't Working

The search input looks for:
- Contact name ✅
- `job_number` field ❌ (doesn't exist on pipeline entries)
- Address ✅

Pipeline entries have `clj_formatted_number` (like "3344-1-0"), not `job_number`. So searching "paola" wouldn't match anything.

---

## Why Nicole Walker Is Missing

```text
User selects: "East Coast" (id: acb2ee85-d4f7-4a4e-9b97-cd421554b8af)
Nicole is in: "East Coast " (id: a3615f0d-c7b7-4ee9-a568-a71508a539c6)
                        ^^ trailing space - DIFFERENT location!
```

The dropdown shows "East Coast" but it's filtering by the wrong UUID, so Nicole doesn't appear.

---

## Testing After Fix

1. Open Pipeline page
2. Type "nicole" in search - should filter to show Nicole Walker
3. Type "3344" in search - should show lead 3344-1-0
4. After database cleanup, Nicole Walker should appear in the leads column
5. Search by name, CLJ number, and address should all work
