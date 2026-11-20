-- Membership check that also honours per-tab company selection (mirrors resolve_request_tenant_id)
CREATE OR REPLACE FUNCTION public.caller_belongs_to_tenant(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _tenant_id IS NOT NULL AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.tenant_id = _tenant_id OR p.role = 'master')
    UNION ALL
    SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid() AND uca.tenant_id = _tenant_id AND uca.is_active = true
  )
$function$;
REVOKE ALL ON FUNCTION public.caller_belongs_to_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_belongs_to_tenant(uuid) TO authenticated, service_role;

-- 1) Server-only: called by backend functions with the service key, or by other SECURITY DEFINER functions/triggers
DO $do$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.add_canvassiq_property(uuid, jsonb, double precision, double precision, text, uuid)',
    'public.api_sync_template_item_to_catalog(uuid, numeric)',
    'public.calculate_enhanced_estimate(uuid)',
    'public.check_rate_limit(uuid, text, integer, integer)',
    'public.emit_domain_event(uuid, text, text, uuid, jsonb, text, text, uuid, uuid)',
    'public.generate_project_job_number(uuid, uuid)',
    'public.get_next_contact_number(uuid, uuid)',
    'public.increment_estimate_views(uuid)',
    'public.log_company_activity(uuid, text, text, text, uuid, jsonb, text)',
    'public.mark_qbo_cache_stale(uuid, text, text[])',
    'public.next_supplier_po_number(uuid, text)',
    'public.recalculate_change_order_totals(uuid)',
    'public.resolve_project_accounting(uuid)',
    'public.rpc_create_or_get_conversation(uuid, uuid, text, uuid)',
    'public.save_referrer_payout_preference(jsonb)',
    'public.try_auto_archive_pipeline_entry(uuid)',
    'public.upsert_sms_template(uuid, text, text, text, text)',
    'public.validate_scope_mapping(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$do$;

-- 2) Template items: caller must belong to the template's company; ids from other templates are refused
CREATE OR REPLACE FUNCTION public.api_template_items_upsert(p_template_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb;
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.templates WHERE id = p_template_id;
  IF v_tenant IS NULL OR (coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
                          AND NOT public.caller_belongs_to_tenant(v_tenant)) THEN
    RAISE EXCEPTION 'Template not found' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    JOIN public.template_items ti ON ti.id = nullif(e->>'id', '')::uuid
    WHERE ti.template_id IS DISTINCT FROM p_template_id
  ) THEN
    RAISE EXCEPTION 'Template item belongs to a different template' USING ERRCODE = '42501';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.template_items(
      id, template_id, item_name, unit, waste_pct, unit_cost, qty_formula, sort_order, active)
    VALUES (
      COALESCE((r->>'id')::uuid, gen_random_uuid()), p_template_id,
      r->>'item_name', r->>'unit',
      COALESCE((r->>'waste_pct')::numeric,0),
      COALESCE((r->>'unit_cost')::numeric,0),
      public.est_sanitize_formula(r->>'qty_formula'),
      COALESCE((r->>'sort_order')::int,0),
      COALESCE((r->>'active')::boolean,true)
    )
    ON CONFLICT (id) DO UPDATE SET
      item_name  = EXCLUDED.item_name,
      unit       = EXCLUDED.unit,
      waste_pct  = EXCLUDED.waste_pct,
      unit_cost  = EXCLUDED.unit_cost,
      qty_formula= EXCLUDED.qty_formula,
      sort_order = EXCLUDED.sort_order,
      active     = EXCLUDED.active,
      updated_at = now()
    WHERE public.template_items.template_id = p_template_id;
  END LOOP;
END$function$;

-- 3) Calc-template catalog linking: caller must belong to the company, and the template must be that company's
CREATE OR REPLACE FUNCTION public.api_bulk_sync_template_items_to_catalog(p_template_id uuid, p_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_item RECORD;
  v_material_id UUID;
  v_code TEXT;
BEGIN
  IF p_tenant_id IS NULL OR (coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
                             AND NOT public.caller_belongs_to_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'Company access required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.estimate_calc_template_items
    WHERE calc_template_id = p_template_id AND tenant_id IS DISTINCT FROM p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Template not found' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.estimate_calc_template_items
    WHERE calc_template_id = p_template_id
      AND tenant_id = p_tenant_id
      AND item_type = 'material'
      AND material_id IS NULL
  LOOP
    v_code := COALESCE(
      NULLIF(v_item.sku_pattern, ''),
      LOWER(REGEXP_REPLACE(v_item.item_name, '[^a-zA-Z0-9]+', '-', 'g'))
    );

    SELECT id INTO v_material_id
    FROM public.materials
    WHERE tenant_id = p_tenant_id
      AND lower(name) = lower(v_item.item_name)
    LIMIT 1;

    IF v_material_id IS NULL THEN
      SELECT id INTO v_material_id
      FROM public.materials
      WHERE tenant_id = p_tenant_id
        AND code = v_code
      LIMIT 1;
    END IF;

    IF v_material_id IS NULL THEN
      BEGIN
        SELECT public.api_upsert_material(
          p_code := v_code,
          p_name := v_item.item_name,
          p_tenant_id := p_tenant_id,
          p_category_id := NULL,
          p_uom := COALESCE(NULLIF(v_item.unit, ''), 'EA'),
          p_base_cost := v_item.unit_cost,
          p_description := v_item.description
        ) INTO v_material_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_material_id
        FROM public.materials
        WHERE tenant_id = p_tenant_id
          AND lower(name) = lower(v_item.item_name)
        LIMIT 1;
      END;
    END IF;

    IF v_material_id IS NOT NULL THEN
      UPDATE public.estimate_calc_template_items
      SET material_id = v_material_id
      WHERE id = v_item.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- 4) Canvass property -> contact: caller must belong to the property's company
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
    COALESCE(v_property.emails[1], NULL),
    COALESCE(v_property.phone_numbers[1], NULL),
    v_property.address->>'street_number' || ' ' || v_property.address->>'street',
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

-- 5) Measurements: signed-in callers can only record measurements as themselves
CREATE OR REPLACE FUNCTION public.insert_measurement(p_property_id uuid, p_source text, p_faces jsonb, p_linear_features jsonb, p_summary jsonb, p_created_by uuid, p_geom_wkt text, p_gps_coordinates jsonb DEFAULT NULL::jsonb, p_analysis_zoom integer DEFAULT 20, p_analysis_image_size jsonb DEFAULT '{"width": 640, "height": 640}'::jsonb)
 RETURNS measurements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_row measurements;
  v_created_by uuid := p_created_by;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF auth.uid() IS NULL OR (p_created_by IS NOT NULL AND p_created_by <> auth.uid()) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    v_created_by := auth.uid();
  END IF;

  INSERT INTO measurements(
    property_id, source, faces, linear_features, summary, created_by,
    geom_geog, gps_coordinates, analysis_zoom, analysis_image_size
  )
  VALUES (
    p_property_id, p_source, p_faces, p_linear_features, p_summary, v_created_by,
    CASE WHEN p_geom_wkt IS NULL THEN NULL ELSE ST_GeogFromText(p_geom_wkt) END,
    p_gps_coordinates, p_analysis_zoom, p_analysis_image_size
  )
  RETURNING * INTO v_new_row;

  RETURN v_new_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.insert_measurement(uuid, text, jsonb, jsonb, jsonb, uuid, text, jsonb, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_measurement(uuid, text, jsonb, jsonb, jsonb, uuid, text, jsonb, integer, jsonb) TO authenticated, service_role;

-- 6) Earlier company checks switch to the membership helper so per-tab company selection keeps working
CREATE OR REPLACE FUNCTION public.generate_presentation_token(p_presentation_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_expires_in interval DEFAULT '7 days'::interval)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token TEXT;
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.presentations WHERE id = p_presentation_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Presentation not found';
  END IF;

  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     AND NOT public.caller_belongs_to_tenant(v_tenant_id) THEN
    RAISE EXCEPTION 'Presentation not found' USING ERRCODE = '42501';
  END IF;

  v_token := encode(gen_random_bytes(32), 'base64');

  INSERT INTO public.presentation_sessions (
    tenant_id, presentation_id, contact_id, status, viewer_metadata
  ) VALUES (
    v_tenant_id, p_presentation_id, p_contact_id, 'pending',
    jsonb_build_object(
      'access_token', v_token,
      'expires_at', (now() + p_expires_in)::text,
      'link_generated_by', auth.uid()
    )
  );

  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_signature_event(p_envelope_id uuid, p_recipient_id uuid, p_event_type text, p_description text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id UUID;
    v_event_id UUID;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM public.signature_envelopes WHERE id = p_envelope_id;

    IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       AND (v_tenant_id IS NULL OR NOT public.caller_belongs_to_tenant(v_tenant_id)) THEN
      RAISE EXCEPTION 'Envelope not found' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.signature_events (
        tenant_id, envelope_id, recipient_id, event_type, event_description, event_metadata
    ) VALUES (
        v_tenant_id, p_envelope_id, p_recipient_id, p_event_type, p_description, p_metadata
    ) RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$function$;