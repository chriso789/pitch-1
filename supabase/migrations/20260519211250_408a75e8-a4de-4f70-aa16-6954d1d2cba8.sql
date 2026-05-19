-- 1. Extend vendor_products with auto-learning fields
ALTER TABLE public.vendor_products
  ADD COLUMN IF NOT EXISTS auto_matched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS source_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS last_seen_on_invoice_at timestamptz;

-- 2. Uniqueness for clean upserts
CREATE UNIQUE INDEX IF NOT EXISTS vendor_products_tenant_vendor_product_uniq
  ON public.vendor_products (tenant_id, vendor_id, product_id);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_products_tenant_vendor_sku_uniq
  ON public.vendor_products (tenant_id, vendor_id, lower(vendor_sku))
  WHERE vendor_sku IS NOT NULL AND vendor_sku <> '';

-- 3. Backfill srs_item_code -> vendor_products for SRS vendor per tenant
DO $$
DECLARE
  r record;
  v_srs_vendor uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT tenant_id FROM public.products
    WHERE srs_item_code IS NOT NULL AND srs_item_code <> ''
  LOOP
    SELECT id INTO v_srs_vendor
    FROM public.vendors
    WHERE tenant_id = r.tenant_id
      AND (lower(name) LIKE '%srs%' OR lower(coalesce(code,'')) = 'srs')
    ORDER BY created_at NULLS LAST
    LIMIT 1;

    IF v_srs_vendor IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.vendor_products
      (tenant_id, vendor_id, product_id, vendor_sku, is_active, auto_matched, confidence)
    SELECT p.tenant_id, v_srs_vendor, p.id, p.srs_item_code, true, false, 1.0
    FROM public.products p
    WHERE p.tenant_id = r.tenant_id
      AND p.srs_item_code IS NOT NULL AND p.srs_item_code <> ''
    ON CONFLICT (tenant_id, vendor_id, product_id) DO UPDATE
      SET vendor_sku = EXCLUDED.vendor_sku,
          is_active = true,
          updated_at = now();
  END LOOP;
END $$;

-- 4. Pending suggestions for low-confidence invoice matches
CREATE TABLE IF NOT EXISTS public.pending_sku_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  product_id uuid,
  suggested_vendor_sku text NOT NULL,
  vendor_description text,
  normalized_description text,
  confidence numeric,
  source_invoice_id uuid,
  source_invoice_line_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_sku_suggestions_tenant_idx
  ON public.pending_sku_suggestions (tenant_id, status);

CREATE INDEX IF NOT EXISTS pending_sku_suggestions_product_idx
  ON public.pending_sku_suggestions (product_id) WHERE product_id IS NOT NULL;

ALTER TABLE public.pending_sku_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant members read pending_sku_suggestions"
  ON public.pending_sku_suggestions;
CREATE POLICY "tenant members read pending_sku_suggestions"
  ON public.pending_sku_suggestions
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "tenant members write pending_sku_suggestions"
  ON public.pending_sku_suggestions;
CREATE POLICY "tenant members write pending_sku_suggestions"
  ON public.pending_sku_suggestions
  FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER pending_sku_suggestions_set_updated_at
  BEFORE UPDATE ON public.pending_sku_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();