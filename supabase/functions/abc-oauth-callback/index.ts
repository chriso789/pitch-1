// ABC Supply OAuth Authorization Code Flow - CALLBACK
// Exchanges authorization code at Okta /v1/token using HTTP Basic auth + PKCE verifier.
// Stores tokens ENCRYPTED in abc_tokens via abc_tokens_upsert RPC.
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
// Hardcoded canonical redirect URI — must match the one registered with ABC Okta
// and the one used by abc-api-proxy start_oauth.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://alxelfrbjzkmtnsulcei.supabase.co";
const CANONICAL_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/abc-oauth-callback`;

function htmlRedirect(target: string, _message: string) {
  // Use a real HTTP 302 redirect — more reliable than meta/JS redirect
  // (some browsers render the callback body as plain text and never run the script).
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
}

function htmlSuccessPage(environment: string, returnTo: string) {
  const envLabel = environment === "production" ? "Production" : "Sandbox";
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ABC Supply Connected</title>
<style>
  :root { color-scheme: light dark; }
  html,body { margin:0; height:100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#1e40af,#2563eb); color:#fff; padding:24px; }
  .card { background:#fff; color:#0f172a; border-radius:16px; padding:40px 32px; max-width:440px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,.25); text-align:center; }
  .check { width:64px; height:64px; border-radius:50%; background:#16a34a; color:#fff; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-size:34px; font-weight:700; }
  h1 { margin:0 0 8px; font-size:22px; }
  p { margin:6px 0; color:#475569; font-size:15px; line-height:1.5; }
  .env { display:inline-block; margin-top:12px; padding:4px 10px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-size:12px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; }
  .row { margin-top:24px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
  button, a.btn { border:0; border-radius:10px; padding:10px 18px; font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; }
  .primary { background:#2563eb; color:#fff; }
  .ghost { background:#f1f5f9; color:#0f172a; }
  .hint { margin-top:18px; font-size:12px; color:#64748b; }
</style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>ABC Supply Connected</h1>
    <p>Your ABC Supply account is now linked to Pitch CRM.</p>
    <div class="env">${envLabel} environment</div>
    <p style="margin-top:18px;">You can safely close this tab and return to Pitch to verify pricing and place orders.</p>
    <div class="row">
      <button class="primary" onclick="window.close()">Close this tab</button>
      <a class="ghost btn" href="${returnTo}">Return to Pitch</a>
    </div>
    <div class="hint">If the tab doesn't close automatically, close it manually — your connection is saved.</div>
  </div>
  <script>
    try { if (window.opener) { window.opener.postMessage({ type: 'abc-oauth', status: 'connected', environment: ${JSON.stringify(environment)} }, '*'); } } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch(e){} }, 1200);
  </script>
</body>
</html>`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");

  let returnTo = `${APP_BASE}/settings?tab=supplier-connections&supplier=abc&abc=`;


  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ---- Always log the callback hit BEFORE branching ----
  const fullQuery: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) fullQuery[k] = v;
  const userAgent = req.headers.get("user-agent") ?? null;
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    null;

  // Resolve tenant_id / environment from the state row if present (best-effort).
  let preTenantId: string | null = null;
  let preEnvironment: string | null = null;
  if (state) {
    try {
      const { data: sRow } = await supabase
        .from("abc_oauth_states")
        .select("tenant_id, integration_id")
        .eq("state", state)
        .maybeSingle();
      if (sRow) {
        preTenantId = (sRow as any).tenant_id ?? null;
        if ((sRow as any).integration_id) {
          const { data: iRow } = await supabase
            .from("abc_integrations")
            .select("environment")
            .eq("id", (sRow as any).integration_id)
            .maybeSingle();
          preEnvironment = (iRow as any)?.environment ?? null;
        }
      }
    } catch (e) {
      console.error("callback log: state lookup failed", e);
    }
  }

  try {
    await supabase.from("abc_oauth_callback_logs").insert({
      tenant_id: preTenantId,
      environment: preEnvironment,
      state,
      has_code: !!code,
      has_error: !!errParam,
      error: errParam,
      error_description: errDesc,
      full_query: fullQuery,
      user_agent: userAgent,
      ip_address: ipAddress,
    });
  } catch (e) {
    console.error("abc_oauth_callback_logs insert failed", e);
  }

  const setIntegrationError = async (integrationId: string | null, code: string) => {
    if (!integrationId) return;
    try {
      await supabase
        .from("abc_integrations")
        .update({ status: "error", last_error: code })
        .eq("id", integrationId);
    } catch (e) {
      console.error("abc_integrations last_error update failed", e);
    }
  };

  if (errParam) {
    return htmlRedirect(
      returnTo + "error&msg=" + encodeURIComponent(errDesc || errParam),
      `ABC returned error: ${errDesc || errParam}`
    );
  }
  if (!code) {
    return htmlRedirect(returnTo + "error&msg=missing_code", "Missing authorization code.");
  }
  if (!state) {
    return htmlRedirect(returnTo + "error&msg=missing_state", "Missing state parameter.");
  }



  try {
    const { data: stateRow, error: stateErr } = await supabase
      .from("abc_oauth_states")
      .select("*")
      .eq("state", state)
      .maybeSingle();
    if (stateErr || !stateRow) {
      // Best-effort: tag any error on the tenant's integrations.
      if (preTenantId) {
        const { data: ints } = await supabase
          .from("abc_integrations")
          .select("id")
          .eq("tenant_id", preTenantId);
        for (const i of ints ?? []) await setIntegrationError(i.id, "invalid_state");
      }
      return htmlRedirect(returnTo + "error&msg=invalid_state", "Invalid or expired state.");
    }

    // If the start_oauth call captured the originating app origin (e.g. preview URL),
    // redirect the user back there instead of the hardcoded production domain.
    // If a same-origin return_path was also captured, land on that exact screen
    // (e.g. /admin/companies?tab=integrations) so the admin returns to the
    // Integrations sheet they launched OAuth from, not a generic settings page.
    const stateOrigin = (stateRow as any).return_origin as string | null | undefined;
    const stateReturnPath = (stateRow as any).return_path as string | null | undefined;
    if (stateOrigin && /^https?:\/\//.test(stateOrigin)) {
      const origin = stateOrigin.replace(/\/$/, "");
      if (stateReturnPath && stateReturnPath.startsWith("/") && !stateReturnPath.startsWith("//")) {
        const sep = stateReturnPath.includes("?") ? "&" : "?";
        returnTo = `${origin}${stateReturnPath}${sep}abc=`;
      } else {
        returnTo = `${origin}/settings?tab=supplier-connections&supplier=abc&abc=`;
      }
    }

    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      await setIntegrationError(stateRow.integration_id, "state_expired");
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
    const encKey = Deno.env.get("ABC_TOKEN_ENC_KEY");
    const tokenUrl = Deno.env.get(`ABC_TOKEN_URL_${envSuffix}`) || DEFAULTS[environment].token_url;

    if (!clientId || !clientSecret) {
      return htmlRedirect(
        returnTo + "error&msg=missing_credentials",
        `ABC_CLIENT_ID_${envSuffix} or ABC_CLIENT_SECRET_${envSuffix} not configured.`
      );
    }
    if (!encKey) {
      return htmlRedirect(
        returnTo + "error&msg=missing_enc_key",
        "ABC_TOKEN_ENC_KEY not configured."
      );
    }

    const basic = btoa(`${clientId}:${clientSecret}`);
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CANONICAL_REDIRECT_URI,
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

    // Store encrypted tokens in abc_tokens
    const { error: tokErr } = await supabase.rpc("abc_tokens_upsert", {
      p_integration_id: integration.id,
      p_tenant_id: integration.tenant_id,
      p_access_token: tokenJson.access_token,
      p_refresh_token: tokenJson.refresh_token ?? null,
      p_token_type: tokenJson.token_type ?? "Bearer",
      p_scope: tokenJson.scope ?? integration.scopes,
      p_access_token_expires_at: expiresAt,
      p_raw: tokenJson,
      p_enc_key: encKey,
    });

    if (tokErr) {
      console.error("abc_tokens_upsert failed:", tokErr);
      await supabase
        .from("abc_integrations")
        .update({ status: "error", last_error: `token_store_failed: ${tokErr.message}`.slice(0, 500) })
        .eq("id", integration.id);
      return htmlRedirect(
        returnTo + "error&msg=" + encodeURIComponent("token_store_failed: " + tokErr.message),
        "Failed to persist token: " + tokErr.message
      );
    }

    // Maintain abc_connections row for status/UX (no plaintext tokens)
    await supabase.from("abc_connections").upsert(
      {
        tenant_id: integration.tenant_id,
        environment,
        access_token: null,
        refresh_token: null,
        token_type: tokenJson.token_type ?? "Bearer",
        scope: tokenJson.scope ?? integration.scopes,
        expires_at: expiresAt,
        refresh_expires_at: null,
        connection_status: "connected",
        connected_by: stateRow.created_by,
        last_validated_at: new Date().toISOString(),
        last_refreshed_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "tenant_id,environment" }
    );

    if (stateRow.created_by) {
      await supabase.from("abc_user_connections").upsert(
        {
          tenant_id: integration.tenant_id,
          user_id: stateRow.created_by,
          environment,
          token_expires_at: expiresAt,
          scopes: String(tokenJson.scope ?? integration.scopes ?? "")
            .split(/\s+/)
            .filter(Boolean),
          status: "connected",
          last_refresh_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "tenant_id,user_id,environment" },
      );
    }

    await supabase
      .from("abc_integrations")
      .update({ status: "connected", last_error: null })
      .eq("id", integration.id);

    await supabase.from("abc_oauth_states").delete().eq("state", state);

    // Auto-hydrate ship-tos + branches immediately after OAuth so the setup
    // wizard has selectable accounts on first paint. Failure here MUST NOT
    // mark OAuth as disconnected — sync_accounts itself writes last_error on
    // the connection row, and the wizard surfaces it from there.
    try {
      const proxyUrl = `${SUPABASE_URL}/functions/v1/abc-api-proxy`;
      const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      // Fire-and-forget; we await briefly but don't block the redirect on a
      // slow ABC response. The wizard polls /accounts when it opens.
      const syncPromise = fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${svcKey}`,
          apikey: svcKey,
        },
        body: JSON.stringify({
          action: "sync_accounts",
          environment,
          tenant_id: integration.tenant_id,
          user_id: stateRow.created_by,
        }),
      })
        .then(async (r) => {
          const txt = await r.text().catch(() => "");
          console.log("abc-oauth-callback sync_accounts", r.status, txt.slice(0, 500));
          if (!r.ok) {
            await supabase
              .from("abc_connections")
              .update({ last_error: `post_oauth_sync_failed_${r.status}`.slice(0, 500) })
              .eq("tenant_id", integration.tenant_id)
              .eq("environment", environment);
          }
        })
        .catch(async (e) => {
          console.error("abc-oauth-callback sync_accounts threw", e);
          await supabase
            .from("abc_connections")
            .update({ last_error: `post_oauth_sync_threw: ${String(e).slice(0, 400)}` })
            .eq("tenant_id", integration.tenant_id)
            .eq("environment", environment);
        });
      // Wait up to 8s so a fast sandbox response populates before the redirect,
      // but fall through if ABC is slow — the wizard will refetch.
      await Promise.race([
        syncPromise,
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    } catch (e) {
      console.error("abc-oauth-callback post-OAuth sync scheduling failed", e);
    }

    return htmlSuccessPage(environment, returnTo + "connected");
  } catch (e) {
    console.error("abc-oauth-callback error:", e);
    return htmlRedirect(
      returnTo + "error&msg=" + encodeURIComponent(String(e)),
      "Unexpected error."
    );
  }
});
