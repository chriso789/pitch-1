-- Merge invoice-observed Suncoast Roofers Supply items into SRS price list
WITH observed AS (
  SELECT
    COALESCE(NULLIF(TRIM(sku), ''), NULL) AS supplier_sku,
    MAX(description) AS item_description,
    LOWER(TRIM(COALESCE(normalized_description, description, sku))) AS normalized_description,
    MAX(COALESCE(NULLIF(TRIM(unit_of_measure), ''), 'EA')) AS unit_of_measure,
    MIN(unit_price) AS agreed_unit_price
  FROM project_cost_invoice_line_items
  WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
    AND vendor_name ILIKE '%suncoast%'
    AND unit_price IS NOT NULL
    AND unit_price > 0
  GROUP BY 1, 3
)
INSERT INTO supplier_price_list_items (
  company_id, supplier_id, price_list_id,
  supplier_sku, item_description, normalized_description,
  unit_of_measure, agreed_unit_price, metadata
)
SELECT
  '14de934e-7964-4afd-940a-620d2ace125d'::uuid,
  '094b89a5-1932-4396-8e25-4ea2e087b2d8'::uuid,
  '1ce26b91-772e-40e5-903d-677dbadf52f4'::uuid,
  o.supplier_sku,
  COALESCE(o.item_description, o.normalized_description, 'Unknown item'),
  o.normalized_description,
  o.unit_of_measure,
  o.agreed_unit_price,
  jsonb_build_object('merged_from_invoices', true, 'merged_at', now())
FROM observed o
WHERE NOT EXISTS (
  SELECT 1 FROM supplier_price_list_items existing
  WHERE existing.price_list_id = '1ce26b91-772e-40e5-903d-677dbadf52f4'
    AND (
      (o.supplier_sku IS NOT NULL AND LOWER(TRIM(existing.supplier_sku)) = LOWER(TRIM(o.supplier_sku)))
      OR LOWER(TRIM(existing.normalized_description)) = o.normalized_description
    )
);