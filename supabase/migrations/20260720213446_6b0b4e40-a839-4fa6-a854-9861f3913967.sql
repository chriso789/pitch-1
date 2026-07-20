
DROP POLICY IF EXISTS "Users insert own acceptances" ON public.legal_acceptances;
CREATE POLICY "Users insert own acceptances" ON public.legal_acceptances
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      tenant_id = get_user_tenant_id(auth.uid())
      OR has_role(auth.uid(), 'master'::app_role)
    )
  );

DROP POLICY IF EXISTS "Users insert own integration consents" ON public.integration_consents;
CREATE POLICY "Users insert own integration consents" ON public.integration_consents
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      tenant_id = get_user_tenant_id(auth.uid())
      OR has_role(auth.uid(), 'master'::app_role)
    )
  );
