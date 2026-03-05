

# Fix: Pipeline Entries Not Showing for Converted Leads

## Root Cause

Jean Derilus's pipeline entry (`be2da4f5-98ab-43ed-9f99-de71d3feb4e2`) has `is_deleted = true`, even though it has an active job and project linked to it. This happened because a batch cleanup migration (`20260121014536`) soft-deleted orphan pipeline entries using broad criteria (East Coast location, created 2026-01-19, `created_by IS NULL`). It accidentally caught entries that had already been converted to projects.

The Contact Profile page queries `pipeline_entries` with `.eq('is_deleted', false)`, so these converted entries don't appear. Meanwhile, the `jobs` table query has no such filter, so the job card still shows — creating the confusing state where "Pipeline (0)" is displayed but a job card appears below.

There are **2 pipeline entries** with `deleted_by IS NULL` (accidentally deleted) and **3 more** that were manually deleted but still have active jobs/projects — totaling **5 affected records**.

## Fix (2 parts)

### 1. Data Repair: Restore accidentally deleted pipeline entries
Restore all pipeline entries that were soft-deleted but still have active jobs or projects linked to them.

```sql
UPDATE pipeline_entries
SET is_deleted = false, deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
WHERE is_deleted = true
  AND (
    EXISTS (SELECT 1 FROM jobs j WHERE j.pipeline_entry_id = pipeline_entries.id)
    OR EXISTS (SELECT 1 FROM projects p WHERE p.pipeline_entry_id = pipeline_entries.id)
  );
```

This will restore all 5 affected records. The criteria is safe: if a pipeline entry has a linked job or project, it should never be marked as deleted.

### 2. Preventive Guard: Protect converted entries from future deletions
Add a database trigger that prevents soft-deleting pipeline entries that have linked projects or jobs, unless the user explicitly force-deletes.

**File: New SQL migration**
```sql
CREATE OR REPLACE FUNCTION prevent_delete_converted_pipeline()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    IF EXISTS (SELECT 1 FROM projects WHERE pipeline_entry_id = OLD.id)
       OR EXISTS (SELECT 1 FROM jobs WHERE pipeline_entry_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot delete pipeline entry with linked projects/jobs';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guard_converted_pipeline_delete
BEFORE UPDATE ON pipeline_entries
FOR EACH ROW
EXECUTE FUNCTION prevent_delete_converted_pipeline();
```

## Scope
- Data repair via SQL (affects 5 records)
- One new migration for the protective trigger
- No frontend code changes needed — once data is restored, existing queries will pick it up

