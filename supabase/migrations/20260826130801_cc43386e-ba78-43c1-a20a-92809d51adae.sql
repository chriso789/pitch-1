WITH candidate AS (
  SELECT DISTINCT ON (ps.tenant_id) ps.id, ps.tenant_id
  FROM public.pipeline_stages ps
  WHERE ps.is_active = true
    AND (ps.name ILIKE 'complete%' OR ps.key ILIKE 'complete%')
  ORDER BY ps.tenant_id, ps.stage_order DESC
), needs AS (
  SELECT c.id FROM candidate c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages x
    WHERE x.tenant_id = c.tenant_id
      AND x.is_active = true
      AND x.archive_on_entry = true
      AND COALESCE(x.archive_after_days, 0) > 0
  )
)
UPDATE public.pipeline_stages ps
   SET archive_on_entry = true,
       archive_after_days = 30,
       updated_at = now()
 WHERE ps.id IN (SELECT id FROM needs);

SELECT public.sweep_closed_stage_auto_advance(500);