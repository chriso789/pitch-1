-- Backfill change_orders totals that were zeroed out by edit/delete recalc
-- using line_total fallback. Recompute material_total, labor_total, cost_impact
-- from the actual quantity * unit_price of each line item.
WITH recalc AS (
  SELECT
    co.id,
    COALESCE(SUM(
      CASE WHEN COALESCE(item->>'kind','material') = 'material'
        THEN COALESCE(NULLIF(item->>'line_total','')::numeric,
                      (COALESCE(NULLIF(item->>'quantity','')::numeric, 1) *
                       COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)))
      ELSE 0 END
    ), 0) AS material_total,
    COALESCE(SUM(
      CASE WHEN item->>'kind' = 'labor'
        THEN COALESCE(NULLIF(item->>'line_total','')::numeric,
                      (COALESCE(NULLIF(item->>'quantity','')::numeric, 1) *
                       COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)))
      ELSE 0 END
    ), 0) AS labor_total
  FROM change_orders co
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(co.line_items->'items', '[]'::jsonb)) AS item
  WHERE jsonb_typeof(co.line_items->'items') = 'array'
  GROUP BY co.id
)
UPDATE change_orders co
SET material_total = recalc.material_total,
    labor_total = recalc.labor_total,
    cost_impact = recalc.material_total + recalc.labor_total
FROM recalc
WHERE co.id = recalc.id
  AND (
    COALESCE(co.material_total, 0) <> recalc.material_total
    OR COALESCE(co.labor_total, 0) <> recalc.labor_total
  );