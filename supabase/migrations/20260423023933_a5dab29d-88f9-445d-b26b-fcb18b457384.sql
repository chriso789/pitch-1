UPDATE public.roof_measurements rm
SET tenant_id = pe.tenant_id
FROM public.pipeline_entries pe
WHERE rm.customer_id = pe.id
  AND pe.tenant_id IS NOT NULL
  AND (rm.tenant_id IS DISTINCT FROM pe.tenant_id);

UPDATE public.measurement_approvals ma
SET tenant_id = pe.tenant_id
FROM public.pipeline_entries pe
WHERE ma.pipeline_entry_id = pe.id
  AND pe.tenant_id IS NOT NULL
  AND (ma.tenant_id IS DISTINCT FROM pe.tenant_id);

UPDATE public.measurement_jobs mj
SET tenant_id = pe.tenant_id::text
FROM public.pipeline_entries pe
WHERE mj.pipeline_entry_id::uuid = pe.id
  AND pe.tenant_id IS NOT NULL
  AND (mj.tenant_id IS DISTINCT FROM pe.tenant_id::text);