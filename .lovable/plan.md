

# Prevent Duplicate Active Leads per Contact

## Problem
Multiple active (non-deleted) pipeline entries can be created for the same contact, as happened with Punit Shah. The only valid reason for multiple leads is different addresses, which means different contacts.

## Analysis
Since addresses live on the **contacts** table (not pipeline_entries), and each contact has one address, two active leads for the same `contact_id` always means same address — a duplicate. If a lead is needed at a different address, it should be a different contact record.

There are 3 lead creation paths:
1. **LeadForm.tsx** — creates new contact + pipeline entry (always new contact, low risk)
2. **ContactBulkImport.tsx** — creates contacts + pipeline entries in batches
3. **canvass-dispositions edge function** — already checks for existing pipeline entry before inserting

## Solution: Database Partial Unique Index

Add a partial unique index on `pipeline_entries(contact_id)` where `is_deleted = false`. This prevents duplicates at the database level across all creation paths with zero UI changes needed.

```sql
CREATE UNIQUE INDEX idx_one_active_lead_per_contact
ON public.pipeline_entries (contact_id)
WHERE is_deleted = false;
```

Then update the **LeadForm** and **ContactBulkImport** to catch this constraint violation gracefully and show a clear error message like: *"This contact already has an active lead. Please update the existing lead instead."*

## Changes

1. **SQL Migration** — Create the partial unique index
2. **LeadForm.tsx** (~line 251) — Catch unique violation error (`23505`) on pipeline insert and show a user-friendly toast
3. **ContactBulkImport.tsx** (~line 1620) — Handle constraint violation in batch pipeline creation, log skipped duplicates without failing the batch

