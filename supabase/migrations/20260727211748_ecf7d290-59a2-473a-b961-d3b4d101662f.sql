-- Supplier persistence hardening: restrict cascades and remove normal hard-delete access.

-- Product line -> manufacturer: block deletion while child identity exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mfr_product_lines_manufacturer_id_fkey'
      AND conrelid = 'public.mfr_product_lines'::regclass
  ) THEN
    ALTER TABLE public.mfr_product_lines DROP CONSTRAINT mfr_product_lines_manufacturer_id_fkey;
  END IF;
END $$;

ALTER TABLE public.mfr_product_lines
  ADD CONSTRAINT mfr_product_lines_manufacturer_id_fkey
  FOREIGN KEY (manufacturer_id)
  REFERENCES public.mfr_manufacturers(id)
  ON DELETE RESTRICT;

-- Colors -> manufacturer/product line: block deletion while color identity exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mfr_colors_manufacturer_id_fkey'
      AND conrelid = 'public.mfr_colors'::regclass
  ) THEN
    ALTER TABLE public.mfr_colors DROP CONSTRAINT mfr_colors_manufacturer_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mfr_colors_product_line_id_fkey'
      AND conrelid = 'public.mfr_colors'::regclass
  ) THEN
    ALTER TABLE public.mfr_colors DROP CONSTRAINT mfr_colors_product_line_id_fkey;
  END IF;
END $$;

ALTER TABLE public.mfr_colors
  ADD CONSTRAINT mfr_colors_manufacturer_id_fkey
  FOREIGN KEY (manufacturer_id)
  REFERENCES public.mfr_manufacturers(id)
  ON DELETE RESTRICT;

ALTER TABLE public.mfr_colors
  ADD CONSTRAINT mfr_colors_product_line_id_fkey
  FOREIGN KEY (product_line_id)
  REFERENCES public.mfr_product_lines(id)
  ON DELETE RESTRICT;

-- Variants -> manufacturer/product line: block deletion while variant identity exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mfr_product_variants_manufacturer_id_fkey'
      AND conrelid = 'public.mfr_product_variants'::regclass
  ) THEN
    ALTER TABLE public.mfr_product_variants DROP CONSTRAINT mfr_product_variants_manufacturer_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mfr_product_variants_product_line_id_fkey'
      AND conrelid = 'public.mfr_product_variants'::regclass
  ) THEN
    ALTER TABLE public.mfr_product_variants DROP CONSTRAINT mfr_product_variants_product_line_id_fkey;
  END IF;
END $$;

ALTER TABLE public.mfr_product_variants
  ADD CONSTRAINT mfr_product_variants_manufacturer_id_fkey
  FOREIGN KEY (manufacturer_id)
  REFERENCES public.mfr_manufacturers(id)
  ON DELETE RESTRICT;

ALTER TABLE public.mfr_product_variants
  ADD CONSTRAINT mfr_product_variants_product_line_id_fkey
  FOREIGN KEY (product_line_id)
  REFERENCES public.mfr_product_lines(id)
  ON DELETE RESTRICT;

-- Supplier mappings -> variant: approved/business mappings survive identity maintenance.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_item_mappings_variant_id_fkey'
      AND conrelid = 'public.supplier_item_mappings'::regclass
  ) THEN
    ALTER TABLE public.supplier_item_mappings DROP CONSTRAINT supplier_item_mappings_variant_id_fkey;
  END IF;
END $$;

ALTER TABLE public.supplier_item_mappings
  ADD CONSTRAINT supplier_item_mappings_variant_id_fkey
  FOREIGN KEY (variant_id)
  REFERENCES public.mfr_product_variants(id)
  ON DELETE RESTRICT;

-- Remove hard-delete access from tenant users; lifecycle is status/approval-state based.
REVOKE DELETE ON public.mfr_manufacturers FROM authenticated;
REVOKE DELETE ON public.mfr_product_lines FROM authenticated;
REVOKE DELETE ON public.mfr_colors FROM authenticated;
REVOKE DELETE ON public.mfr_product_variants FROM authenticated;
REVOKE DELETE ON public.supplier_item_mappings FROM authenticated;
REVOKE DELETE ON public.abc_catalog_items FROM authenticated;
REVOKE DELETE ON public.abc_ship_to_accounts FROM authenticated;
REVOKE DELETE ON public.abc_account_branches FROM authenticated;
REVOKE DELETE ON public.abc_user_connections FROM authenticated;
REVOKE DELETE ON public.abc_connections FROM authenticated;

-- RLS impact: policies remain tenant-scoped. This only removes normal hard-delete paths.
NOTIFY pgrst, 'reload schema';