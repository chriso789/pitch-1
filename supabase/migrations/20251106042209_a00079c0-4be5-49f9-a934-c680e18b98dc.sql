-- Create API rate limiting table
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own rate limit logs"
  ON public.api_rate_limits
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert rate limit logs"
  ON public.api_rate_limits
  FOR INSERT
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX idx_rate_limits_tenant_user_created 
  ON public.api_rate_limits(tenant_id, user_id, created_at DESC);

CREATE INDEX idx_rate_limits_cleanup 
  ON public.api_rate_limits(created_at);

-- Create function to clean up old rate limit logs (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.api_rate_limits
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$;

COMMENT ON TABLE public.api_rate_limits IS 'Tracks API requests for rate limiting and throttling';