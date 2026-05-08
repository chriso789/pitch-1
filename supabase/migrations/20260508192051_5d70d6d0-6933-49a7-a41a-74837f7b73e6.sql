CREATE OR REPLACE FUNCTION public.check_contact_duplicate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Skip on UPDATE if the duplicate-defining fields didn't change
  IF TG_OP = 'UPDATE'
     AND lower(trim(coalesce(NEW.first_name,''))) = lower(trim(coalesce(OLD.first_name,'')))
     AND lower(trim(coalesce(NEW.last_name,'')))  = lower(trim(coalesce(OLD.last_name,'')))
     AND normalize_street(coalesce(NEW.address_street,'')) = normalize_street(coalesce(OLD.address_street,''))
     AND coalesce(NEW.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(OLD.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  THEN
    RETURN NEW;
  END IF;

  IF NEW.first_name IS NOT NULL AND NEW.address_street IS NOT NULL
     AND NEW.tenant_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.contacts
      WHERE tenant_id = NEW.tenant_id
        AND lower(trim(first_name)) = lower(trim(NEW.first_name))
        AND lower(trim(coalesce(last_name, ''))) = lower(trim(coalesce(NEW.last_name, '')))
        AND normalize_street(address_street) = normalize_street(NEW.address_street)
        AND id != coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND coalesce(is_deleted, false) = false
    ) THEN
      RAISE EXCEPTION 'A contact named "% %" at "%" already exists',
        NEW.first_name, coalesce(NEW.last_name, ''), NEW.address_street;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;