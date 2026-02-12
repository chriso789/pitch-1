

## Fix: Contacts Board Not Filtering Properly

### Root Cause

The board columns are defined by your custom `contact_statuses` table, but the actual `qualification_status` values stored on your 1,781 contacts don't match those column keys:

| Status in Database | Count | Board Column Match? |
|---|---|---|
| unqualified | 1,055 | No column exists |
| NULL (no status) | 424 | No column exists |
| storm_damage | 234 | No -- board key has trailing underscore: storm_damage_ |
| not_home | 18 | No column exists |
| legal_review | 12 | No column exists |
| not_interested | 10 | Yes |
| contingency_signed | 8 | No column exists |
| project | 8 | Yes |

So ~1,743 contacts silently fall into a hidden "Uncategorized" bucket at the far right of the board.

### Fix (Two Parts)

**Part 1: Fix the storm_damage key mismatch (database)**

Run a SQL migration to update the `contact_statuses` key from `storm_damage_` to `storm_damage` (removing the trailing underscore), so the 234 contacts with that value properly appear in the Storm Damage column.

**Part 2: Add visible "New / Unassigned" column + show Uncategorized**

Update `ContactKanbanBoard.tsx` to always render the Uncategorized column prominently (not hidden at the end), renamed to "New / Unassigned" so it's clear these contacts haven't been dispositioned yet. This makes the 1,479 contacts with `unqualified` or `NULL` status visible and actionable.

Additionally, add a "Not Home" status column to the board since 18 contacts have that value and it was in the original default statuses.

### Technical Details

**File: ContactKanbanBoard.tsx**
- Move the "uncategorized" column to the FIRST position (before other columns) so new/unassigned contacts are immediately visible
- Rename it from "Uncategorized" to "New / Unassigned"
- Show the count prominently so users know how many contacts need disposition

**Database: contact_statuses table**
- Update the `storm_damage_` key to `storm_damage` to match existing data
- Optionally add a "Not Home" status and an "Unqualified" status so those contacts have proper columns

**Database: contacts table**
- Update contacts with `qualification_status = 'unqualified'` to `NULL` (since "unqualified" is not a meaningful disposition -- these are just new contacts that haven't been categorized)
- OR add an "Unqualified" column to the board -- whichever you prefer

### Result

All 1,781 contacts will be visible and properly distributed across the board columns instead of being hidden in an invisible bucket.

