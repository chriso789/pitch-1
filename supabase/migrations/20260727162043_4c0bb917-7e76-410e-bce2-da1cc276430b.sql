-- ============================================================
-- Phase A: canonical product/color identity + supplier mappings
-- ============================================================

-- ---------- enums ----------
DO $$ BEGIN
  CREATE TYPE public.supplier_kind AS ENUM ('abc','srs','qxo','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.supplier_mapping_status AS ENUM ('active','inactive','discontinued','superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.supplier_mapping_source AS ENUM ('api','catalog_import','manual_approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.supplier_mapping_approval AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.supplier_submission_state AS ENUM ('prepared','submitted','accepted','rejected','verified','mismatch','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- shared updated_at trigger ----------
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 1. Manufacturers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mfr_manufacturers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public.get_user_tenant_id(),
  name TEXT NOT NULL,
  code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mfr_manufacturers TO authenticated;
GRANT ALL ON public.mfr_manufacturers TO service_role;
ALTER TABLE public.mfr_manufacturers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage manufacturers"
  ON public.mfr_manufacturers FOR ALL TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())))
  WITH CHECK (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE TRIGGER trg_mfr_manufacturers_updated_at
  BEFORE UPDATE ON public.mfr_manufacturers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ============================================================
-- 2. Product lines
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mfr_product_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public.get_user_tenant_id(),
  manufacturer_id UUID NOT NULL REFERENCES public.mfr_manufacturers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, manufacturer_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mfr_product_lines_tenant ON public.mfr_product_lines (tenant_id, manufacturer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mfr_product_lines TO authenticated;
GRANT ALL ON public.mfr_product_lines TO service_role;
ALTER TABLE public.mfr_product_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage product lines"
  ON public.mfr_product_lines FOR ALL TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())))
  WITH CHECK (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE TRIGGER trg_mfr_product_lines_updated_at
  BEFORE UPDATE ON public.mfr_product_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ============================================================
-- 3. Colors (scoped to a product line)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mfr_colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public.get_user_tenant_id(),
  manufacturer_id UUID NOT NULL REFERENCES public.mfr_manufacturers(id) ON DELETE CASCADE,
  product_line_id UUID NOT NULL REFERENCES public.mfr_product_lines(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,
  manufacturer_color_code TEXT,
  hex_value TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_line_id, canonical_name)
);

CREATE INDEX IF NOT EXISTS idx_mfr_colors_tenant_line ON public.mfr_colors (tenant_id, product_line_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mfr_colors TO authenticated;
GRANT ALL ON public.mfr_colors TO service_role;
ALTER TABLE public.mfr_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage colors"
  ON public.mfr_colors FOR ALL TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())))
  WITH CHECK (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE TRIGGER trg_mfr_colors_updated_at
  BEFORE UPDATE ON public.mfr_colors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ============================================================
-- 4. Product variants (profile / dimensions / packaging / UOM)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mfr_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public.get_user_tenant_id(),
  manufacturer_id UUID NOT NULL REFERENCES public.mfr_manufacturers(id) ON DELETE CASCADE,
  product_line_id UUID NOT NULL REFERENCES public.mfr_product_lines(id) ON DELETE CASCADE,
  material_id UUID,
  variant_name TEXT NOT NULL,
  profile TEXT,
  dimensions TEXT,
  gauge TEXT,
  length_value NUMERIC,
  length_uom TEXT,
  packaging TEXT,
  canonical_uom TEXT NOT NULL,
  requires_color BOOLEAN NOT NULL DEFAULT false,
  is_accessory BOOLEAN NOT NULL DEFAULT false,
  accessory_kind TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at_placeholder BOOLEAN
);

ALTER TABLE public.mfr_product_variants DROP COLUMN IF EXISTS created_at_placeholder;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mfr_product_variant_identity
  ON public.mfr_product_variants (
    tenant_id,
    product_line_id,
    variant_name,
    COALESCE(profile,''),
    COALESCE(dimensions,''),
    COALESCE(packaging,''),
    canonical_uom
  );

CREATE INDEX IF NOT EXISTS idx_mfr_variants_tenant_line ON public.mfr_product_variants (tenant_id, product_line_id);
CREATE INDEX IF NOT EXISTS idx_mfr_variants_material ON public.mfr_product_variants (tenant_id, material_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mfr_product_variants TO authenticated;
GRANT ALL ON public.mfr_product_variants TO service_role;
ALTER TABLE public.mfr_product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage product variants"
  ON public.mfr_product_variants FOR ALL TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())))
  WITH CHECK (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE TRIGGER trg_mfr_product_variants_updated_at
  BEFORE UPDATE ON public.mfr_product_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ============================================================
-- 5. Supplier item mappings (authoritative)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public.get_user_tenant_id(),
  supplier public.supplier_kind NOT NULL,
  supplier_connection_id UUID,
  supplier_account_number TEXT,
  branch_code TEXT,

  variant_id UUID NOT NULL REFERENCES public.mfr_product_variants(id) ON DELETE CASCADE,
  color_id UUID REFERENCES public.mfr_colors(id) ON DELETE RESTRICT,

  supplier_item_number TEXT NOT NULL,
  supplier_catalog_item_id TEXT,
  supplier_description TEXT,
  supplier_color_name TEXT,
  supplier_uom TEXT NOT NULL,

  status public.supplier_mapping_status NOT NULL DEFAULT 'active',
  superseded_by UUID REFERENCES public.supplier_item_mappings(id) ON DELETE SET NULL,
  mapping_source public.supplier_mapping_source NOT NULL,
  approval_state public.supplier_mapping_approval NOT NULL DEFAULT 'pending',
  approved_by UUID,
  approved_at TIMESTAMPTZ,

  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  catalog_fingerprint TEXT,
  catalog_payload JSONB,
  validated_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1,
  notes TEXT,

  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identity: one exact variant+color+uom per supplier connection + branch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_item_mapping_identity
  ON public.supplier_item_mappings (
    tenant_id,
    supplier,
    COALESCE(supplier_connection_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_code, ''),
    variant_id,
    COALESCE(color_id, '00000000-0000-0000-0000-000000000000'::uuid),
    supplier_uom
  );

CREATE INDEX IF NOT EXISTS idx_supplier_item_mappings_lookup
  ON public.supplier_item_mappings (tenant_id, supplier, branch_code, variant_id, color_id);
CREATE INDEX IF NOT EXISTS idx_supplier_item_mappings_item
  ON public.supplier_item_mappings (tenant_id, supplier, supplier_item_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_item_mappings TO authenticated;
GRANT ALL ON public.supplier_item_mappings TO service_role;
ALTER TABLE public.supplier_item_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage supplier item mappings"
  ON public.supplier_item_mappings FOR ALL TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())))
  WITH CHECK (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE TRIGGER trg_supplier_item_mappings_updated_at
  BEFORE UPDATE ON public.supplier_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ============================================================
-- 6. Mapping revision history (server-write only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_item_mapping_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mapping_id UUID NOT NULL REFERENCES public.supplier_item_mappings(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  change_kind TEXT NOT NULL,
  previous_state JSONB,
  next_state JSONB,
  changed_by UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_mapping_revisions_mapping
  ON public.supplier_item_mapping_revisions (tenant_id, mapping_id, revision DESC);

GRANT SELECT ON public.supplier_item_mapping_revisions TO authenticated;
GRANT ALL ON public.supplier_item_mapping_revisions TO service_role;
ALTER TABLE public.supplier_item_mapping_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read mapping revisions"
  ON public.supplier_item_mapping_revisions FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

-- Auto-record revisions
CREATE OR REPLACE FUNCTION public.record_supplier_mapping_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.supplier_item_mapping_revisions
      (tenant_id, mapping_id, revision, change_kind, previous_state, next_state, changed_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.revision, 'created', NULL, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  END IF;

  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    NEW.revision := OLD.revision + 1;
    INSERT INTO public.supplier_item_mapping_revisions
      (tenant_id, mapping_id, revision, change_kind, previous_state, next_state, changed_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.revision, 'updated', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_mapping_revision_ins
  AFTER INSERT ON public.supplier_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.record_supplier_mapping_revision();

CREATE TRIGGER trg_supplier_mapping_revision_upd
  BEFORE UPDATE ON public.supplier_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.record_supplier_mapping_revision();

-- ============================================================
-- 7. Immutable order submission snapshots (server-write only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_order_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  supplier public.supplier_kind NOT NULL,
  supplier_connection_id UUID,
  supplier_account_number TEXT,
  branch_code TEXT,

  project_id UUID,
  estimate_id UUID,
  material_order_id UUID,
  order_version INTEGER NOT NULL DEFAULT 1,

  user_selections JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  mapping_revisions JSONB NOT NULL DEFAULT '[]'::jsonb,

  outbound_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,

  state public.supplier_submission_state NOT NULL DEFAULT 'prepared',
  supplier_response_redacted JSONB,
  supplier_order_id TEXT,
  supplier_request_id TEXT,
  line_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_reason TEXT,
  reconciled_at TIMESTAMPTZ,

  submitted_by UUID,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supplier, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_supplier_order_submissions_project
  ON public.supplier_order_submissions (tenant_id, project_id, created_at DESC);

GRANT SELECT ON public.supplier_order_submissions TO authenticated;
GRANT ALL ON public.supplier_order_submissions TO service_role;
ALTER TABLE public.supplier_order_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read order submissions"
  ON public.supplier_order_submissions FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

NOTIFY pgrst, 'reload schema';