// ABC Supply OAuth Authorization Code Flow - START
// Generates PKCE challenge, stores state, returns ABC authorization URL.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ABC_AUTH_URL_STAGING = "https://login-stage.abcsupply.com/oauth2/authorize";
const ABC_AUTH_URL_PROD = "https://login.abcsupply.com/oauth2/authorize";

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const { tenant_id, environment = "staging" } = await req.json();
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), { status: 400, headers: corsHeaders });
    }

    // Load or create integration row
    let { data: integration } = await supabase
      .from("abc_integrations")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("environment", environment)
      .maybeSingle();

    const clientId = Deno.env.get("ABC_CLIENT_ID");
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/abc-oauth-callback`;
    const scopes = integration?.scopes || Deno.env.get("ABC_SCOPES") || "openid profile email offline_access";

    if (!clientId) {
      return new Response(
        JSON.stringify({ error: "ABC_CLIENT_ID not configured. Add it via Supabase secrets." }),
        { status: 500, headers: corsHeaders }
      );
    }

    if (!integration) {
      const { data: created, error: createErr } = await supabase
        .from("abc_integrations")
        .insert({
          tenant_id,
          environment,
          abc_mode: "oauth_auth_code",
          token_strategy: "auth_code_pkce",
          client_id: clientId,
          redirect_uri: redirectUri,
          scopes,
          status: "pending",
          created_by: user.id,
        })
        .select()
        .single();
      if (createErr) throw createErr;
      integration = created;
    }

    const { verifier, challenge } = await pkce();
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));

    const { error: stateErr } = await supabase.from("abc_oauth_states").insert({
      state,
      tenant_id,
      integration_id: integration.id,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      created_by: user.id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (stateErr) throw stateErr;

    const baseAuth = environment === "production" ? ABC_AUTH_URL_PROD : ABC_AUTH_URL_STAGING;
    const url = new URL(baseAuth);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    return new Response(JSON.stringify({ authorization_url: url.toString(), state, redirect_uri: redirectUri }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("abc-oauth-start error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
