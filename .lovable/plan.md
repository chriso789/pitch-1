

# The Lead Name "VCA Palm Beach" Is Not Stored in the Database

After investigating, the `lead_name` column for this pipeline entry (`3ffe4e61-58ff-45b0-9925-540a14aa994b`) is currently **null** in the database. The previous name change happened before the `lead_name` column was added, so it was either lost or applied to the contact record (which still shows "Kyle Kadis").

## What needs to happen

**Set the `lead_name` value in the database** for this entry. This is a one-line SQL update — no code changes needed since the UI already displays `lead_name` when it has a value.

```sql
UPDATE pipeline_entries 
SET lead_name = 'VCA Palm Beach' 
WHERE id = '3ffe4e61-58ff-45b0-9925-540a14aa994b';
```

Once this runs:
- The header card will show "VCA Palm Beach" instead of "Kyle Kadis"
- The Pipeline tab card will show "VCA Palm Beach" instead of "Kyle Kadis - flat Lead"
- The Kanban board card will show "VCA Palm Beach"

Going forward, users can set/change lead names through the **Edit Lead Details** dialog, which now correctly writes to `pipeline_entries.lead_name`.

### Files Changed
- **Migration file only** — a single UPDATE statement to set the lead name that was lost during the architectural change.

