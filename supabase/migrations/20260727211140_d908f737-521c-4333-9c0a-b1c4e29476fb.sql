-- ABC account/branch rows are tenant supplier setup data, not private per-user state.
-- Keep existing owner policies, add tenant-member read policies so reconnects or
-- user changes do not make saved Ship-Tos/branches appear missing.

DROP POLICY IF EXISTS "tenant members can read abc ship-to accounts" ON public.abc_ship_to_accounts;
CREATE POLICY "tenant members can read abc ship-to accounts"
  ON public.abc_ship_to_accounts
  FOR SELECT
  TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

DROP POLICY IF EXISTS "tenant members can read abc account branches" ON public.abc_account_branches;
CREATE POLICY "tenant members can read abc account branches"
  ON public.abc_account_branches
  FOR SELECT
  TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

-- RLS impact: widens read visibility only to users who already belong to the same tenant.
NOTIFY pgrst, 'reload schema';