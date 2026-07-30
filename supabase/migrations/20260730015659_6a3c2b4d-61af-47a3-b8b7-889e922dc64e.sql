ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_tier_check;

ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_tier_check
  CHECK (tier = ANY (ARRAY[
    'starter'::text,
    'professional'::text,
    'enterprise'::text,
    'custom'::text,
    'crm'::text,
    'crm_ai'::text,
    'crew_login'::text
  ]));