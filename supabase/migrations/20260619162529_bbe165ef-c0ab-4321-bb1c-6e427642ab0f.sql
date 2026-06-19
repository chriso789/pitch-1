
-- 1. Add identity columns to crews so a crew row can map to one auth user (magic-link)
ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE UNIQUE INDEX IF NOT EXISTS crews_user_id_unique
  ON public.crews(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crews_email_lower_idx
  ON public.crews(lower(email));

-- 2. Add crew_id FK to production_order_assignments (keep legacy assigned_to_crew text)
ALTER TABLE public.production_order_assignments
  ADD COLUMN IF NOT EXISTS crew_id uuid REFERENCES public.crews(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS poa_crew_id_idx
  ON public.production_order_assignments(crew_id);

-- 3. Helper: resolve current user's crew id (security definer; RLS-safe)
CREATE OR REPLACE FUNCTION public.current_user_crew_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.crews WHERE user_id = auth.uid() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.current_user_crew_id() TO authenticated;

-- 4. RLS: let a signed-in crew member see their own crew row
DROP POLICY IF EXISTS "Crew can view own crew row" ON public.crews;
CREATE POLICY "Crew can view own crew row"
  ON public.crews FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Allow a crew to claim its own row on first sign-in (matches by email, only when unclaimed)
DROP POLICY IF EXISTS "Crew can claim own row by email" ON public.crews;
CREATE POLICY "Crew can claim own row by email"
  ON public.crews FOR UPDATE
  TO authenticated
  USING (
    user_id IS NULL
    AND email IS NOT NULL
    AND lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  )
  WITH CHECK (
    user_id = auth.uid()
    AND lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );

-- 5. RLS: crews can read labor orders assigned to them
DROP POLICY IF EXISTS "Crew can view own labor orders" ON public.production_order_assignments;
CREATE POLICY "Crew can view own labor orders"
  ON public.production_order_assignments FOR SELECT
  TO authenticated
  USING (
    order_type = 'labor'
    AND crew_id IS NOT NULL
    AND crew_id = public.current_user_crew_id()
  );
