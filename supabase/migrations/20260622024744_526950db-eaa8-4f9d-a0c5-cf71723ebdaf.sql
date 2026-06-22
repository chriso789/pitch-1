
CREATE TABLE IF NOT EXISTS public.property_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN (
    'contact','company','pipeline_entry','project','order','permit','measurement_request'
  )),
  source_entity_id UUID NOT NULL,
  raw_input TEXT NOT NULL,
  formatted_address TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  locality TEXT,
  administrative_area TEXT,
  postal_code TEXT,
  country_code TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(11,7),
  place_id TEXT,
  validation_status TEXT NOT NULL DEFAULT 'unvalidated' CHECK (validation_status IN (
    'unvalidated','valid','needs_review','invalid','override_accepted'
  )),
  validation_provider TEXT CHECK (validation_provider IS NULL OR validation_provider IN (
    'google_address_validation','manual_override','imported'
  )),
  validation_granularity TEXT,
  geocode_granularity TEXT,
  address_complete BOOLEAN,
  has_inferred_components BOOLEAN,
  has_replaced_components BOOLEAN,
  has_spell_corrected_components BOOLEAN,
  has_unconfirmed_components BOOLEAN,
  missing_component_types TEXT[] DEFAULT '{}',
  unresolved_tokens TEXT[] DEFAULT '{}',
  usps_dpv_confirmation TEXT,
  is_residential BOOLEAN,
  is_po_box BOOLEAN,
  validation_response_id TEXT,
  validation_payload JSONB,
  validated_at TIMESTAMPTZ,
  validated_by UUID,
  override_reason TEXT,
  override_by UUID,
  override_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_addresses TO authenticated;
GRANT ALL ON public.property_addresses TO service_role;

ALTER TABLE public.property_addresses ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS property_addresses_active_unique
  ON public.property_addresses (tenant_id, source_entity_type, source_entity_id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS property_addresses_tenant_idx ON public.property_addresses (tenant_id);
CREATE INDEX IF NOT EXISTS property_addresses_status_idx ON public.property_addresses (tenant_id, validation_status);
CREATE INDEX IF NOT EXISTS property_addresses_entity_idx ON public.property_addresses (source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS property_addresses_place_id_idx ON public.property_addresses (place_id) WHERE place_id IS NOT NULL;

CREATE POLICY "property_addresses_tenant_read"
  ON public.property_addresses FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "property_addresses_tenant_insert"
  ON public.property_addresses FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "property_addresses_tenant_update"
  ON public.property_addresses FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "property_addresses_tenant_delete"
  ON public.property_addresses FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.property_addresses_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS property_addresses_updated_at ON public.property_addresses;
CREATE TRIGGER property_addresses_updated_at
  BEFORE UPDATE ON public.property_addresses
  FOR EACH ROW EXECUTE FUNCTION public.property_addresses_set_updated_at();

CREATE OR REPLACE FUNCTION public.property_addresses_override_role_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service_role bypass
  IF NEW.validation_status = 'override_accepted'
     OR NEW.override_reason IS DISTINCT FROM OLD.override_reason
     OR NEW.override_by IS DISTINCT FROM OLD.override_by THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL OR v_role NOT IN ('master','owner','corporate','office_admin','regional_manager','sales_manager') THEN
      RAISE EXCEPTION 'Address override requires manager/owner/master role (got %)', COALESCE(v_role,'<none>');
    END IF;
    IF NEW.validation_status = 'override_accepted' AND COALESCE(NEW.override_reason,'') = '' THEN
      RAISE EXCEPTION 'Override reason is required for override_accepted status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS property_addresses_override_gate ON public.property_addresses;
CREATE TRIGGER property_addresses_override_gate
  BEFORE UPDATE ON public.property_addresses
  FOR EACH ROW EXECUTE FUNCTION public.property_addresses_override_role_gate();

CREATE TABLE IF NOT EXISTS public.property_address_validation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  property_address_id UUID NOT NULL REFERENCES public.property_addresses(id) ON DELETE CASCADE,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  previous_status TEXT,
  next_status TEXT,
  provider TEXT NOT NULL,
  raw_input TEXT,
  formatted_address TEXT,
  validation_payload JSONB,
  decision_payload JSONB,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.property_address_validation_history TO authenticated;
GRANT ALL ON public.property_address_validation_history TO service_role;

ALTER TABLE public.property_address_validation_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS pavh_tenant_idx ON public.property_address_validation_history (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pavh_address_idx ON public.property_address_validation_history (property_address_id, created_at DESC);

CREATE POLICY "pavh_tenant_read"
  ON public.property_address_validation_history FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "pavh_tenant_insert"
  ON public.property_address_validation_history FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

NOTIFY pgrst, 'reload schema';
