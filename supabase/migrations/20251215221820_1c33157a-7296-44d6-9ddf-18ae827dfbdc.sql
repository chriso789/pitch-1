-- Fix roof_measurement_summary view with SECURITY INVOKER
DROP VIEW IF EXISTS public.roof_measurement_summary;
CREATE VIEW public.roof_measurement_summary
WITH (security_invoker = true)
AS
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