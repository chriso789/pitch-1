
-- =========================================================
-- ABC Supply v2: per-user OAuth connections
-- =========================================================
CREATE TABLE IF NOT EXISTS public.abc_user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  okta_subject TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','expired','revoked','error')),
  last_refresh_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, environment)
);
CREATE INDEX IF NOT EXISTS idx_abc_user_connections_tenant ON public.abc_user_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_abc_user_connections_user ON public.abc_user_connections(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abc_user_connections TO authenticated;
GRANT ALL ON public.abc_user_connections TO service_role;

ALTER TABLE public.abc_user_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abc_user_connections_owner_select"
  ON public.abc_user_connections FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "abc_user_connections_owner_modify"
  ON public.abc_user_connections FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========================================================
-- Ship-To (Job) accounts discovered from ABC
-- =========================================================
CREATE TABLE IF NOT EXISTS public.abc_ship_to_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.abc_user_connections(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  ship_to_number TEXT NOT NULL,
  name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  contacts JSONB DEFAULT '[]'::jsonb,
  raw JSONB,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, ship_to_number)
);
CREATE INDEX IF NOT EXISTS idx_abc_ship_to_tenant ON public.abc_ship_to_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_abc_ship_to_user ON public.abc_ship_to_accounts(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abc_ship_to_accounts TO authenticated;
GRANT ALL ON public.abc_ship_to_accounts TO service_role;

ALTER TABLE public.abc_ship_to_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_ship_to_owner_select"
  ON public.abc_ship_to_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "abc_ship_to_owner_modify"
  ON public.abc_ship_to_accounts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========================================================
-- Branches per ship-to
-- =========================================================
CREATE TABLE IF NOT EXISTS public.abc_account_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_to_id UUID NOT NULL REFERENCES public.abc_ship_to_accounts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  branch_number TEXT NOT NULL,
  name TEXT,
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  is_home_branch BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ship_to_id, branch_number)
);
CREATE INDEX IF NOT EXISTS idx_abc_branches_tenant ON public.abc_account_branches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_abc_branches_user ON public.abc_account_branches(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abc_account_branches TO authenticated;
GRANT ALL ON public.abc_account_branches TO service_role;

ALTER TABLE public.abc_account_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_branches_owner_select"
  ON public.abc_account_branches FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "abc_branches_owner_modify"
  ON public.abc_account_branches FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========================================================
-- Platform-wide ABC catalog (shared)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.abc_catalog_items (
  item_number TEXT PRIMARY KEY,
  item_description TEXT NOT NULL,
  family_id TEXT,
  family_name TEXT,
  color_name TEXT,
  color_code TEXT,
  uoms JSONB DEFAULT '[]'::jsonb,
  stocking_uom TEXT,
  costing_uom TEXT,
  dimensions JSONB,
  specifications JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_dimensional BOOLEAN NOT NULL DEFAULT false,
  last_modified_at TIMESTAMPTZ,
  raw JSONB,
  search_tsv TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abc_catalog_family ON public.abc_catalog_items(family_id);
CREATE INDEX IF NOT EXISTS idx_abc_catalog_active ON public.abc_catalog_items(is_active);
CREATE INDEX IF NOT EXISTS idx_abc_catalog_search ON public.abc_catalog_items USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS idx_abc_catalog_last_modified ON public.abc_catalog_items(last_modified_at);

-- Auto-populate tsvector
CREATE OR REPLACE FUNCTION public.abc_catalog_items_tsv_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.item_number,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.item_description,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.color_name,'')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.family_name,'')), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_abc_catalog_items_tsv ON public.abc_catalog_items;
CREATE TRIGGER trg_abc_catalog_items_tsv
  BEFORE INSERT OR UPDATE ON public.abc_catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.abc_catalog_items_tsv_trigger();

GRANT SELECT ON public.abc_catalog_items TO authenticated;
GRANT ALL ON public.abc_catalog_items TO service_role;

ALTER TABLE public.abc_catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_catalog_items_read_all_auth"
  ON public.abc_catalog_items FOR SELECT TO authenticated USING (true);

-- =========================================================
-- Family members (sibling SKUs for color/variant lookup)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.abc_item_family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id TEXT NOT NULL,
  item_number TEXT NOT NULL,
  item_description TEXT,
  color_name TEXT,
  color_code TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, item_number)
);
CREATE INDEX IF NOT EXISTS idx_abc_family_members_family ON public.abc_item_family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_abc_family_members_item ON public.abc_item_family_members(item_number);

GRANT SELECT ON public.abc_item_family_members TO authenticated;
GRANT ALL ON public.abc_item_family_members TO service_role;

ALTER TABLE public.abc_item_family_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_family_members_read_all_auth"
  ON public.abc_item_family_members FOR SELECT TO authenticated USING (true);

-- =========================================================
-- Tenant-specific material → ABC SKU mapping (color-aware)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.abc_material_sku_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  material_id UUID,
  material_name TEXT,
  color TEXT,
  abc_item_number TEXT NOT NULL,
  abc_uom TEXT,
  preferred_branch_number TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, material_id, color)
);
CREATE INDEX IF NOT EXISTS idx_abc_sku_map_tenant ON public.abc_material_sku_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_abc_sku_map_material ON public.abc_material_sku_mappings(material_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abc_material_sku_mappings TO authenticated;
GRANT ALL ON public.abc_material_sku_mappings TO service_role;

ALTER TABLE public.abc_material_sku_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_sku_map_tenant_select"
  ON public.abc_material_sku_mappings FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid())
      OR tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "abc_sku_map_tenant_modify"
  ON public.abc_material_sku_mappings FOR ALL TO authenticated
  USING (tenant_id IN (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid())
      OR tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid())
           OR tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- =========================================================
-- Pricing cache
-- =========================================================
CREATE TABLE IF NOT EXISTS public.abc_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  ship_to_number TEXT NOT NULL,
  branch_number TEXT NOT NULL,
  item_number TEXT NOT NULL,
  uom TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('estimating','quoting','ordering')),
  unit_price NUMERIC(12,4),
  currency TEXT DEFAULT 'USD',
  price_pending BOOLEAN NOT NULL DEFAULT false,
  raw JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, user_id, ship_to_number, branch_number, item_number, uom, purpose)
);
CREATE INDEX IF NOT EXISTS idx_abc_price_cache_lookup
  ON public.abc_price_cache(tenant_id, ship_to_number, branch_number, item_number);
CREATE INDEX IF NOT EXISTS idx_abc_price_cache_expires
  ON public.abc_price_cache(expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abc_price_cache TO authenticated;
GRANT ALL ON public.abc_price_cache TO service_role;

ALTER TABLE public.abc_price_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_price_cache_owner_select"
  ON public.abc_price_cache FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "abc_price_cache_owner_modify"
  ON public.abc_price_cache FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========================================================
-- Extend estimate_line_items with ABC fields (optional)
-- =========================================================
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS abc_item_number TEXT,
  ADD COLUMN IF NOT EXISTS abc_color TEXT,
  ADD COLUMN IF NOT EXISTS abc_uom TEXT;

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_abc_item
  ON public.estimate_line_items(abc_item_number);

-- =========================================================
-- Reload PostgREST schema cache
-- =========================================================
NOTIFY pgrst, 'reload schema';
