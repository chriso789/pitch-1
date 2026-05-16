
-- 1) Backfill: close open-ended price lists so each (company, supplier) has non-overlapping windows
WITH ranked AS (
  SELECT
    id,
    company_id,
    supplier_id,
    effective_start_date,
    effective_end_date,
    LEAD(effective_start_date) OVER (
      PARTITION BY company_id, supplier_id
      ORDER BY effective_start_date
    ) AS next_start
  FROM public.supplier_price_lists
)
UPDATE public.supplier_price_lists spl
SET effective_end_date = (r.next_start - INTERVAL '1 day')::date
FROM ranked r
WHERE spl.id = r.id
  AND r.next_start IS NOT NULL
  AND spl.effective_end_date IS NULL;

-- 2) Replace selector: pick the price list whose window covers the invoice date,
--    regardless of 'active' vs 'replaced'. Newer-start wins ties.
CREATE OR REPLACE FUNCTION public.get_active_supplier_price_list(
  p_company_id uuid, p_supplier_id uuid, p_invoice_date date
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  result_id uuid;
BEGIN
  SELECT id INTO result_id
  FROM public.supplier_price_lists
  WHERE company_id = p_company_id
    AND supplier_id = p_supplier_id
    AND status <> 'archived'
    AND effective_start_date <= p_invoice_date
    AND (effective_end_date IS NULL OR effective_end_date >= p_invoice_date)
  ORDER BY effective_start_date DESC
  LIMIT 1;
  RETURN result_id;
END;
$function$;
