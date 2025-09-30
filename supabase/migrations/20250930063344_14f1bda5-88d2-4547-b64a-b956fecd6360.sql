-- Migration 1: Extend audit_log table with location tracking
ALTER TABLE audit_log 
  ADD COLUMN IF NOT EXISTS location_data JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS user_location JSONB,
  ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record 
  ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by 
  ON audit_log(changed_by, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_session 
  ON audit_log(session_id) WHERE session_id IS NOT NULL;

-- Migration 2: Create comprehensive audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  current_ip TEXT;
  current_ua TEXT;
  current_loc JSONB;
BEGIN
  -- Safely extract request metadata
  BEGIN
    current_ip := current_setting('request.headers', true)::json->>'x-real-ip';
  EXCEPTION WHEN OTHERS THEN
    current_ip := NULL;
  END;
  
  BEGIN
    current_ua := current_setting('request.headers', true)::json->>'user-agent';
  EXCEPTION WHEN OTHERS THEN
    current_ua := NULL;
  END;
  
  BEGIN
    current_loc := current_setting('app.current_location', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    current_loc := '{}'::jsonb;
  END;

  INSERT INTO audit_log (
    tenant_id,
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    changed_by,
    ip_address,
    user_agent,
    location_data
  ) VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    auth.uid(),
    current_ip::inet,
    current_ua,
    current_loc
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply triggers to key tables
DROP TRIGGER IF EXISTS audit_contacts_trigger ON contacts;
CREATE TRIGGER audit_contacts_trigger
  AFTER INSERT OR UPDATE OR DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS audit_pipeline_entries_trigger ON pipeline_entries;
CREATE TRIGGER audit_pipeline_entries_trigger
  AFTER INSERT OR UPDATE OR DELETE ON pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS audit_projects_trigger ON projects;
CREATE TRIGGER audit_projects_trigger
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();