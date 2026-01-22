-- 1) Drop old constraint
ALTER TABLE public.commission_plans
DROP CONSTRAINT IF EXISTS commission_plans_payment_method_check;

-- 2) Backfill legacy values to new values
UPDATE public.commission_plans
SET payment_method = CASE payment_method
  WHEN 'percentage_selling_price' THEN 'first_check'
  WHEN 'commission_after_costs'   THEN 'final_check'
  ELSE payment_method
END;

-- 3) Fill any nulls (so NOT NULL is safe)
UPDATE public.commission_plans
SET payment_method = 'first_check'
WHERE payment_method IS NULL;

-- 4) Set default + NOT NULL
ALTER TABLE public.commission_plans
ALTER COLUMN payment_method SET DEFAULT 'first_check';

ALTER TABLE public.commission_plans
ALTER COLUMN payment_method SET NOT NULL;

-- 5) Add new constraint with modern values
ALTER TABLE public.commission_plans
ADD CONSTRAINT commission_plans_payment_method_check
CHECK (payment_method IN ('first_check', 'first_and_last_check', 'final_check'));