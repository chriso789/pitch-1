-- 1) Backfill missing pipeline location assignments from the linked contact
UPDATE public.pipeline_entries pe
SET location_id = c.location_id
FROM public.contacts c
WHERE pe.contact_id = c.id
  AND pe.location_id IS NULL
  AND c.location_id IS NOT NULL
  AND coalesce(pe.is_deleted, false) = false;

-- 2) Ensure every active admin/owner profile has a matching tenant-scoped role row
INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT p.id, p.role::public.app_role, p.tenant_id
FROM public.profiles p
WHERE p.is_active
  AND p.tenant_id IS NOT NULL
  AND p.role IN ('master','owner','corporate','office_admin','regional_manager','sales_manager','project_manager')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.tenant_id = p.tenant_id
  )
ON CONFLICT DO NOTHING;