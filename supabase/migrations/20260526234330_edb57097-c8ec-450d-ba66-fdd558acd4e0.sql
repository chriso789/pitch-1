
-- Add oauth_app_env column to qbo_connections
ALTER TABLE public.qbo_connections
  ADD COLUMN IF NOT EXISTS oauth_app_env text;

-- Backfill from is_sandbox
UPDATE public.qbo_connections
SET oauth_app_env = CASE WHEN is_sandbox THEN 'development' ELSE 'production' END
WHERE oauth_app_env IS NULL;

-- Enforce non-null + check constraint going forward
ALTER TABLE public.qbo_connections
  ALTER COLUMN oauth_app_env SET DEFAULT 'production';

ALTER TABLE public.qbo_connections
  ALTER COLUMN oauth_app_env SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qbo_connections_oauth_app_env_check'
  ) THEN
    ALTER TABLE public.qbo_connections
      ADD CONSTRAINT qbo_connections_oauth_app_env_check
      CHECK (oauth_app_env IN ('development','production'));
  END IF;
END $$;

-- Trigger to keep is_sandbox and oauth_app_env in sync on write
CREATE OR REPLACE FUNCTION public.qbo_connections_sync_env()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- If oauth_app_env changed (or set on insert), align is_sandbox.
  IF TG_OP = 'INSERT' OR NEW.oauth_app_env IS DISTINCT FROM OLD.oauth_app_env THEN
    NEW.is_sandbox := (NEW.oauth_app_env = 'development');
  -- Else if is_sandbox changed, align oauth_app_env.
  ELSIF NEW.is_sandbox IS DISTINCT FROM OLD.is_sandbox THEN
    NEW.oauth_app_env := CASE WHEN NEW.is_sandbox THEN 'development' ELSE 'production' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qbo_connections_sync_env_trg ON public.qbo_connections;
CREATE TRIGGER qbo_connections_sync_env_trg
  BEFORE INSERT OR UPDATE ON public.qbo_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.qbo_connections_sync_env();

-- Short-lived state table to carry requested mode across the OAuth redirect
CREATE TABLE IF NOT EXISTS public.qbo_oauth_state (
  state uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  requested_mode text NOT NULL CHECK (requested_mode IN ('development','production')),
  initiated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_oauth_state TO authenticated;
GRANT ALL ON public.qbo_oauth_state TO service_role;

ALTER TABLE public.qbo_oauth_state ENABLE ROW LEVEL SECURITY;

-- Only service role uses this table from edge functions; deny direct user access
CREATE POLICY "qbo_oauth_state service role only"
  ON public.qbo_oauth_state
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
