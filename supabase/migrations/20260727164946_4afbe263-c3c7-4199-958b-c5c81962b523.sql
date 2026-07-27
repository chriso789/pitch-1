-- Phase A: make abc_catalog_items provenance-bearing and tenant/connection scoped.
-- Table is empty today, so the PK swap is safe.

ALTER TABLE public.abc_catalog_items DROP CONSTRAINT IF EXISTS abc_catalog_items_pkey;

ALTER TABLE public.abc_catalog_items
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS connection_id uuid,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS branch_number text,
  ADD COLUMN IF NOT EXISTS branch_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS branch_validated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS branch_validation_note text,
  ADD COLUMN IF NOT EXISTS manufacturer text,
  ADD COLUMN IF NOT EXISTS product_line text,
  ADD COLUMN IF NOT EXISTS product_line_code text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS product_category text,
  ADD COLUMN IF NOT EXISTS product_group text,
  ADD COLUMN IF NOT EXISTS is_hip_and_ridge boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_field_shingle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_accessory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_item_number text,
  ADD COLUMN IF NOT EXISTS is_family_parent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orderable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS catalog_source text NOT NULL DEFAULT 'abc_product_search',
  ADD COLUMN IF NOT EXISTS raw_fingerprint text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.abc_catalog_items ADD CONSTRAINT abc_catalog_items_pkey PRIMARY KEY (id);

ALTER TABLE public.abc_catalog_items
  ADD CONSTRAINT abc_catalog_items_environment_chk CHECK (environment IN ('sandbox','staging','production'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_abc_catalog_items_identity
  ON public.abc_catalog_items (tenant_id, environment, COALESCE(branch_number, ''), item_number);

CREATE INDEX IF NOT EXISTS idx_abc_catalog_items_tenant_env
  ON public.abc_catalog_items (tenant_id, environment, is_active);

CREATE INDEX IF NOT EXISTS idx_abc_catalog_items_identity_lookup
  ON public.abc_catalog_items (tenant_id, environment, manufacturer, product_line, color_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abc_catalog_items TO authenticated;
GRANT ALL ON public.abc_catalog_items TO service_role;

ALTER TABLE public.abc_catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS abc_catalog_items_read_all_auth ON public.abc_catalog_items;

CREATE POLICY "Tenant members manage abc catalog items"
  ON public.abc_catalog_items
  FOR ALL
  TO authenticated
  USING (tenant_id = ANY (get_user_tenant_ids(auth.uid())))
  WITH CHECK (tenant_id = ANY (get_user_tenant_ids(auth.uid())));