-- Extend existing template_item_supplier_mappings with canonical fields
ALTER TABLE public.template_item_supplier_mappings
  ADD COLUMN IF NOT EXISTS supplier_item_number text,
  ADD COLUMN IF NOT EXISTS supplier_product_id text,
  ADD COLUMN IF NOT EXISTS supplier_item_description text,
  ADD COLUMN IF NOT EXISTS valid_uoms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_uom text,
  ADD COLUMN IF NOT EXISTS branch_scope text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS account_scope text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ship_to_scope text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS availability_status text,
  ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'unmapped',
  ADD COLUMN IF NOT EXISTS match_confidence numeric,
  ADD COLUMN IF NOT EXISTS match_reason text,
  ADD COLUMN IF NOT EXISTS raw_catalog_payload jsonb,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Allow nulls on legacy supplier_item_code so SRS rows missing productNumber can be saved as needs_review
ALTER TABLE public.template_item_supplier_mappings
  ALTER COLUMN supplier_item_code DROP NOT NULL;

-- Backfill new fields from existing legacy fields
UPDATE public.template_item_supplier_mappings
SET
  supplier_item_number       = COALESCE(supplier_item_number, supplier_item_code),
  supplier_item_description  = COALESCE(supplier_item_description, supplier_description),
  default_uom                = COALESCE(default_uom, uom),
  valid_uoms                 = CASE
                                  WHEN coalesce(array_length(valid_uoms,1),0) = 0 AND uom IS NOT NULL
                                    THEN ARRAY[uom]
                                  ELSE valid_uoms
                                END,
  match_confidence           = COALESCE(match_confidence, confidence),
  match_reason               = COALESCE(match_reason, match_source),
  approved_by                = COALESCE(approved_by, reviewed_by),
  approved_at                = COALESCE(approved_at, reviewed_at),
  mapping_status             = CASE
                                  WHEN mapping_status <> 'unmapped' THEN mapping_status
                                  WHEN review_state = 'approved'       THEN 'approved'
                                  WHEN review_state = 'rejected'       THEN 'rejected'
                                  WHEN review_state = 'needs_attention' THEN 'needs_review'
                                  WHEN review_state = 'unreviewed'     THEN 'unmapped'
                                  ELSE 'unmapped'
                                END;

-- Mapping status CHECK constraint
ALTER TABLE public.template_item_supplier_mappings
  DROP CONSTRAINT IF EXISTS tism_mapping_status_check;
ALTER TABLE public.template_item_supplier_mappings
  ADD CONSTRAINT tism_mapping_status_check
  CHECK (mapping_status IN ('unmapped','auto_matched','needs_review','approved','rejected'));

-- New indexes for status filtering
CREATE INDEX IF NOT EXISTS idx_tism_tenant_supplier_mapping_status
  ON public.template_item_supplier_mappings (tenant_id, supplier, mapping_status);

-- Auto-stamp tenant_id + created_by on insert from the signed-in user
CREATE OR REPLACE FUNCTION public.tism_stamp_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.tenant_id := public.get_user_tenant_id();
  END IF;
  IF NEW.created_by IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tism_stamp_tenant ON public.template_item_supplier_mappings;
CREATE TRIGGER trg_tism_stamp_tenant
  BEFORE INSERT ON public.template_item_supplier_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tism_stamp_tenant();

NOTIFY pgrst, 'reload schema';