// ABC Supply OAuth Token Refresh
// Refreshes the stored tenant access token using refresh_token + Basic auth.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULTS = {
  sandbox: "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token",
  production: "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token",
};

export async function refreshAbcToken(
  supabase: ReturnType<typeof createClient>,
  tenant_id: string,
  environment: "sandbox" | "production",
): Promise<{ ok: boolean; access_token?: string; error?: string; status?: number }> {
  const { data: conn, error: connErr } = await supabase
    .from("abc_connections")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("environment", environment)
    .maybeSingle();

  if (connErr || !conn) return { ok: false, error: "no_connection" };
  if (!conn.refresh_token) return { ok: false, error: "no_refresh_token" };

  const envSuffix = environment === "production" ? "PRODUCTION" : "SANDBOX";
  const clientId = Deno.env.get(`ABC_CLIENT_ID_${envSuffix}`);
  const clientSecret = Deno.env.get(`ABC_CLIENT_SECRET_${envSuffix}`);
  const tokenUrl = Deno.env.get(`ABC_TOKEN_URL_${envSuffix}`) || DEFAULTS[environment];

  if (!clientId || !clientSecret) return { ok: false, error: "missing_credentials" };

  const basic = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token,
    scope: conn.scope ?? "offline_access",
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form,
  });
  const json = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    await supabase
      .from("abc_connections")
      .update({
        connection_status: "error",
        last_error: `refresh_failed: ${JSON.stringify(json).slice(0, 400)}`,
      })
      .eq("tenant_id", tenant_id)
      .eq("environment", environment);
    return { ok: false, error: json.error_description || json.error || "refresh_failed", status: resp.status };
  }

  const expiresAt = new Date(Date.now() + ((json.expires_in ?? 3600) - 60) * 1000).toISOString();

  await supabase
    .from("abc_connections")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? conn.refresh_token,
      token_type: json.token_type ?? "Bearer",
      scope: json.scope ?? conn.scope,
      expires_at: expiresAt,
      connection_status: "connected",
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("tenant_id", tenant_id)
    .eq("environment", environment);

  return { ok: true, access_token: json.access_token };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const tenant_id: string | undefined = body.tenant_id;
    const environment: "sandbox" | "production" =
      body.environment === "production" ? "production" : "sandbox";

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), { status: 400, headers: corsHeaders });
    }

    const result = await refreshAbcToken(supabase, tenant_id, environment);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("abc-oauth-refresh error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
