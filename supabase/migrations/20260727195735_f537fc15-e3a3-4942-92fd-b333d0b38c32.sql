GRANT SELECT ON public.abc_ship_to_accounts TO authenticated;
GRANT SELECT ON public.abc_account_branches TO authenticated;
GRANT SELECT ON public.abc_user_connections TO authenticated;
GRANT ALL ON public.abc_ship_to_accounts TO service_role;
GRANT ALL ON public.abc_account_branches TO service_role;
GRANT ALL ON public.abc_user_connections TO service_role;