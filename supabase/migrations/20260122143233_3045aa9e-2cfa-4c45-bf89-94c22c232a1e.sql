-- Fix misclassified labor items in estimate_calc_template_items table
-- Items like "Steep Charge", "Additional Layers", etc. should be labor, not materials
UPDATE estimate_calc_template_items
SET item_type = 'labor'
WHERE item_type = 'material'
  AND (
    LOWER(item_name) LIKE '%steep%'
    OR LOWER(item_name) LIKE '%additional%layer%'
    OR LOWER(item_name) LIKE '%plywood%' AND LOWER(item_name) LIKE '%remove%'
    OR LOWER(item_name) LIKE '%tear%off%'
    OR LOWER(item_name) LIKE '%cleanup%'
    OR LOWER(item_name) LIKE '%haul%'
    OR LOWER(item_name) LIKE '%install%'
    OR LOWER(item_name) LIKE '%repair%'
    OR LOWER(sku_pattern) LIKE 'labor-%'
  );

-- Fix line_items JSONB in enhanced_estimates
-- Move misclassified items from materials array to labor array
WITH labor_keywords AS (
  SELECT ARRAY['steep', 'additional layer', 'tear off', 'cleanup', 'haul', 'install', 'repair', 'plywood remove'] AS terms
),
estimates_to_fix AS (
  SELECT 
    ee.id,
    ee.line_items,
    (
      SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
      FROM jsonb_array_elements(ee.line_items->'materials') item
      WHERE NOT (
        LOWER(item->>'item_name') LIKE '%steep%'
        OR LOWER(item->>'item_name') LIKE '%additional%layer%'
        OR LOWER(item->>'item_name') LIKE '%tear%off%'
        OR LOWER(item->>'item_name') LIKE '%cleanup%'
        OR LOWER(item->>'item_name') LIKE '%haul%'
        OR LOWER(item->>'item_name') LIKE '%plywood%remove%'
      )
    ) AS filtered_materials,
    (
      SELECT COALESCE(jsonb_agg(
        item || jsonb_build_object('item_type', 'labor')
      ), '[]'::jsonb)
      FROM jsonb_array_elements(ee.line_items->'materials') item
      WHERE (
        LOWER(item->>'item_name') LIKE '%steep%'
        OR LOWER(item->>'item_name') LIKE '%additional%layer%'
        OR LOWER(item->>'item_name') LIKE '%tear%off%'
        OR LOWER(item->>'item_name') LIKE '%cleanup%'
        OR LOWER(item->>'item_name') LIKE '%haul%'
        OR LOWER(item->>'item_name') LIKE '%plywood%remove%'
      )
    ) AS moved_to_labor
  FROM enhanced_estimates ee
  WHERE ee.line_items IS NOT NULL
    AND ee.line_items->'materials' IS NOT NULL
)
UPDATE enhanced_estimates ee
SET line_items = jsonb_build_object(
  'materials', etf.filtered_materials,
  'labor', COALESCE(ee.line_items->'labor', '[]'::jsonb) || etf.moved_to_labor
)
FROM estimates_to_fix etf
WHERE ee.id = etf.id
  AND jsonb_array_length(etf.moved_to_labor) > 0;