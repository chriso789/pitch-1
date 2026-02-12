

## Add "Assign Rep" Dropdown to Contact Profile Page

The `contacts` table already has an `assigned_to` column (UUID, FK to `profiles`), so no database changes are needed.

### Changes

**File: `src/pages/ContactProfile.tsx`**

Add an "Assigned Rep" dropdown in the contact header area (next to the Edit/Create Lead buttons). It will:

1. Fetch the list of team members from the `profiles` table (filtered by the current user's `tenant_id`)
2. Display a `Select` dropdown showing the currently assigned rep (or "Unassigned")
3. On selection change, update the `contacts.assigned_to` column in Supabase and refresh the local state
4. Show a toast on success/failure

**Implementation details:**
- Use the existing `Select` / `SelectTrigger` / `SelectContent` / `SelectItem` components from `@/components/ui/select`
- Place the dropdown between the status badges row and the action buttons, or inline with the action buttons for a clean layout
- Fetch profiles with `supabase.from('profiles').select('id, first_name, last_name, role')` filtered by tenant
- Include an "Unassigned" option that sets `assigned_to` to `null`
- Show the rep's name in the trigger when assigned, "Assign Rep" when not
- Style it with the `User` icon to match the page design

### Visual placement

The dropdown will appear in the action buttons row alongside "Call", "Skip Trace", "Edit", and "Create Lead" -- keeping all actions together in one row.

### No database migration needed

The `contacts.assigned_to` column and its FK to `profiles` already exist.
