-- =============================================
-- Create set_location_id_from_user() trigger function
-- =============================================

CREATE OR REPLACE FUNCTION set_location_id_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only set location_id if it's NULL (allow explicit setting)
  IF NEW.location_id IS NULL THEN
    -- Get user's active location from user_location_assignments
    SELECT ula.location_id INTO NEW.location_id
    FROM user_location_assignments ula
    WHERE ula.user_id = auth.uid()
      AND ula.is_active = true
    ORDER BY ula.created_at ASC
    LIMIT 1;
  END IF;
  
  RETURN NEW;
END;
$$;

-- =============================================
-- Add triggers for pipeline_entries and projects
-- =============================================

-- Trigger for pipeline_entries
DROP TRIGGER IF EXISTS set_pipeline_entry_location ON pipeline_entries;
CREATE TRIGGER set_pipeline_entry_location
  BEFORE INSERT ON pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION set_location_id_from_user();

-- Trigger for projects
DROP TRIGGER IF EXISTS set_project_location ON projects;
CREATE TRIGGER set_project_location
  BEFORE INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_location_id_from_user();