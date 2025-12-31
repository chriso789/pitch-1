-- First, delete duplicate templates keeping only those with items
WITH template_item_counts AS (
  SELECT 
    t.id,
    t.tenant_id,
    t.name,
    COUNT(i.id) as item_count,
    ROW_NUMBER() OVER (
      PARTITION BY t.tenant_id, t.name 
      ORDER BY COUNT(i.id) DESC, t.created_at ASC
    ) as rn
  FROM estimate_calculation_templates t
  LEFT JOIN estimate_calc_template_items i ON i.calc_template_id = t.id
  GROUP BY t.id, t.tenant_id, t.name
)
DELETE FROM estimate_calculation_templates 
WHERE id IN (SELECT id FROM template_item_counts WHERE rn > 1);

-- Add unique constraint to prevent future duplicates
ALTER TABLE estimate_calculation_templates 
ADD CONSTRAINT uq_tenant_calc_template_name UNIQUE (tenant_id, name);

-- Add rep commission fields to enhanced_estimates if they don't exist
ALTER TABLE enhanced_estimates 
ADD COLUMN IF NOT EXISTS fixed_selling_price numeric,
ADD COLUMN IF NOT EXISTS is_fixed_price boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS rep_commission_percent numeric DEFAULT 8,
ADD COLUMN IF NOT EXISTS rep_commission_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS materials_total numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS labor_total numeric DEFAULT 0;