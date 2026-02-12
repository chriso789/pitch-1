

## Fix: Contacts Page Slow Loading (N+1 Query Problem)

### Root Cause

The `fetchData` function in `EnhancedClientList.tsx` has two N+1 query patterns that fire hundreds of individual database queries:

1. **Jobs contact lookup (lines 473-495)**: For every job, a separate query fetches the contact details. With 50 jobs, that's 50 queries.

2. **Pipeline entry communication lookup (lines 530-539)**: For every pipeline entry, a separate query checks the last communication date. With 200+ pipeline entries, that's 200+ queries. The network logs clearly show this -- 20+ simultaneous `communication_history` requests.

Together these can generate 250+ individual database queries on page load.

### Fix

**File: `src/features/contacts/components/EnhancedClientList.tsx`**

#### Change 1: Batch job contact lookup

Replace the `Promise.all` loop that fetches each job's contact individually with a single bulk query:

```text
Before (N queries):
  For each job -> fetch contact by job.contact_id

After (1 query):
  Collect all unique contact_ids from jobs
  -> Single query: SELECT ... FROM contacts WHERE id IN (all_ids)
  -> Map results back to jobs in memory
```

#### Change 2: Batch pipeline communication lookup

Replace the `Promise.all` loop that fetches each pipeline entry's last communication individually with a single bulk query using a Supabase RPC or a grouped query:

```text
Before (N queries):
  For each pipeline entry -> fetch last communication by contact_id

After (1 query):
  Collect all unique contact_ids from pipeline entries
  -> Single query with DISTINCT ON or aggregate
  -> Map results back to pipeline entries in memory
```

#### Change 3: Remove redundant profile fetch

The `fetchData` function fetches the user profile again (line 382-386) even though `loadUserPreferences` already fetched it. We can skip the redundant fetch if `userProfile` is already set.

### Technical Details

**Batch contact lookup for jobs:**
- Extract unique `contact_id` values from all jobs
- Single query: `supabase.from('contacts').select('id, first_name, last_name, email, phone, address_street, address_city, address_state, location_id').in('id', contactIds).eq('tenant_id', effectiveTenantId)`
- Build a Map of `contact_id -> contact` for O(1) lookup
- Map over jobs to attach contact data

**Batch communication lookup for pipeline entries:**
- Extract unique `contact_id` values from all pipeline entries
- Single query: `supabase.from('communication_history').select('contact_id, created_at').in('contact_id', contactIds).order('created_at', { ascending: false })`
- Group by `contact_id` and take the latest per contact in JS
- Map over pipeline entries to attach communication data

### Result

The page will go from 250+ queries down to approximately 5-6 total queries, reducing load time from 10+ seconds to under 2 seconds.

