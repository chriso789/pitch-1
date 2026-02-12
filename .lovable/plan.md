

## Fix: Remove Pipeline Stages from Contacts Board

### Problem

The `contact_statuses` table (which drives the Contacts Board) now contains pipeline stage entries that don't belong there:
- **Legal Review** -- this is a pipeline stage, not a contact disposition
- **Project** -- this is a pipeline stage
- **Contingency Signed** -- this is a pipeline stage

These were added by the previous migration. Additionally, 28 contacts have pipeline stage values stored in their `qualification_status` field (e.g., `legal_review`, `contingency_signed`, `project`, `ready_for_approval`, `completed`, `lead`, `new_lead`).

The **Contacts Board** should only show contact disposition statuses (Not Home, Interested, Not Interested, Qualified, Storm Damage, Do Not Contact, etc.), while pipeline stages belong exclusively on the **Jobs Pipeline** board.

### Fix

**Database migration:**

1. **Remove pipeline stages from `contact_statuses` table** -- delete the rows for `legal_review`, `contingency_signed`, and `project` from the contact_statuses table for this tenant.

2. **Reset contacts that have pipeline stage values** -- update the 28 contacts that have pipeline-stage values in their `qualification_status` field back to `NULL` so they appear in "New / Unassigned":
   - `legal_review` (12 contacts)
   - `contingency_signed` (8 contacts)  
   - `project` (8 contacts)
   - `ready_for_approval` (5 contacts)
   - `completed` (3 contacts)
   - `lead` (3 contacts)
   - `new_lead` (1 contact)

No code changes needed -- the board component already handles these correctly once the data is fixed.

### After Fix

The Contacts Board will show only disposition columns:
- New / Unassigned (1,507 contacts)
- Qualified
- Not Home (18)
- Interested
- Old Roof - Marketing
- Storm Damage (234)
- Not Interested (10)
- Do Not Contact

Pipeline stages (Legal Review, Contingency Signed, Project, etc.) will only appear on the Jobs Pipeline board where they belong.
