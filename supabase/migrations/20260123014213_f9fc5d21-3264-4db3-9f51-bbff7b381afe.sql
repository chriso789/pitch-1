-- Bulk catalog all uncataloged template items
-- Step 1: Create TILE category (may already exist from previous attempt)
INSERT INTO material_categories (code, name, description, order_index)
VALUES ('TILE', 'Tile', 'Clay, concrete, and flat tile roofing products', 12)
ON CONFLICT (code) DO NOTHING;

-- Step 2: Deduplicate template items, keeping most recent per (tenant, item_name)
-- Generate unique codes using name hash to avoid conflicts
WITH deduped_items AS (
  SELECT DISTINCT ON (ti.tenant_id, LOWER(TRIM(ti.item_name)))
    ti.tenant_id,
    ti.item_name,
    ti.item_type,
    ti.unit,
    ti.unit_cost,
    ti.coverage_per_unit,
    ti.sku_pattern,
    ti.description,
    -- Generate unique code per tenant+name
    'TMPL-' || UPPER(SUBSTRING(MD5(LOWER(TRIM(ti.item_name)) || ti.tenant_id::text) FROM 1 FOR 8)) AS generated_code,
    -- Category detection
    CASE
      WHEN ti.item_type = 'labor' THEN 'LABOR'
      WHEN LOWER(ti.item_name) LIKE '%tile%' THEN 'TILE'
      WHEN LOWER(ti.item_name) LIKE '%shingle%' THEN 'SHINGLES'
      WHEN LOWER(ti.item_name) LIKE '%underlayment%' OR LOWER(ti.item_name) LIKE '%felt%' OR LOWER(ti.item_name) LIKE '%synthetic%' THEN 'UNDERLAYMENT'
      WHEN LOWER(ti.item_name) LIKE '%ice%water%' OR LOWER(ti.item_name) LIKE '%ice %' OR LOWER(ti.item_name) LIKE '%water shield%' THEN 'ICE_WATER'
      WHEN LOWER(ti.item_name) LIKE '%starter%' THEN 'STARTER'
      WHEN LOWER(ti.item_name) LIKE '%ridge%' OR LOWER(ti.item_name) LIKE '%hip cap%' OR LOWER(ti.item_name) LIKE '%hip %cap%' THEN 'RIDGE_HIP'
      WHEN LOWER(ti.item_name) LIKE '%vent%' OR LOWER(ti.item_name) LIKE '%turbine%' THEN 'VENTILATION'
      WHEN LOWER(ti.item_name) LIKE '%flashing%' OR LOWER(ti.item_name) LIKE '%boot%' OR LOWER(ti.item_name) LIKE '%pipe collar%' THEN 'FLASHING'
      WHEN LOWER(ti.item_name) LIKE '%drip%edge%' OR LOWER(ti.item_name) LIKE '%drip edge%' THEN 'DRIP_EDGE'
      WHEN LOWER(ti.item_name) LIKE '%nail%' OR LOWER(ti.item_name) LIKE '%fastener%' OR LOWER(ti.item_name) LIKE '%screw%' OR LOWER(ti.item_name) LIKE '%staple%' THEN 'FASTENERS'
      WHEN LOWER(ti.item_name) LIKE '%adhesive%' OR LOWER(ti.item_name) LIKE '%sealant%' OR LOWER(ti.item_name) LIKE '%caulk%' OR LOWER(ti.item_name) LIKE '%cement%' THEN 'ACCESSORIES'
      WHEN LOWER(ti.item_name) LIKE '%plywood%' OR LOWER(ti.item_name) LIKE '%osb%' OR LOWER(ti.item_name) LIKE '%decking%' THEN 'ACCESSORIES'
      ELSE 'ACCESSORIES'
    END AS category_code
  FROM estimate_calc_template_items ti
  WHERE ti.material_id IS NULL
    AND ti.tenant_id IS NOT NULL
  ORDER BY ti.tenant_id, LOWER(TRIM(ti.item_name)), ti.updated_at DESC NULLS LAST
)
INSERT INTO materials (code, name, tenant_id, category_id, uom, base_cost, coverage_per_unit, description, supplier_sku)
SELECT 
  di.generated_code,
  di.item_name,
  di.tenant_id,
  mc.id,
  COALESCE(di.unit, 'EA'),
  COALESCE(di.unit_cost, 0),
  di.coverage_per_unit,
  di.description,
  di.sku_pattern
FROM deduped_items di
LEFT JOIN material_categories mc ON mc.code = di.category_code
ON CONFLICT (code, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'))
DO UPDATE SET
  name = EXCLUDED.name,
  base_cost = EXCLUDED.base_cost,
  uom = EXCLUDED.uom,
  updated_at = NOW();

-- Step 3: Link ALL template items to their catalog materials by matching name and tenant
UPDATE estimate_calc_template_items ti
SET material_id = m.id
FROM materials m
WHERE ti.material_id IS NULL
  AND LOWER(TRIM(ti.item_name)) = LOWER(TRIM(m.name))
  AND ti.tenant_id = m.tenant_id;