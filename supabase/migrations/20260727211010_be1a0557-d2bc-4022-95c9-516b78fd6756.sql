-- Protect ABC account/branch evidence from connection refresh/reconnect cascades.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'abc_ship_to_accounts_connection_id_fkey'
      AND conrelid = 'public.abc_ship_to_accounts'::regclass
  ) THEN
    ALTER TABLE public.abc_ship_to_accounts
      DROP CONSTRAINT abc_ship_to_accounts_connection_id_fkey;
  END IF;
END $$;

ALTER TABLE public.abc_ship_to_accounts
  ADD CONSTRAINT abc_ship_to_accounts_connection_id_fkey
  FOREIGN KEY (connection_id)
  REFERENCES public.abc_user_connections(id)
  ON DELETE RESTRICT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'abc_account_branches_ship_to_id_fkey'
      AND conrelid = 'public.abc_account_branches'::regclass
  ) THEN
    ALTER TABLE public.abc_account_branches
      DROP CONSTRAINT abc_account_branches_ship_to_id_fkey;
  END IF;
END $$;

ALTER TABLE public.abc_account_branches
  ADD CONSTRAINT abc_account_branches_ship_to_id_fkey
  FOREIGN KEY (ship_to_id)
  REFERENCES public.abc_ship_to_accounts(id)
  ON DELETE RESTRICT;

-- RLS impact: no policy changes. These rows remain tenant/user-scoped as before.
NOTIFY pgrst, 'reload schema';