
CREATE OR REPLACE FUNCTION public.get_pipeline_status_counts(
  p_tenant_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_user_role text DEFAULT NULL
)
RETURNS TABLE(status text, count int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pe.status, count(*)::int AS count
  FROM pipeline_entries pe
  WHERE pe.tenant_id = p_tenant_id
    AND pe.is_deleted = false
    AND (p_location_id IS NULL OR pe.location_id = p_location_id)
    AND (
      -- Admin roles see everything
      p_user_role IN ('master', 'owner', 'corporate', 'office_admin')
      -- Non-admin roles only see their own entries
      OR pe.assigned_to = p_user_id
      OR pe.created_by = p_user_id
    )
  GROUP BY pe.status;
$$;
