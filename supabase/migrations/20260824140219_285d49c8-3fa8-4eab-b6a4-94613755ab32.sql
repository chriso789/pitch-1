CREATE OR REPLACE FUNCTION public.tg_login_attempts_fill_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT p.tenant_id INTO v_tenant
    FROM public.profiles p
    WHERE (NEW.user_id IS NOT NULL AND p.id = NEW.user_id)
       OR (NEW.user_id IS NULL AND NEW.email IS NOT NULL AND lower(p.email) = lower(NEW.email))
    ORDER BY (p.id = NEW.user_id) DESC
    LIMIT 1;
    NEW.tenant_id := v_tenant;
  END IF;

  IF NEW.tenant_id IS NOT NULL AND NEW.company_name IS NULL THEN
    SELECT t.name INTO NEW.company_name FROM public.tenants t WHERE t.id = NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_login_attempts_fill_company ON public.login_attempts;
CREATE TRIGGER trg_login_attempts_fill_company
BEFORE INSERT ON public.login_attempts
FOR EACH ROW EXECUTE FUNCTION public.tg_login_attempts_fill_company();