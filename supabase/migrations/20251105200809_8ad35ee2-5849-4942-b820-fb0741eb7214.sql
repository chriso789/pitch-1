-- Create AI usage metrics table
CREATE TABLE IF NOT EXISTS public.ai_usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- AI Provider info
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'openai', 'lovable-ai')),
  model TEXT NOT NULL,
  
  -- Usage metrics
  feature TEXT NOT NULL, -- e.g., 'lead-scorer', 'sales-advisor', 'task-generator'
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  
  -- Performance metrics
  response_time_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'rate_limited', 'payment_required')),
  error_message TEXT,
  
  -- Cost tracking (in USD)
  estimated_cost_usd DECIMAL(10, 6),
  
  -- Request metadata
  request_id TEXT,
  endpoint TEXT
);

-- Enable RLS
ALTER TABLE public.ai_usage_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their tenant's AI metrics"
  ON public.ai_usage_metrics
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert AI metrics"
  ON public.ai_usage_metrics
  FOR INSERT
  WITH CHECK (true); -- Edge functions will insert with service role

-- Indexes for performance
CREATE INDEX idx_ai_usage_tenant ON public.ai_usage_metrics(tenant_id);
CREATE INDEX idx_ai_usage_created ON public.ai_usage_metrics(created_at DESC);
CREATE INDEX idx_ai_usage_provider ON public.ai_usage_metrics(provider);
CREATE INDEX idx_ai_usage_feature ON public.ai_usage_metrics(feature);
CREATE INDEX idx_ai_usage_status ON public.ai_usage_metrics(status);

-- Create view for aggregated metrics
CREATE OR REPLACE VIEW public.ai_usage_summary AS
SELECT 
  tenant_id,
  provider,
  model,
  feature,
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as request_count,
  SUM(prompt_tokens) as total_prompt_tokens,
  SUM(completion_tokens) as total_completion_tokens,
  SUM(total_tokens) as total_tokens,
  AVG(response_time_ms) as avg_response_time_ms,
  SUM(estimated_cost_usd) as total_cost_usd,
  COUNT(*) FILTER (WHERE status = 'success') as success_count,
  COUNT(*) FILTER (WHERE status = 'error') as error_count,
  COUNT(*) FILTER (WHERE status = 'rate_limited') as rate_limited_count,
  COUNT(*) FILTER (WHERE status = 'payment_required') as payment_required_count
FROM public.ai_usage_metrics
GROUP BY tenant_id, provider, model, feature, DATE_TRUNC('hour', created_at);

-- Function to get tenant AI usage stats
CREATE OR REPLACE FUNCTION public.get_ai_usage_stats(
  p_tenant_id UUID,
  p_hours_back INTEGER DEFAULT 24
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stats JSON;
BEGIN
  -- Check user has access to this tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT json_build_object(
    'total_requests', COUNT(*),
    'total_tokens', SUM(total_tokens),
    'total_cost_usd', COALESCE(SUM(estimated_cost_usd), 0),
    'avg_response_time_ms', AVG(response_time_ms),
    'success_rate', 
      ROUND(
        (COUNT(*) FILTER (WHERE status = 'success')::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 
        2
      ),
    'by_provider', json_agg(DISTINCT jsonb_build_object(
      'provider', provider,
      'requests', (SELECT COUNT(*) FROM ai_usage_metrics WHERE tenant_id = p_tenant_id AND provider = aim.provider AND created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL),
      'tokens', (SELECT SUM(total_tokens) FROM ai_usage_metrics WHERE tenant_id = p_tenant_id AND provider = aim.provider AND created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL),
      'cost_usd', (SELECT COALESCE(SUM(estimated_cost_usd), 0) FROM ai_usage_metrics WHERE tenant_id = p_tenant_id AND provider = aim.provider AND created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL)
    )),
    'by_feature', json_agg(DISTINCT jsonb_build_object(
      'feature', feature,
      'requests', (SELECT COUNT(*) FROM ai_usage_metrics WHERE tenant_id = p_tenant_id AND feature = aim.feature AND created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL),
      'avg_response_time', (SELECT AVG(response_time_ms) FROM ai_usage_metrics WHERE tenant_id = p_tenant_id AND feature = aim.feature AND created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL)
    ))
  ) INTO v_stats
  FROM ai_usage_metrics aim
  WHERE tenant_id = p_tenant_id
    AND created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL;

  RETURN v_stats;
END;
$$;