

# Auto-Assign Default Qualification Status to Contacts

## Problem

467 contacts show in the "Contacts by Status" board, but nearly all (466) are piled into the "New / Unassigned" column with 0 in every other column. This is because the `qualification_status` field on those contacts is NULL -- they were imported or created without ever being given a disposition.

The board is technically working correctly; it groups by `qualification_status`. NULL values go to "uncategorized" (shown as "New / Unassigned"). The other columns (Qualified, Not Home, Interested, etc.) are empty because no contacts have those values set.

## Solution

Two changes to prevent this from happening going forward and to fix the existing data:

### 1. Database Trigger: Auto-set default qualification status on INSERT

Create a trigger on the `contacts` table that sets `qualification_status = 'unqualified'` (or a configurable default) whenever a new contact is inserted with a NULL `qualification_status`. This ensures all future contacts -- whether created manually, via import, or via API -- always have a status.

### 2. SQL Migration: Backfill existing NULL contacts

Run a one-time UPDATE to set `qualification_status = 'unqualified'` for all contacts where it is currently NULL. This moves the 3,152+ existing contacts from "uncategorized" into the "New / Unassigned" column with a proper status key.

### 3. Kanban Board: Map 'unqualified' to the "New / Unassigned" column

Update `ContactKanbanBoard.tsx` so that contacts with `qualification_status = 'unqualified'` are shown in the "New / Unassigned" column alongside truly NULL contacts. This way the first column captures both legacy NULL and the new default status.

## Files Modified

1. **New SQL migration** -- backfill NULL qualification_status to 'unqualified' and create INSERT trigger
2. **`src/features/contacts/components/ContactKanbanBoard.tsx`** -- treat 'unqualified' same as uncategorized in grouping logic (line 90)

## Technical Notes

- The trigger uses `BEFORE INSERT` so the value is set before RLS policies evaluate the row
- The backfill is safe -- it only updates rows where `qualification_status IS NULL`
- No UI changes needed beyond the grouping logic tweak
- Existing contacts that already have a status (storm_damage, not_home, etc.) are untouched

