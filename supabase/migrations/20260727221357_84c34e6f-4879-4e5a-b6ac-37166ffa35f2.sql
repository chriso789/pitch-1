CREATE TABLE IF NOT EXISTS public.mfr_system_compatibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  field_variant_id UUID NOT NULL REFERENCES public.mfr_product_variants(id) ON DELETE CASCADE,
  field_color_id UUID REFERENCES public.mfr_colors(id) ON DELETE CASCADE,
  companion_variant_id UUID NOT NULL REFERENCES public.mfr_product_variants(id) ON DELETE CASCADE,
  companion_color_id UUID REFERENCES public.mfr_colors(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'hip_ridge',
  evidence_source TEXT NOT NULL DEFAULT 'manufacturer_document',
  evidence_reference TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mfr_system_compat_unique
  ON public.mfr_system_compatibility (
    tenant_id, field_variant_id,
    COALESCE(field_color_id, '00000000-0000-0000-0000-000000000000'::uuid),
    companion_variant_id,
    COALESCE(companion_color_id, '00000000-0000-0000-0000-000000000000'::uuid),
    relationship
  );
CREATE INDEX IF NOT EXISTS mfr_system_compat_tenant_field_idx
  ON public.mfr_system_compatibility (tenant_id, field_variant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mfr_system_compatibility TO authenticated;
GRANT ALL ON public.mfr_system_compatibility TO service_role;

ALTER TABLE public.mfr_system_compatibility ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read compatibility"
  ON public.mfr_system_compatibility FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));
CREATE POLICY "tenant members write compatibility"
  ON public.mfr_system_compatibility FOR ALL TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())))
  WITH CHECK (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE TABLE IF NOT EXISTS public.supplier_po_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  supplier TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT 'PO',
  last_number BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supplier)
);

GRANT SELECT ON public.supplier_po_sequences TO authenticated;
GRANT ALL ON public.supplier_po_sequences TO service_role;

ALTER TABLE public.supplier_po_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read po sequences"
  ON public.supplier_po_sequences FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE OR REPLACE FUNCTION public.next_supplier_po_number(_tenant_id UUID, _supplier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next BIGINT;
  v_prefix TEXT;
BEGIN
  INSERT INTO public.supplier_po_sequences (tenant_id, supplier, prefix, last_number)
  VALUES (_tenant_id, lower(_supplier), 'PO-' || upper(_supplier), 1)
  ON CONFLICT (tenant_id, supplier)
  DO UPDATE SET last_number = public.supplier_po_sequences.last_number + 1,
                updated_at = now()
  RETURNING last_number, prefix INTO v_next, v_prefix;

  RETURN v_prefix || '-' || lpad(v_next::text, 6, '0');
END;
$$;

ALTER TABLE public.supplier_order_submissions
  ADD COLUMN IF NOT EXISTS order_context JSONB,
  ADD COLUMN IF NOT EXISTS stage_results JSONB,
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS compatibility_evidence JSONB,
  ADD COLUMN IF NOT EXISTS preview_generated_by UUID,
  ADD COLUMN IF NOT EXISTS preview_generated_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';