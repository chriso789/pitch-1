-- ABC catalog mapping cleanup (retry).
-- template_items has no `item_code` column, so we only require: no real
-- ABC catalog payload AND no approval on the mapping. Anything that meets
-- both is not a real ABC mapping — reset it so the UI shows "Needs ABC Match".

UPDATE public.template_item_supplier_mappings m
SET
  supplier_item_number = NULL,
  supplier_item_code = NULL,
  supplier_product_id = NULL,
  supplier_description = NULL,
  supplier_item_description = NULL,
  color_name = NULL,
  valid_uoms = ARRAY[]::text[],
  default_uom = NULL,
  availability_status = NULL,
  raw_catalog_payload = NULL,
  mapping_status = 'needs_review',
  review_state = 'needs_review',
  approved_at = NULL,
  approved_by = NULL,
  last_checked_at = NULL,
  updated_at = NOW()
WHERE m.supplier = 'abc'
  AND m.raw_catalog_payload IS NULL
  AND m.approved_at IS NULL
  AND m.supplier_item_number IS NOT NULL;

-- materials.supplier_sku: earlier auto-linker copied materials.code into
-- materials.supplier_sku for many rows. Wipe those unless a real ABC catalog
-- snapshot is stored inside attributes.supplier_mappings.abc.raw_catalog_payload.
UPDATE public.materials m
SET
  supplier_sku = NULL,
  updated_at = NOW()
WHERE m.supplier_sku IS NOT NULL
  AND upper(m.supplier_sku) = upper(m.code)
  AND (
    m.attributes IS NULL
    OR m.attributes->'supplier_mappings' IS NULL
    OR m.attributes->'supplier_mappings'->'abc' IS NULL
    OR (m.attributes->'supplier_mappings'->'abc'->>'raw_catalog_payload') IS NULL
  );

NOTIFY pgrst, 'reload schema';
