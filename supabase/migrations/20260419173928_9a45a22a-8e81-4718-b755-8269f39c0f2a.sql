-- 1. Company email domains table
CREATE TABLE IF NOT EXISTS public.company_email_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  default_access_level TEXT NOT NULL DEFAULT 'member',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_email_domains_domain_unique UNIQUE (domain)
);

CREATE INDEX IF NOT EXISTS idx_company_email_domains_tenant ON public.company_email_domains(tenant_id);
CREATE INDEX IF NOT EXISTS idx_company_email_domains_domain ON public.company_email_domains(LOWER(domain));

CREATE OR REPLACE FUNCTION public.normalize_company_email_domain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.domain := LOWER(TRIM(REPLACE(REPLACE(NEW.domain, 'http://', ''), 'https://', '')));
  IF NEW.domain LIKE '@%' THEN NEW.domain := SUBSTRING(NEW.domain FROM 2); END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_company_email_domain ON public.company_email_domains;
CREATE TRIGGER trg_normalize_company_email_domain
  BEFORE INSERT OR UPDATE ON public.company_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.normalize_company_email_domain();

ALTER TABLE public.company_email_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins can view their domains"
  ON public.company_email_domains FOR SELECT
  USING (
    public.has_role(auth.uid(), 'master'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid()
        AND uca.tenant_id = company_email_domains.tenant_id
        AND uca.is_active = true
        AND uca.access_level IN ('owner','admin')
    )
  );

CREATE POLICY "Company admins can insert their domains"
  ON public.company_email_domains FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'master'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid()
        AND uca.tenant_id = company_email_domains.tenant_id
        AND uca.is_active = true
        AND uca.access_level IN ('owner','admin')
    )
  );

CREATE POLICY "Company admins can update their domains"
  ON public.company_email_domains FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'master'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid()
        AND uca.tenant_id = company_email_domains.tenant_id
        AND uca.is_active = true
        AND uca.access_level IN ('owner','admin')
    )
  );

CREATE POLICY "Company admins can delete their domains"
  ON public.company_email_domains FOR DELETE
  USING (
    public.has_role(auth.uid(), 'master'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid()
        AND uca.tenant_id = company_email_domains.tenant_id
        AND uca.is_active = true
        AND uca.access_level IN ('owner','admin')
    )
  );

-- 2. Ensure unique constraint on user_company_access for ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_company_access_user_tenant_unique'
  ) THEN
    BEGIN
      ALTER TABLE public.user_company_access
        ADD CONSTRAINT user_company_access_user_tenant_unique UNIQUE (user_id, tenant_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

-- 3. Update handle_new_user to auto-link by email domain
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_tenant_id UUID;
  email_domain TEXT;
  matched_tenant_id UUID;
  matched_access_level TEXT;
  signup_provider TEXT;
BEGIN
  new_tenant_id := NEW.id;
  signup_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');

  INSERT INTO public.profiles (
    id, email, first_name, last_name, company_name, tenant_id, created_at, updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name',
             NEW.raw_user_meta_data->>'given_name',
             SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'last_name',
             NEW.raw_user_meta_data->>'family_name',
             ''),
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    new_tenant_id,
    NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IS NOT NULL AND POSITION('@' IN NEW.email) > 0 THEN
    email_domain := LOWER(SPLIT_PART(NEW.email, '@', 2));

    SELECT ced.tenant_id, ced.default_access_level
      INTO matched_tenant_id, matched_access_level
    FROM public.company_email_domains ced
    WHERE ced.domain = email_domain
    LIMIT 1;

    IF matched_tenant_id IS NOT NULL THEN
      INSERT INTO public.user_company_access (
        user_id, tenant_id, access_level, is_active, granted_at
      ) VALUES (
        NEW.id, matched_tenant_id, COALESCE(matched_access_level, 'member'), true, NOW()
      )
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET is_active = true, updated_at = NOW();

      UPDATE public.profiles SET tenant_id = matched_tenant_id, updated_at = NOW()
      WHERE id = NEW.id;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.demo_requests WHERE LOWER(email) = LOWER(NEW.email)) THEN
        INSERT INTO public.demo_requests (
          first_name, last_name, email, company_name, message, status, notes, created_at
        ) VALUES (
          COALESCE(NEW.raw_user_meta_data->>'first_name',
                   NEW.raw_user_meta_data->>'given_name',
                   SPLIT_PART(NEW.email, '@', 1)),
          COALESCE(NEW.raw_user_meta_data->>'last_name',
                   NEW.raw_user_meta_data->>'family_name',
                   ''),
          NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'company_name', 'Unknown (' || signup_provider || ' signup)'),
          'Auto-created from ' || signup_provider || ' signup. No matching company email domain found.',
          'new',
          'Auto-generated by signup trigger. Provider: ' || signup_provider || '. Email domain: ' || email_domain,
          NOW()
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user error for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;