-- =====================================================================
-- Homeowner portal: tenant-wide enablement (parity with O'Brien)
-- =====================================================================
-- 1) Seed tenant_settings with portal display defaults for every tenant
-- 2) On lead -> project conversion (INSERT on projects), auto-enable
--    portal_access for the linked contact (if email present)
-- 3) Backfill: enable portal_access for every existing project's contact
-- =====================================================================

-- 1) Seed tenant_settings rows for every tenant lacking one
INSERT INTO public.tenant_settings (
  tenant_id,
  portal_show_photos,
  portal_show_documents,
  portal_show_balance,
  portal_show_messages,
  zelle_enabled
)
SELECT t.id, true, true, false, true, false
FROM public.tenants t
LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
WHERE ts.tenant_id IS NULL;

-- 2) Trigger function: enable portal access on linked contact when a
--    project is created (lead -> project conversion).
CREATE OR REPLACE FUNCTION public.enable_homeowner_portal_on_project_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  IF NEW.pipeline_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pe.contact_id INTO v_contact_id
  FROM public.pipeline_entries pe
  WHERE pe.id = NEW.pipeline_entry_id;

  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.contacts c
     SET portal_access_enabled = true,
         portal_access_granted_at = COALESCE(c.portal_access_granted_at, now())
   WHERE c.id = v_contact_id
     AND c.tenant_id = NEW.tenant_id
     AND COALESCE(c.portal_access_enabled, false) = false
     AND c.email IS NOT NULL
     AND length(trim(c.email)) > 0;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enable_homeowner_portal_on_project_create ON public.projects;
CREATE TRIGGER trg_enable_homeowner_portal_on_project_create
AFTER INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.enable_homeowner_portal_on_project_create();

-- 3) Backfill: every contact that already has a project gets portal_access_enabled
UPDATE public.contacts c
   SET portal_access_enabled = true,
       portal_access_granted_at = COALESCE(c.portal_access_granted_at, now())
  FROM public.pipeline_entries pe
  JOIN public.projects p ON p.pipeline_entry_id = pe.id
 WHERE pe.contact_id = c.id
   AND pe.tenant_id = c.tenant_id
   AND COALESCE(c.portal_access_enabled, false) = false
   AND c.email IS NOT NULL
   AND length(trim(c.email)) > 0;