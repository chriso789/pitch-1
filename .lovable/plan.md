

# Fix: Pipeline Search Not Finding Leads + Lead Name vs Contact Name

## Two Issues Found

### Issue 1: Pipeline Search Doesn't Show Dropdown
The pipeline search bar only searches entries loaded for the **currently selected location**. The VCA Palm Beach lead (3412-1-0) is assigned to location `acb2ee85...`. If you're viewing a different location, it won't appear in the pipeline data, so the search dropdown has nothing to match against.

**Fix:** The pipeline search dropdown should search **all leads across all locations** (for users with permission), not just the currently filtered view. When a result is clicked, navigate to the lead detail page regardless of which location it belongs to.

This means PipelineSearch needs its own independent query to supabase instead of relying on the pre-filtered `pipelineData` prop.

### Issue 2: Lead Name vs Contact Name Architecture
Currently, there's no separate "lead name" field on `pipeline_entries`. When you rename a lead (e.g., to "VCA Palm Beach"), it changes the **contact** record's `first_name`/`last_name` directly. This is wrong because:
- A property manager (contact) can have multiple properties (leads)
- Renaming a lead shouldn't change the contact's name
- Each lead should have its own display name independent of the contact

**Fix:** Add a `lead_name` column to `pipeline_entries`. When set, the pipeline cards display the lead name; when null, they fall back to the contact's name. The search should check both.

## Technical Plan

### Step 1: Add `lead_name` column to `pipeline_entries`
```sql
ALTER TABLE pipeline_entries ADD COLUMN lead_name TEXT;
```

### Step 2: Update PipelineSearch to query independently
Instead of filtering the `pipelineData` prop, do a direct Supabase query searching across:
- `pipeline_entries.lead_name`
- `contacts.first_name` + `contacts.last_name`
- `pipeline_entries.clj_formatted_number`
- `contacts.address_street`, `address_city`

This ensures leads from ALL locations are searchable. The location filter only affects the Kanban board view, not search.

### Step 3: Update KanbanCard to display `lead_name` when available
Show `entry.lead_name` if set, otherwise fall back to `contacts.first_name + last_name`.

### Step 4: Update Lead Details page to allow editing lead name separately
The lead name edit should write to `pipeline_entries.lead_name`, NOT to `contacts.first_name`/`last_name`.

### Files Changed
- **Migration**: Add `lead_name` column to `pipeline_entries`
- **`src/features/pipeline/components/PipelineSearch.tsx`**: Replace prop-based filtering with direct Supabase search query
- **`src/features/pipeline/components/KanbanCard.tsx`**: Display `lead_name` with contact name fallback
- **`src/features/pipeline/components/Pipeline.tsx`**: Include `lead_name` in the pipeline query select; pass it through to cards
- **Lead detail page**: Update name editing to write to `lead_name` instead of contact name (needs investigation on which file handles this)

