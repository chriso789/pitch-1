-- Link existing template items to their materials by matching name and tenant
UPDATE estimate_calc_template_items ti
SET material_id = m.id
FROM materials m
WHERE ti.material_id IS NULL
  AND ti.item_type = 'material'
  AND LOWER(TRIM(ti.item_name)) = LOWER(TRIM(m.name))
  AND ti.tenant_id = m.tenant_id;