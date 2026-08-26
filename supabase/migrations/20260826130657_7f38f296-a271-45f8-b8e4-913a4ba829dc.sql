-- Ensure every tenant has its closed/settled stage configured for auto-advance
WITH candidate AS (
  SELECT DISTINCT ON (ps.tenant_id) ps.id, ps.tenant_id
  FROM public.pipeline_stages ps
  WHERE ps.is_active = true
    AND (
      ps.key ILIKE '%capped%' OR ps.name ILIKE '%capped%'
      OR ps.key ILIKE '%closed%' OR ps.name ILIKE '%closed%'
      OR ps.key ILIKE '%paid%'   OR ps.name ILIKE '%paid%'
      OR ps.key ILIKE '%settle%' OR ps.name ILIKE '%settle%'
    )
    AND ps.key NOT ILIKE '%lost%'
    AND ps.name NOT ILIKE '%lost%'
    AND ps.key NOT ILIKE '%dead%'
    AND ps.name NOT ILIKE '%dead%'
  ORDER BY ps.tenant_id, ps.stage_order DESC
),
needs AS (
  SELECT c.id
  FROM candidate c
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

-- Catch up any projects already past their configured window
SELECT public.sweep_closed_stage_auto_advance(500);