

# Delete Duplicate Lead for Korede Akeju

## Problem
Contact Korede Akeju (C3409) has two pipeline entries when there should only be one:
- `4d5dfadc` — $20,000, created Feb 22 (keep)
- `2b1b24c0` — $15,000, created Mar 11 (delete)

## Fix
Single SQL migration to soft-delete pipeline entry `2b1b24c0-c987-4bc8-8ce4-2607423e9548`:

```sql
UPDATE public.pipeline_entries
SET is_deleted = true,
    deleted_at = now()
WHERE id = '2b1b24c0-c987-4bc8-8ce4-2607423e9548';
```

No code changes needed. The pipeline view already filters by `is_deleted = false`.

