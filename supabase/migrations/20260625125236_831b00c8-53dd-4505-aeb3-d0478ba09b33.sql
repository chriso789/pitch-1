
-- Fix: pass location_id so per-location sequence is used
CREATE OR REPLACE FUNCTION public.trigger_assign_contact_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_loc_code TEXT;
BEGIN
  IF NEW.contact_number IS NULL THEN
    NEW.contact_number := get_next_contact_number(NEW.tenant_id, NEW.location_id);
  END IF;
  SELECT location_code INTO v_loc_code FROM public.locations WHERE id = NEW.location_id;
  NEW.clj_formatted_number := public.format_clj_number(
    COALESCE(v_loc_code, 'XX'),
    COALESCE(NEW.contact_number::INTEGER, 0),
    0, 0
  );
  RETURN NEW;
END;
$function$;

-- Same fix on the other duplicate trigger function
CREATE OR REPLACE FUNCTION public.assign_contact_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE loc_code TEXT;
BEGIN
  IF NEW.contact_number IS NULL THEN
    NEW.contact_number := public.get_next_contact_number(NEW.tenant_id, NEW.location_id)::TEXT;
  END IF;
  SELECT location_code INTO loc_code FROM public.locations WHERE id = NEW.location_id;
  NEW.clj_formatted_number := public.format_clj_number(
    COALESCE(loc_code, 'XX'),
    NEW.contact_number::INTEGER,
    0, 0
  );
  RETURN NEW;
END;
$function$;

-- Self-heal: counter must be >= max existing contact_number in that location
CREATE OR REPLACE FUNCTION public.get_next_contact_number(tenant_id_param uuid, location_id_param uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE next_number INTEGER; loc_id UUID; max_existing INTEGER;
BEGIN
  loc_id := location_id_param;
  IF loc_id IS NULL THEN
    SELECT id INTO loc_id FROM public.locations
      WHERE tenant_id = tenant_id_param AND is_primary = true LIMIT 1;
  END IF;

  SELECT COALESCE(MAX(contact_number::INTEGER), 0) INTO max_existing
    FROM public.contacts
    WHERE tenant_id = tenant_id_param
      AND location_id = loc_id
      AND contact_number ~ '^\d+$';

  UPDATE public.locations
     SET contact_sequence_counter = GREATEST(COALESCE(contact_sequence_counter,0), max_existing) + 1
   WHERE id = loc_id
   RETURNING contact_sequence_counter INTO next_number;

  RETURN COALESCE(next_number, max_existing + 1, 1);
END;
$function$;

-- Backfill counters to match existing data for all locations
UPDATE public.locations l
   SET contact_sequence_counter = GREATEST(
     COALESCE(l.contact_sequence_counter, 0),
     COALESCE((SELECT MAX(c.contact_number::INTEGER) FROM public.contacts c
                WHERE c.location_id = l.id AND c.contact_number ~ '^\d+$'), 0)
   );
