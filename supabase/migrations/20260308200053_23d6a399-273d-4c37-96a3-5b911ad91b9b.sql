
-- Create the api_respond_to_approval_request function (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.api_respond_to_approval_request(
  approval_id_param uuid,
  action_param text,
  manager_notes_param text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_tenant uuid;
  v_approval record;
  v_clj_number text;
BEGIN
  IF action_param NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Must be approve or reject.');
  END IF;

  SELECT tenant_id INTO v_user_tenant
  FROM profiles
  WHERE id = v_user_id;

  IF v_user_tenant IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found.');
  END IF;

  IF NOT has_high_level_role(v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to approve or reject requests.');
  END IF;

  SELECT * INTO v_approval
  FROM manager_approval_queue
  WHERE id = approval_id_param
    AND tenant_id = v_user_tenant;

  IF v_approval IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Approval request not found or not in your tenant.');
  END IF;

  IF v_approval.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This request has already been processed.');
  END IF;

  UPDATE manager_approval_queue
  SET
    status = CASE WHEN action_param = 'approve' THEN 'approved' ELSE 'rejected' END,
    reviewed_by = v_user_id,
    reviewed_at = now(),
    approved_by = CASE WHEN action_param = 'approve' THEN v_user_id ELSE NULL END,
    approved_at = CASE WHEN action_param = 'approve' THEN now() ELSE NULL END,
    manager_notes = manager_notes_param,
    updated_at = now()
  WHERE id = approval_id_param;

  SELECT clj_formatted_number INTO v_clj_number
  FROM pipeline_entries
  WHERE id = v_approval.pipeline_entry_id;

  IF action_param = 'approve' THEN
    UPDATE pipeline_entries
    SET status = 'project', updated_at = now()
    WHERE id = v_approval.pipeline_entry_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'clj_number', COALESCE(v_clj_number, ''),
    'action', action_param
  );
END;
$$;

-- Add UPDATE RLS policy on manager_approval_queue for managers
DO $$ BEGIN
  CREATE POLICY "Managers can update approval requests in their tenant"
  ON manager_approval_queue
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND has_high_level_role(auth.uid())
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND has_high_level_role(auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
