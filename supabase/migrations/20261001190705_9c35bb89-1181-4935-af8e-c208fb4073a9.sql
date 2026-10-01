CREATE OR REPLACE FUNCTION public.sync_tenant_name_to_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.profiles SET company_name = NEW.name WHERE tenant_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.sync_tenant_name_to_profiles() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sync_tenant_name_to_profiles ON public.tenants;
CREATE TRIGGER trg_sync_tenant_name_to_profiles AFTER UPDATE OF name ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_name_to_profiles();