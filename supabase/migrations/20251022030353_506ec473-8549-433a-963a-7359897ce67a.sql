-- Create RPC function to save call disposition
CREATE OR REPLACE FUNCTION public.api_save_call_disposition(
  p_call_id UUID,
  p_disposition TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Get tenant_id from the call log
  SELECT tenant_id INTO v_tenant_id
  FROM call_logs
  WHERE id = p_call_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Call log not found';
  END IF;

  -- Verify user has access to this tenant
  IF v_tenant_id NOT IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Insert disposition
  INSERT INTO call_dispositions (
    tenant_id,
    call_id,
    disposition,
    notes,
    created_by
  ) VALUES (
    v_tenant_id,
    p_call_id,
    p_disposition,
    p_notes,
    auth.uid()
  );
END;
$$;