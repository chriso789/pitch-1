

## Show Assigned Rep on Contacts Kanban Board Cards

The contact data already includes the joined `assigned_rep` (first_name, last_name) from the fetch query. We just need to pass it through and display it.

### Changes

**1. Update Contact interface in `ContactKanbanBoard.tsx` (lines 21-34)**
- Add `assigned_to: string | null` and `assigned_rep: { first_name: string; last_name: string } | null` to the `Contact` interface

**2. Update Contact interface in `ContactKanbanCard.tsx` (lines 10-23)**
- Same interface update to include `assigned_rep`

**3. Display rep name on `ContactKanbanCard.tsx`**
- Below the contact name, show the assigned rep in small muted text (e.g. "Rep: John Smith")
- Only display when `assigned_rep` is present
- Use the `UserCheck` icon for visual consistency with the contact profile page

### Files to Modify

| File | Change |
|------|--------|
| `src/features/contacts/components/ContactKanbanBoard.tsx` | Add `assigned_to` and `assigned_rep` to Contact interface |
| `src/features/contacts/components/ContactKanbanCard.tsx` | Add fields to interface + display rep name on card |

