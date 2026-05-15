// ABC Supply OAuth Authorization Code Flow - CALLBACK
// Exchanges authorization code at Okta /v1/token using HTTP Basic auth + PKCE verifier.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULTS = {
  sandbox: {
    token_url: "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token",
  },
  production: {
    token_url: "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token",
  },
};

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://pitch-crm.ai";

function htmlRedirect(target: string, message: string) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>ABC Supply</title>
     <p style="font:16px system-ui;padding:24px">${message}</p>
     <script>setTimeout(()=>{window.location.replace(${JSON.stringify(target)})},1500)</script>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");

  const returnTo = `${APP_BASE}/settings?tab=integrations&abc=`;

  if (errParam) {
    return htmlRedirect(
      returnTo + "error&msg=" + encodeURIComponent(errDesc || errParam),
      `ABC returned error: ${errDesc || errParam}`
    );
  }
  if (!code || !state) {
    return htmlRedirect(returnTo + "error&msg=missing_code_or_state", "Missing code or state.");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { data: stateRow, error: stateErr } = await supabase
      .from("abc_oauth_states")
      .select("*")
      .eq("state", state)
      .maybeSingle();

    if (stateErr || !stateRow) {
      return htmlRedirect(returnTo + "error&msg=invalid_state", "Invalid or expired state.");
    }
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      await supabase.from("abc_oauth_states").delete().eq("state", state);
      return htmlRedirect(returnTo + "error&msg=state_expired", "State expired. Please retry.");
    }

    const { data: integration, error: intErr } = await supabase
      .from("abc_integrations")
      .select("*")
      .eq("id", stateRow.integration_id)
      .single();
    if (intErr || !integration) {
      return htmlRedirect(returnTo + "error&msg=integration_missing", "Integration row missing.");
    }

    const environment: "sandbox" | "production" =
      integration.environment === "production" ? "production" : "sandbox";
    const envSuffix = environment === "production" ? "PRODUCTION" : "SANDBOX";

    const clientId = Deno.env.get(`ABC_CLIENT_ID_${envSuffix}`);
    const clientSecret = Deno.env.get(`ABC_CLIENT_SECRET_${envSuffix}`);
    const tokenUrl = Deno.env.get(`ABC_TOKEN_URL_${envSuffix}`) || DEFAULTS[environment].token_url;

    if (!clientId || !clientSecret) {
      return htmlRedirect(
        returnTo + "error&msg=missing_credentials",
        `ABC_CLIENT_ID_${envSuffix} or ABC_CLIENT_SECRET_${envSuffix} not configured.`
      );
    }

    const basic = btoa(`${clientId}:${clientSecret}`);
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: stateRow.redirect_uri,
      code_verifier: stateRow.code_verifier,
    });

    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
    });

    const tokenJson = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok) {
      console.error("ABC token exchange failed:", tokenResp.status, tokenJson);
      await supabase
        .from("abc_integrations")
        .update({
          status: "error",
          last_error: JSON.stringify(tokenJson).slice(0, 500),
        })
        .eq("id", integration.id);
      return htmlRedirect(
        returnTo + "error&msg=token_exchange_failed",
        "Token exchange failed: " + (tokenJson.error_description || tokenJson.error || tokenResp.status)
      );
    }

    const expiresAt = new Date(Date.now() + (tokenJson.expires_in ?? 3600) * 1000).toISOString();

    await supabase.from("abc_connections").upsert(
      {
        tenant_id: integration.tenant_id,
        environment,
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token ?? null,
        token_type: tokenJson.token_type ?? "Bearer",
        scope: tokenJson.scope ?? integration.scopes,
        expires_at: expiresAt,
        refresh_expires_at: null,
        connection_status: "connected",
        last_validated_at: new Date().toISOString(),
        last_refreshed_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "tenant_id,environment" }
    );

    await supabase
      .from("abc_integrations")
      .update({ status: "connected", last_error: null })
      .eq("id", integration.id);

    await supabase.from("abc_oauth_states").delete().eq("state", state);

    return htmlRedirect(returnTo + "connected", "ABC Supply connected. Returning to app…");
  } catch (e) {
    console.error("abc-oauth-callback error:", e);
    return htmlRedirect(
      returnTo + "error&msg=" + encodeURIComponent(String(e)),
      "Unexpected error."
    );
  }
});
