-- Add pay_type, hourly_rate, and phone columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS pay_type TEXT DEFAULT 'commission' CHECK (pay_type IN ('hourly', 'commission')),
ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC,
ADD COLUMN IF NOT EXISTS phone TEXT;

-- Add 'owner' to app_role enum if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'owner' AND enumtypid = 'app_role'::regtype) THEN
    ALTER TYPE app_role ADD VALUE 'owner' BEFORE 'corporate';
  END IF;
END$$;