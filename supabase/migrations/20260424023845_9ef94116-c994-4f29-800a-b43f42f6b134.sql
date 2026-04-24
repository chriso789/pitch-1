-- Correct Michael Grosso's rep commission % from 50 to 40 on his estimates
-- and recompute rep_commission_amount as 40% of actual_profit_amount.
-- Only touches estimates tied to pipeline entries assigned to him where rep_commission_percent = 50.

UPDATE public.enhanced_estimates ee
SET 
  rep_commission_percent = 40,
  rep_commission_amount = ROUND((COALESCE(ee.actual_profit_amount, 0) * 0.40)::numeric, 2),
  updated_at = NOW()
WHERE ee.rep_commission_percent = 50
  AND ee.pipeline_entry_id IN (
    SELECT id FROM public.pipeline_entries
    WHERE assigned_to = 'f828ec8a-07e9-4d20-a642-a60cb320fede'
       OR secondary_assigned_to = 'f828ec8a-07e9-4d20-a642-a60cb320fede'
  );