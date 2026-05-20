
-- =========================================================================
-- Multi-tenant integrity hardening
-- 1. Fix the one contaminated document (S046834 Fonsica PDF written under
--    O'Brien tenant before the roof-report-ingest active_tenant_id fix).
-- 2. Add a trigger that blocks any future cross-tenant child writes
--    (documents / estimates / customer_photos / project_photos whose
--    tenant_id does not match the parent pipeline_entry/contact).
-- =========================================================================

-- 1. Move the contaminated Fonsica document to its parent pipeline_entry's tenant
UPDATE public.documents d
SET tenant_id = pe.tenant_id
FROM public.pipeline_entries pe
WHERE pe.id = d.pipeline_entry_id
  AND d.tenant_id IS DISTINCT FROM pe.tenant_id;

-- 2. Generic guard function: child.tenant_id must equal parent.tenant_id
CREATE OR REPLACE FUNCTION public.enforce_child_tenant_matches_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  -- documents
  IF TG_TABLE_NAME = 'documents' THEN
    IF NEW.pipeline_entry_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant
        FROM public.pipeline_entries WHERE id = NEW.pipeline_entry_id;
      IF parent_tenant IS NOT NULL AND parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id mismatch on documents: doc tenant=% parent pipeline_entry tenant=%',
          NEW.tenant_id, parent_tenant;
      END IF;
    END IF;
    IF NEW.contact_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant
        FROM public.contacts WHERE id = NEW.contact_id;
      IF parent_tenant IS NOT NULL AND parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id mismatch on documents: doc tenant=% parent contact tenant=%',
          NEW.tenant_id, parent_tenant;
      END IF;
    END IF;
  END IF;

  -- estimates
  IF TG_TABLE_NAME = 'estimates' THEN
    IF NEW.pipeline_entry_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant
        FROM public.pipeline_entries WHERE id = NEW.pipeline_entry_id;
      IF parent_tenant IS NOT NULL AND parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id mismatch on estimates: estimate tenant=% parent pipeline_entry tenant=%',
          NEW.tenant_id, parent_tenant;
      END IF;
    END IF;
  END IF;

  -- customer_photos
  IF TG_TABLE_NAME = 'customer_photos' THEN
    IF NEW.contact_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant
        FROM public.contacts WHERE id = NEW.contact_id;
      IF parent_tenant IS NOT NULL AND parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id mismatch on customer_photos: photo tenant=% parent contact tenant=%',
          NEW.tenant_id, parent_tenant;
      END IF;
    END IF;
  END IF;

  -- project_photos
  IF TG_TABLE_NAME = 'project_photos' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant
        FROM public.pipeline_entries WHERE id = NEW.project_id;
      IF parent_tenant IS NOT NULL AND parent_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id mismatch on project_photos: photo tenant=% parent pipeline_entry tenant=%',
          NEW.tenant_id, parent_tenant;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Attach the trigger to each child table
DROP TRIGGER IF EXISTS trg_documents_tenant_match ON public.documents;
CREATE TRIGGER trg_documents_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, pipeline_entry_id, contact_id
  ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_child_tenant_matches_parent();

DROP TRIGGER IF EXISTS trg_estimates_tenant_match ON public.estimates;
CREATE TRIGGER trg_estimates_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, pipeline_entry_id
  ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_child_tenant_matches_parent();

DROP TRIGGER IF EXISTS trg_customer_photos_tenant_match ON public.customer_photos;
CREATE TRIGGER trg_customer_photos_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, contact_id
  ON public.customer_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_child_tenant_matches_parent();

DROP TRIGGER IF EXISTS trg_project_photos_tenant_match ON public.project_photos;
CREATE TRIGGER trg_project_photos_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, project_id
  ON public.project_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_child_tenant_matches_parent();
