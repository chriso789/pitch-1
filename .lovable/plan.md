

# Plan: Pipeline Search Fix + Sort Order Toggle

## Issue 1: New Lead Not Showing in Search

The pipeline search (`PipelineSearch.tsx`) queries Supabase directly with `.or()` filtering across `lead_name`, `clj_formatted_number`, `contacts.first_name`, `contacts.last_name`, and `contacts.address_city`. If a newly created lead isn't appearing, the most likely causes are:

- **RLS policy** not granting visibility for the current user's tenant
- **The `is_deleted` flag** or missing contact join
- **Stale real-time subscription** not triggering a refresh

I'll investigate the RLS policies on `pipeline_entries` and verify the search query logic works for cross-location searches within the same tenant.

## Issue 2: Sort Order Toggle (Ascending/Descending) per Column

**Current behavior**: All leads in every column are sorted by `created_at DESC` (newest first) — hardcoded on line 270 of `Pipeline.tsx`.

**Change**: Add a sort order toggle to the filters section.

### `src/features/pipeline/components/Pipeline.tsx`

1. **Add `sortOrder` to filter state** (`'desc' | 'asc'`, default `'desc'`)
2. **Add a toggle button** in the filters card (next to date filters) — a simple button showing "Newest First" / "Oldest First" with an arrow icon
3. **Use `sortOrder` in the Supabase query** on line 270: `.order('created_at', { ascending: sortOrder === 'asc' })`
4. **Include `sortOrder` in the `useEffect` dependency** so data refetches on toggle
5. **Add to Clear Filters** reset logic

### UI placement
In the filters grid (line 1055), add a 4th column for "Sort Order" with a Select dropdown: "Newest First" / "Oldest First".

---

**Two changes total**: One diagnostic check + fix for the search issue, one UI + query change for sort order.

