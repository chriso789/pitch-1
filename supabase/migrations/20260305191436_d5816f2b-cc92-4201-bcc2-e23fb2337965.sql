-- Restore accidentally soft-deleted pipeline entries that have linked jobs or projects
UPDATE pipeline_entries
SET is_deleted = false, deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
WHERE is_deleted = true
  AND (
    EXISTS (SELECT 1 FROM jobs j WHERE j.pipeline_entry_id = pipeline_entries.id)
    OR EXISTS (SELECT 1 FROM projects p WHERE p.pipeline_entry_id = pipeline_entries.id)
  );

-- Preventive trigger: block soft-deleting converted pipeline entries
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