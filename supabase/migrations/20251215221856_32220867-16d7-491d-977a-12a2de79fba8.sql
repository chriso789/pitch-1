-- Fix remaining views with SECURITY INVOKER
-- The first migration successfully dropped these but they were restored from a backup

-- Recreate ai_usage_summary with SECURITY INVOKER
DROP VIEW IF EXISTS public.ai_usage_summary;
CREATE VIEW public.ai_usage_summary
WITH (security_invoker = true)
AS
SELECT 
  tenant_id,
  provider,
  model,
  feature,
  date_trunc('hour'::text, created_at) AS hour,
  count(*) AS request_count,
  sum(prompt_tokens) AS total_prompt_tokens,
  sum(completion_tokens) AS total_completion_tokens,
  sum(total_tokens) AS total_tokens,
  avg(response_time_ms) AS avg_response_time_ms,
  sum(estimated_cost_usd) AS total_cost_usd,
  count(*) FILTER (WHERE (status = 'success'::text)) AS success_count,
  count(*) FILTER (WHERE (status = 'error'::text)) AS error_count,
  count(*) FILTER (WHERE (status = 'rate_limited'::text)) AS rate_limited_count,
  count(*) FILTER (WHERE (status = 'payment_required'::text)) AS payment_required_count
FROM ai_usage_metrics
GROUP BY tenant_id, provider, model, feature, date_trunc('hour'::text, created_at);

-- Recreate roof_daily_performance_metrics with SECURITY INVOKER
DROP VIEW IF EXISTS public.roof_daily_performance_metrics;
CREATE VIEW public.roof_daily_performance_metrics
WITH (security_invoker = true)
AS
SELECT 
  date(logged_at) AS date,
  count(*) AS total_measurements,
  avg(area_accuracy_percent) AS avg_accuracy,
  avg(processing_time_seconds) AS avg_processing_time,
  sum(total_cost_usd) AS total_cost,
  count(CASE WHEN required_manual_corrections THEN 1 ELSE NULL::integer END) AS corrections_needed
FROM roof_ai_model_performance
GROUP BY date(logged_at)
ORDER BY date(logged_at) DESC;