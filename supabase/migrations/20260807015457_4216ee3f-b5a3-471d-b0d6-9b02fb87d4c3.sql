
-- 1. Backfill missing project location from the contact behind the pipeline entry
UPDATE public.projects p
SET location_id = c.location_id
FROM public.pipeline_entries pe
JOIN public.contacts c ON c.id = pe.contact_id
WHERE p.pipeline_entry_id = pe.id
  AND p.location_id IS NULL
  AND c.location_id IS NOT NULL;

-- 2. Per tenant+location counter
CREATE TABLE IF NOT EXISTS public.project_number_sequences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID,
  last_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.project_number_sequences TO authenticated;
GRANT ALL ON public.project_number_sequences TO service_role;

ALTER TABLE public.project_number_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view their project number sequences" ON public.project_number_sequences;
CREATE POLICY "Tenant members can view their project number sequences"
ON public.project_number_sequences
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE UNIQUE INDEX IF NOT EXISTS project_number_sequences_tenant_loc_uk
  ON public.project_number_sequences (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

DROP TRIGGER IF EXISTS update_project_number_sequences_updated_at ON public.project_number_sequences;
CREATE TRIGGER update_project_number_sequences_updated_at
BEFORE UPDATE ON public.project_number_sequences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Location-scoped generator
CREATE OR REPLACE FUNCTION public.generate_project_job_number(_tenant_id uuid, _location_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  loc_code TEXT;
  next_num INTEGER;
BEGIN
  SELECT UPPER(COALESCE(NULLIF(TRIM(location_code), ''), 'XX'))
    INTO loc_code
  FROM public.locations WHERE id = _location_id;

  loc_code := COALESCE(loc_code, 'XX');

  INSERT INTO public.project_number_sequences (tenant_id, location_id, last_number)
  VALUES (_tenant_id, _location_id, 1)
  ON CONFLICT (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET last_number = public.project_number_sequences.last_number + 1,
                updated_at = now()
  RETURNING last_number INTO next_num;

  RETURN loc_code || '-JOB-' || LPAD(next_num::TEXT, 4, '0');
END;
$function$;

-- 4. Trigger uses the tenant + location of the project row
CREATE OR REPLACE FUNCTION public.auto_assign_project_job_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.project_number IS NULL THEN
    NEW.project_number := public.generate_project_job_number(NEW.tenant_id, NEW.location_id);
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_project_number_key;
DROP INDEX IF EXISTS public.projects_project_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_project_number_key
  ON public.projects (tenant_id, project_number);

-- 6. Renumber existing projects per tenant+location by creation order
WITH ranked AS (
  SELECT p.id,
         p.tenant_id,
         p.location_id,
         ROW_NUMBER() OVER (
           PARTITION BY p.tenant_id, COALESCE(p.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
           ORDER BY p.created_at, p.id
         ) AS rn,
         UPPER(COALESCE(NULLIF(TRIM(l.location_code), ''), 'XX')) AS loc_code
  FROM public.projects p
  LEFT JOIN public.locations l ON l.id = p.location_id
)
UPDATE public.projects p
SET project_number = r.loc_code || '-JOB-' || LPAD(r.rn::TEXT, 4, '0')
FROM ranked r
WHERE p.id = r.id;

-- 7. Seed the counters so new jobs continue from the highest existing number
INSERT INTO public.project_number_sequences (tenant_id, location_id, last_number)
SELECT p.tenant_id, p.location_id, COUNT(*)
FROM public.projects p
GROUP BY p.tenant_id, p.location_id
ON CONFLICT (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
DO UPDATE SET last_number = GREATEST(public.project_number_sequences.last_number, EXCLUDED.last_number),
              updated_at = now();

NOTIFY pgrst, 'reload schema';
