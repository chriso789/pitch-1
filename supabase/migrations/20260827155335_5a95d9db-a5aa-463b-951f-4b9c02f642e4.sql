
CREATE OR REPLACE FUNCTION public.normalize_address_key(_addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(regexp_replace(split_part(coalesce(_addr,''), ',', 1), '[^a-zA-Z0-9 ]', '', 'g')),
              '\y(street|str)\y', 'st', 'g'
            ),
            '\y(avenue|ave)\y', 'av', 'g'
          ),
          '\y(road|rd)\y|\y(drive|dr)\y|\y(boulevard|blvd)\y|\y(lane|ln)\y|\y(court|ct)\y|\y(place|pl)\y|\y(terrace|ter)\y|\y(circle|cir)\y|\y(highway|hwy)\y|\y(parkway|pkwy)\y|\y(north|n)\y|\y(south|s)\y|\y(east|e)\y|\y(west|w)\y|\y(northeast|ne)\y|\y(northwest|nw)\y|\y(southeast|se)\y|\y(southwest|sw)\y',
          '\1\2\3\4\5\6\7\8\9', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_person_key(_first text, _last text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(regexp_replace(lower(coalesce(_first,'') || coalesce(_last,'')), '[^a-z0-9]', '', 'g'), '');
$$;

CREATE INDEX IF NOT EXISTS idx_contacts_dedupe_keys
  ON public.contacts (
    tenant_id,
    public.normalize_person_key(first_name, last_name),
    public.normalize_address_key(address_street)
  )
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name_key text;
  _addr_key text;
  _existing_id uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  _name_key := public.normalize_person_key(NEW.first_name, NEW.last_name);
  _addr_key := public.normalize_address_key(NEW.address_street);

  IF _name_key IS NULL OR _addr_key IS NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id INTO _existing_id
  FROM public.contacts c
  WHERE c.tenant_id = NEW.tenant_id
    AND c.deleted_at IS NULL
    AND c.id <> NEW.id
    AND public.normalize_person_key(c.first_name, c.last_name) = _name_key
    AND public.normalize_address_key(c.address_street) = _addr_key
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_contact: a contact with this name already exists at this address (existing contact %)', _existing_id
      USING ERRCODE = 'unique_violation',
            HINT = 'Open the existing contact instead of creating a duplicate.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_contact ON public.contacts;
CREATE TRIGGER trg_prevent_duplicate_contact
  BEFORE INSERT OR UPDATE OF first_name, last_name, address_street, deleted_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_contact();
