UPDATE public.enhanced_estimates
SET fixed_selling_price = selling_price,
    total_with_tax = selling_price + COALESCE(sales_tax_amount, 0),
    updated_at = now()
WHERE is_fixed_price = true
  AND selling_price IS NOT NULL
  AND selling_price > 0
  AND (
    fixed_selling_price IS DISTINCT FROM selling_price
    OR total_with_tax IS DISTINCT FROM (selling_price + COALESCE(sales_tax_amount, 0))
  );