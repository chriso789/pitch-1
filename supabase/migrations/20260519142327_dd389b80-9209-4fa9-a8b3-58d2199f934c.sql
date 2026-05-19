
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.abc_api_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  action text NOT NULL,
  endpoint text,
  request_body_redacted jsonb,
  status_code int,
  response_body jsonb,
  error_code text,
  duration_ms int,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abc_api_audit_tenant_created
  ON public.abc_api_audit(tenant_id, created_at DESC);

ALTER TABLE public.abc_api_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant admins read abc audit" ON public.abc_api_audit;
CREATE POLICY "tenant admins read abc audit"
  ON public.abc_api_audit
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT p.tenant_id FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('master'::app_role,'owner'::app_role,'corporate'::app_role,'office_admin'::app_role)
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS abc_tokens_integration_uniq
  ON public.abc_tokens(integration_id);

CREATE OR REPLACE FUNCTION public.abc_tokens_upsert(
  p_integration_id uuid,
  p_tenant_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_token_type text,
  p_scope text,
  p_access_token_expires_at timestamptz,
  p_raw jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text := current_setting('app.abc_token_enc_key', true);
BEGIN
  IF k IS NULL OR k = '' THEN
    RAISE EXCEPTION 'abc_token_enc_key not set in session';
  END IF;

  INSERT INTO public.abc_tokens (
    integration_id, tenant_id,
    access_token_enc, refresh_token_enc,
    token_type, scope,
    access_token_expires_at, raw_token_response, updated_at
  ) VALUES (
    p_integration_id, p_tenant_id,
    pgp_sym_encrypt(p_access_token, k),
    CASE WHEN p_refresh_token IS NULL THEN NULL ELSE pgp_sym_encrypt(p_refresh_token, k) END,
    coalesce(p_token_type,'Bearer'), p_scope,
    p_access_token_expires_at, p_raw, now()
  )
  ON CONFLICT (integration_id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    access_token_enc = EXCLUDED.access_token_enc,
    refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, abc_tokens.refresh_token_enc),
    token_type = EXCLUDED.token_type,
    scope = EXCLUDED.scope,
    access_token_expires_at = EXCLUDED.access_token_expires_at,
    raw_token_response = EXCLUDED.raw_token_response,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.abc_tokens_get(
  p_integration_id uuid
) RETURNS TABLE (
  access_token text,
  refresh_token text,
  token_type text,
  scope text,
  access_token_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text := current_setting('app.abc_token_enc_key', true);
BEGIN
  IF k IS NULL OR k = '' THEN
    RAISE EXCEPTION 'abc_token_enc_key not set in session';
  END IF;

  RETURN QUERY
  SELECT
    pgp_sym_decrypt(t.access_token_enc, k)::text,
    CASE WHEN t.refresh_token_enc IS NULL THEN NULL
         ELSE pgp_sym_decrypt(t.refresh_token_enc, k)::text END,
    t.token_type,
    t.scope,
    t.access_token_expires_at
  FROM public.abc_tokens t
  WHERE t.integration_id = p_integration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.abc_tokens_upsert(uuid,uuid,text,text,text,text,timestamptz,jsonb) FROM public;
REVOKE ALL ON FUNCTION public.abc_tokens_get(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.abc_tokens_upsert(uuid,uuid,text,text,text,text,timestamptz,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abc_tokens_get(uuid) TO service_role;
