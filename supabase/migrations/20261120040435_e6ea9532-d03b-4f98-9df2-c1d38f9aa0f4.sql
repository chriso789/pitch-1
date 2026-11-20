CREATE OR REPLACE FUNCTION public.sync_canvassiq_property_to_contact(p_property_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_property canvassiq_properties;
  v_contact_id UUID;
  v_first_name TEXT;
  v_last_name TEXT;
BEGIN
  SELECT * INTO v_property FROM canvassiq_properties WHERE id = p_property_id;

  IF v_property.id IS NULL OR (coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
                               AND NOT public.caller_belongs_to_tenant(v_property.tenant_id)) THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = '42501';
  END IF;

  IF v_property.contact_id IS NOT NULL THEN
    RETURN v_property.contact_id;
  END IF;

  IF v_property.owner_name IS NOT NULL THEN
    v_first_name := SPLIT_PART(v_property.owner_name, ' ', 1);
    v_last_name := REGEXP_REPLACE(v_property.owner_name, '^' || v_first_name || '\s*', '');
    IF v_last_name = '' THEN v_last_name := 'Unknown'; END IF;
  ELSE
    v_first_name := 'Property';
    v_last_name := 'Owner';
  END IF;

  INSERT INTO contacts (
    tenant_id, first_name, last_name, email, phone,
    address_street, address_city, address_state, address_zip,
    latitude, longitude, lead_source, notes, created_by
  ) VALUES (
    v_property.tenant_id, v_first_name, v_last_name,
    v_property.emails[1],
    v_property.phone_numbers[1],
    nullif(concat_ws(' ', nullif(v_property.address->>'street_number', ''), nullif(v_property.address->>'street', '')), ''),
    v_property.address->>'city', v_property.address->>'state', v_property.address->>'zip',
    v_property.lat, v_property.lng, 'Door Knock',
    'Created from CanvassIQ property', v_property.created_by
  )
  RETURNING id INTO v_contact_id;

  UPDATE canvassiq_properties SET contact_id = v_contact_id, updated_at = NOW() WHERE id = p_property_id;

  INSERT INTO canvassiq_outbox (tenant_id, event_type, payload)
  VALUES (v_property.tenant_id, 'sync_to_contact', jsonb_build_object('property_id', p_property_id, 'contact_id', v_contact_id));

  RETURN v_contact_id;
END;
$function$;