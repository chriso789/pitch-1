-- Create function_logs table for edge function observability
CREATE TABLE IF NOT EXISTS public.function_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  function_name TEXT NOT NULL,
  execution_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'warning')),
  error_message TEXT,
  error_stack TEXT,
  context JSONB DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add indexes for common queries
CREATE INDEX idx_function_logs_tenant ON public.function_logs(tenant_id);
CREATE INDEX idx_function_logs_function_name ON public.function_logs(function_name);
CREATE INDEX idx_function_logs_status ON public.function_logs(status);
CREATE INDEX idx_function_logs_created_at ON public.function_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.function_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view function logs in their tenant"
  ON public.function_logs
  FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert function logs"
  ON public.function_logs
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Admins can manage logs
CREATE POLICY "Admins can manage function logs in their tenant"
  ON public.function_logs
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id() AND 
    has_any_role(ARRAY['admin'::app_role, 'master'::app_role])
  );

-- Create helper function to log errors
CREATE OR REPLACE FUNCTION public.log_function_error(
  p_function_name TEXT,
  p_error_message TEXT,
  p_context JSONB DEFAULT '{}'::jsonb,
  p_error_stack TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.function_logs (
    tenant_id,
    function_name,
    status,
    error_message,
    error_stack,
    context
  ) VALUES (
    get_user_tenant_id(),
    p_function_name,
    'error',
    p_error_message,
    p_error_stack,
    p_context
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

COMMENT ON TABLE public.function_logs IS 'Logs for edge function executions, errors, and performance metrics';
COMMENT ON FUNCTION public.log_function_error IS 'Helper function to log edge function errors from client or server';