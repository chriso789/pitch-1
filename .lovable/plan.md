## Goal
Backfill pipeline stages for the O'Brien tenant (`14de934e-7964-4afd-940a-620d2ace125d`) from `west_coast.csv` (43 rows, 6 milestones).

## Milestone → stage mapping
Mapping each CSV milestone to the closest existing stage in this tenant's pipeline (`lead → estimate_sent → contingency_signed → legal_review → ready_for_approval → project → completed → closed → lost`):

| CSV `Current Milestone` | Pipeline stage `key` |
|---|---|
| Assigned Lead | `lead` |
| Prospect | `estimate_sent` |
| Approved | `ready_for_approval` |
| Completed | `completed` |
| Invoiced | `completed` |
| Closed | `closed` |

## Matching rule
- Match on `lower(trim(first_name)) || ' ' || lower(trim(last_name))` against the CSV `Contact Name`, scoped to `tenant_id = 14de934e-…` and `is_deleted = false`.
- Per your answer, **update every matching pipeline entry** for that contact (handles duplicates like Irina Gorovits's two entries).
- Skip rows where the contact can't be matched (will be reported in the migration output as a NOTICE).

## Implementation
1. One migration that creates a temp table from the 43 CSV rows (name + mapped status), then runs:
   ```sql
   UPDATE pipeline_entries pe
      SET status = t.new_status, updated_at = now()
     FROM tmp_csv_status t
     JOIN contacts c ON c.id = pe.contact_id
    WHERE pe.tenant_id = '14de934e-…'
      AND pe.is_deleted = false
      AND lower(trim(c.first_name)) = t.first_name
      AND lower(trim(c.last_name))  = t.last_name;
   ```
2. RAISE NOTICE with counts: rows updated, contacts not found.
3. No code changes — backfill only.

## Out of scope
- Doesn't touch contacts in other tenants.
- Doesn't change `qualification_status` on `contacts` (this CSV is about pipeline stage, not lead qualification).
- Doesn't create new pipeline entries for CSV rows that don't already exist as pipeline entries.