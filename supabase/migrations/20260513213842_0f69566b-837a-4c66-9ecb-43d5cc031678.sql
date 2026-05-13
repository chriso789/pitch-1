INSERT INTO public.materials (tenant_id, code, name, description, uom, base_cost, supplier_sku, active)
SELECT DISTINCT ON (spli.company_id, lower(spli.item_description))
  spli.company_id AS tenant_id,
  'SPLI-' || spli.id::text AS code,
  spli.item_description AS name,
  spli.item_description AS description,
  COALESCE(NULLIF(spli.unit_of_measure, ''), 'ea') AS uom,
  spli.agreed_unit_price AS base_cost,
  spli.supplier_sku,
  TRUE AS active
FROM public.supplier_price_list_items spli
WHERE spli.company_id IS NOT NULL
  AND spli.item_description IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.materials m
    WHERE m.tenant_id = spli.company_id
      AND lower(m.name) = lower(spli.item_description)
  )
ORDER BY spli.company_id, lower(spli.item_description), spli.created_at DESC;