-- Fix stored profit values for estimate OBR-00036
-- The actual_profit fields should reflect gross profit (before commission), not net profit after commission
UPDATE enhanced_estimates
SET 
  actual_profit_amount = selling_price - material_cost - labor_cost - overhead_amount,
  actual_profit_percent = ROUND(
    ((selling_price - material_cost - labor_cost - overhead_amount) / NULLIF(selling_price, 0)) * 100, 
    2
  )
WHERE id = '1edd9e21-2456-422e-bab0-bf1faed1e008';