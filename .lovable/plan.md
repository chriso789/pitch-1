

# Two Changes: Filter Developer Accounts from Rep Dropdowns + Contact Internal Notes

## 1. Filter Developer/Master Accounts from Rep Selection

**Problem:** The rep assignment dropdown on Contact Profile shows both "Chris O'Brien" accounts — one is the `owner` role, the other is a `master`/developer account. Only operational staff should appear.

**Fix:** In `src/pages/ContactProfile.tsx` lines 94-109, add filters to exclude `role = 'master'` and `is_developer = true` from the profiles query. This matches the pattern already used in `InternalNotesSection.tsx` (line 122-123).

**Changes:**
- `src/pages/ContactProfile.tsx` — Update the team members query (line 96) to add `.select('id, first_name, last_name, role, is_developer')` and filter results to exclude `role === 'master'` or `is_developer === true` in the post-fetch filter (line 104-108).

Also audit the same pattern in `src/pages/LeadDetails.tsx` rep dropdowns to ensure consistency.

---

## 2. Contact-Level Internal Notes

**Problem:** Internal notes currently only exist on leads/pipeline entries. The user needs a separate notes area on the Contact Profile to track follow-up independently of any lead.

**Approach:** Add an optional `contact_id` column to the existing `internal_notes` table, then create a `ContactNotesSection` component (adapted from the existing `InternalNotesSection`) and add it as a new tab on the Contact Profile page.

**Database Migration:**
```sql
ALTER TABLE internal_notes 
  ADD COLUMN contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE;

-- Make pipeline_entry_id nullable (notes can belong to contact OR pipeline entry)
ALTER TABLE internal_notes 
  ALTER COLUMN pipeline_entry_id DROP NOT NULL;

-- Add check: at least one parent must be set
ALTER TABLE internal_notes 
  ADD CONSTRAINT internal_notes_parent_check 
  CHECK (pipeline_entry_id IS NOT NULL OR contact_id IS NOT NULL);

-- RLS policy for contact notes
CREATE POLICY "Users can manage contact notes in their tenant"
  ON internal_notes FOR ALL USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));
```

**New Component:** `src/components/contact-profile/ContactNotesSection.tsx`
- Adapted from `InternalNotesSection.tsx` but queries by `contact_id` instead of `pipeline_entry_id`
- Same features: add note, pin, delete, @mention, search

**UI Change:** `src/pages/ContactProfile.tsx`
- Add a "Notes" tab between "Communication" and "Documents"
- Render `ContactNotesSection` with `contactId` and `tenantId` props

**Files changed:**
- SQL migration (new) — add `contact_id` column, make `pipeline_entry_id` nullable, add check constraint
- `src/components/contact-profile/ContactNotesSection.tsx` (new) — contact-scoped notes component
- `src/pages/ContactProfile.tsx` — filter master/developer from rep dropdown + add Notes tab
- `src/integrations/supabase/types.ts` — update `internal_notes` type to include optional `contact_id`

