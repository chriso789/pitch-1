
-- Deactivate SPLI-<uuid> duplicates that have a readable-code twin at the same base cost & similar name
WITH candidates AS (
  SELECT s.id AS spli_id,
         o.id AS keep_id,
         similarity(lower(s.name), lower(o.name)) AS sim
  FROM public.materials s
  JOIN public.materials o
    ON o.tenant_id = s.tenant_id
   AND o.base_cost = s.base_cost
   AND o.code NOT LIKE 'SPLI-%'
   AND o.active = true
  WHERE s.code LIKE 'SPLI-%'
    AND s.active = true
    AND similarity(lower(s.name), lower(o.name)) >= 0.55
),
ranked AS (
  SELECT DISTINCT ON (spli_id) spli_id, keep_id
  FROM candidates
  ORDER BY spli_id, sim DESC
)
UPDATE public.materials m
SET active = false,
    updated_at = now(),
    attributes = COALESCE(attributes, '{}'::jsonb) || jsonb_build_object(
      'deactivated_reason', 'duplicate_of_readable_code_import',
      'deactivated_at', now(),
      'superseded_by', r.keep_id
    )
FROM ranked r
WHERE m.id = r.spli_id;

-- Prevent future duplicates: unique on (tenant_id, lower(name)) among active materials.
-- Uses COALESCE so global (tenant_id IS NULL) rows share a bucket too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_materials_tenant_lower_name_active
  ON public.materials (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE active = true;
