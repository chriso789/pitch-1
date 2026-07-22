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

    return htmlRedirect(returnTo + "connected", "ABC Supply connected. Returning to app…");
  } catch (e) {
    console.error("abc-oauth-callback error:", e);
    return htmlRedirect(
      returnTo + "error&msg=" + encodeURIComponent(String(e)),
      "Unexpected error."
    );
  }
});
