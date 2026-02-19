

# Fix Kanban Column Name and Location-Filter the Rep Dropdown

## Two Issues

### Issue 1: Kanban Board Column Named "New / Unassigned" is Misleading
Contacts with assigned reps (e.g., Duke Herzel assigned to Chris O'Brien) appear in "New / Unassigned" because their `qualification_status` is `unqualified`. The column name implies no rep is assigned, but it actually reflects the qualification/disposition status. 

**Fix:** Rename the column from "New / Unassigned" to "New / Unqualified" so users understand it refers to the contact's disposition, not their rep assignment.

File: `src/features/contacts/components/ContactKanbanBoard.tsx` -- change the title prop on the uncategorized column from `"New / Unassigned"` to `"New / Unqualified"`.

### Issue 2: Contact Profile Rep Dropdown Shows All Company Users (No Location or Active Filter)
The rep assignment dropdown on the Contact Profile page (`ContactProfile.tsx` lines 76-88) fetches ALL profiles for the tenant with no filtering. This means:
- **Inactive users** appear (e.g., Natalie Janacek has `is_active = false`)
- **East Coast-only reps** appear when viewing a West Coast contact (e.g., Colt Steingraber, Michael Grosso, Uri Kaweblum are only assigned to East Coast)

**Fix:** Update the team members fetch in `ContactProfile.tsx` to:
1. Filter by `is_active = true` to exclude removed/deactivated users
2. Filter by the contact's `location_id` using `user_location_assignments` -- only show reps assigned to the same location as the contact being viewed
3. Always include elevated roles (owner, corporate, office_admin) who bypass location filters, consistent with the existing pattern in `LeadCreationDialog` and `useLeadDetails`

## Technical Details

### File: `src/features/contacts/components/ContactKanbanBoard.tsx`
- Line 155: Change `title="New / Unassigned"` to `title="New / Unqualified"`

### File: `src/pages/ContactProfile.tsx`
- Lines 76-88: Replace the simple `profiles` query with a two-step fetch:
  1. Query `user_location_assignments` for the contact's `location_id` to get location-assigned user IDs
  2. Query `profiles` filtered to those user IDs plus elevated roles (owner, corporate, office_admin), with `is_active = true`
- The fetch will depend on `contact.location_id`, so it runs after the contact data loads
- Elevated roles are always included regardless of location assignment, matching the existing pattern used in `LeadCreationDialog.tsx` (lines 215-233) and `useLeadDetails.ts` (lines 280-284)

