// ABC Supply OAuth Authorization Code Flow - CALLBACK
// ABC redirects the browser here with ?code=...&state=...
// We exchange the code for tokens and persist them, then redirect back to the app.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ABC_TOKEN_URL_STAGING = "https://login-stage.abcsupply.com/oauth2/token";
const ABC_TOKEN_URL_PROD = "https://login.abcsupply.com/oauth2/token";

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

  const returnTo = `${APP_BASE}/settings?tab=integrations&abc=`;

  if (errParam) {
    return htmlRedirect(returnTo + "error&msg=" + encodeURIComponent(errParam), `ABC returned error: ${errParam}`);
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
      return htmlRedirect(returnTo + "error&msg=state_expired", "State expired. Please retry.");
    }

    const { data: integration } = await supabase
      .from("abc_integrations")
      .select("*")
      .eq("id", stateRow.integration_id)
      .single();

    const clientId = Deno.env.get("ABC_CLIENT_ID")!;
    const clientSecret = Deno.env.get("ABC_CLIENT_SECRET");
    const tokenUrl = integration.environment === "production" ? ABC_TOKEN_URL_PROD : ABC_TOKEN_URL_STAGING;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: stateRow.redirect_uri,
      client_id: clientId,
      code_verifier: stateRow.code_verifier,
    });
    if (clientSecret) body.set("client_secret", clientSecret);

    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });

    const tokenJson = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok) {
      console.error("ABC token exchange failed:", tokenResp.status, tokenJson);
      await supabase
        .from("abc_integrations")
        .update({ status: "error", last_error: JSON.stringify(tokenJson).slice(0, 500) })
        .eq("id", integration.id);
      return htmlRedirect(returnTo + "error&msg=token_exchange_failed", "Token exchange failed: " + (tokenJson.error || tokenResp.status));
    }

    const expiresAt = new Date(Date.now() + (tokenJson.expires_in ?? 3600) * 1000).toISOString();
    const refreshExpiresAt = tokenJson.refresh_expires_in
      ? new Date(Date.now() + tokenJson.refresh_expires_in * 1000).toISOString()
      : null;

    await supabase.from("abc_connections").upsert(
      {
        tenant_id: integration.tenant_id,
        environment: integration.environment,
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token ?? null,
        token_type: tokenJson.token_type ?? "Bearer",
        scope: tokenJson.scope ?? integration.scopes,
        expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt,
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
    return htmlRedirect(returnTo + "error&msg=" + encodeURIComponent(String(e)), "Unexpected error.");
  }
});
