
DROP FUNCTION IF EXISTS public.abc_tokens_upsert(uuid,uuid,text,text,text,text,timestamptz,jsonb);
DROP FUNCTION IF EXISTS public.abc_tokens_get(uuid);

CREATE OR REPLACE FUNCTION public.abc_tokens_upsert(
  p_integration_id uuid,
  p_tenant_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_token_type text,
  p_scope text,
  p_access_token_expires_at timestamptz,
  p_raw jsonb,
  p_enc_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_enc_key IS NULL OR length(p_enc_key) < 16 THEN
    RAISE EXCEPTION 'enc_key missing or too short';
  END IF;

  INSERT INTO public.abc_tokens (
    integration_id, tenant_id,
    access_token_enc, refresh_token_enc,
    token_type, scope,
    access_token_expires_at, raw_token_response, updated_at
  ) VALUES (
    p_integration_id, p_tenant_id,
    pgp_sym_encrypt(p_access_token, p_enc_key),
    CASE WHEN p_refresh_token IS NULL THEN NULL ELSE pgp_sym_encrypt(p_refresh_token, p_enc_key) END,
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
  p_integration_id uuid,
  p_enc_key text
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
BEGIN
  IF p_enc_key IS NULL OR length(p_enc_key) < 16 THEN
    RAISE EXCEPTION 'enc_key missing or too short';
  END IF;

  RETURN QUERY
  SELECT
    pgp_sym_decrypt(t.access_token_enc, p_enc_key)::text,
    CASE WHEN t.refresh_token_enc IS NULL THEN NULL
         ELSE pgp_sym_decrypt(t.refresh_token_enc, p_enc_key)::text END,
    t.token_type,
    t.scope,
    t.access_token_expires_at
  FROM public.abc_tokens t
  WHERE t.integration_id = p_integration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.abc_tokens_upsert(uuid,uuid,text,text,text,text,timestamptz,jsonb,text) FROM public;
REVOKE ALL ON FUNCTION public.abc_tokens_get(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.abc_tokens_upsert(uuid,uuid,text,text,text,text,timestamptz,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.abc_tokens_get(uuid,text) TO service_role;
