

# Delete Incorrect Lead from Punit Shah

The newer pipeline entry `e9f68776-f3e3-425d-9289-94c8e44d9beb` (created Mar 11, $15,000) was saved to Punit Shah by mistake — it was meant for David Ramage. Soft-delete it.

## Fix

Single data update using the insert tool:

```sql
UPDATE public.pipeline_entries
SET is_deleted = true,
    deleted_at = now()
WHERE id = 'e9f68776-f3e3-425d-9289-94c8e44d9beb';
```

No code changes needed.

