CREATE OR REPLACE FUNCTION public.trigger_assign_job_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_number INTEGER;
  v_lead_number INTEGER;
  v_loc_code TEXT;
BEGIN
  IF NEW.job_number IS NULL AND NEW.pipeline_entry_id IS NOT NULL THEN
    NEW.job_number := get_next_job_number(NEW.pipeline_entry_id);
    SELECT c.contact_number, pe.lead_number::INTEGER, l.location_code
      INTO v_contact_number, v_lead_number, v_loc_code
    FROM pipeline_entries pe
    JOIN contacts c ON c.id = pe.contact_id
    LEFT JOIN locations l ON l.id = c.location_id
    WHERE pe.id = NEW.pipeline_entry_id;
    NEW.clj_formatted_number := public.format_clj_number(
      COALESCE(v_loc_code, 'XX'),
      COALESCE(v_contact_number, 0),
      COALESCE(v_lead_number, 0),
      COALESCE(NEW.job_number, 0)
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_assign_contact_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_loc_code TEXT;
BEGIN
  IF NEW.contact_number IS NULL THEN
    NEW.contact_number := get_next_contact_number(NEW.tenant_id);
  END IF;
  SELECT location_code INTO v_loc_code FROM public.locations WHERE id = NEW.location_id;
  NEW.clj_formatted_number := public.format_clj_number(
    COALESCE(v_loc_code, 'XX'),
    COALESCE(NEW.contact_number::INTEGER, 0),
    0,
    0
  );
  RETURN NEW;
END;
$function$;