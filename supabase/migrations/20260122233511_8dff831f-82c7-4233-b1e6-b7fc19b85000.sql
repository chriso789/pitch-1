-- Recreate views with SECURITY INVOKER to respect RLS of the querying user

-- 1. ai_usage_summary
DROP VIEW IF EXISTS public.ai_usage_summary;
CREATE VIEW public.ai_usage_summary 
WITH (security_invoker = true) AS
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
  count(*) FILTER (WHERE status = 'success') AS success_count,
  count(*) FILTER (WHERE status = 'error') AS error_count,
  count(*) FILTER (WHERE status = 'rate_limited') AS rate_limited_count,
  count(*) FILTER (WHERE status = 'payment_required') AS payment_required_count
FROM ai_usage_metrics
GROUP BY tenant_id, provider, model, feature, date_trunc('hour'::text, created_at);

-- 2. roof_daily_performance_metrics
DROP VIEW IF EXISTS public.roof_daily_performance_metrics;
CREATE VIEW public.roof_daily_performance_metrics
WITH (security_invoker = true) AS
SELECT 
  date(logged_at) AS date,
  count(*) AS total_measurements,
  avg(area_accuracy_percent) AS avg_accuracy,
  avg(processing_time_seconds) AS avg_processing_time,
  sum(total_cost_usd) AS total_cost,
  count(CASE WHEN required_manual_corrections THEN 1 ELSE NULL END) AS corrections_needed
FROM roof_ai_model_performance
GROUP BY date(logged_at)
ORDER BY date(logged_at) DESC;

-- 3. roof_measurement_summary
DROP VIEW IF EXISTS public.roof_measurement_summary;
CREATE VIEW public.roof_measurement_summary
WITH (security_invoker = true) AS
SELECT 
  rm.id,
  rm.property_address,
  rm.created_at,
  rm.total_area_adjusted_sqft,
  rm.total_squares,
  rm.facet_count,
  rm.predominant_pitch,
  rm.measurement_confidence,
  rm.validation_status,
  amp.area_accuracy_percent,
  amp.user_satisfaction_rating,
  count(mc.id) AS correction_count
FROM roof_measurements rm
LEFT JOIN roof_ai_model_performance amp ON rm.id = amp.measurement_id
LEFT JOIN roof_measurement_corrections mc ON rm.id = mc.measurement_id
GROUP BY rm.id, amp.area_accuracy_percent, amp.user_satisfaction_rating;