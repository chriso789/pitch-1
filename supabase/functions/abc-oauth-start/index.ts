// ABC Supply OAuth Authorization Code Flow - START (PKCE + Basic auth at /token)
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULTS = {
  sandbox: {
    auth_url: "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/authorize",
  },
  production: {
    auth_url: "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/authorize",
  },
};
const DEFAULT_SCOPES =
  "pricing.read order.read order.write product.read account.read location.read notification.read notification.write offline_access";

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

    const body = await req.json().catch(() => ({}));
    const tenant_id: string | undefined = body.tenant_id;
    const environment: "sandbox" | "production" = body.environment === "production" ? "production" : "sandbox";
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), { status: 400, headers: corsHeaders });
    }

    const envSuffix = environment === "production" ? "PRODUCTION" : "SANDBOX";
    const clientId = Deno.env.get(`ABC_CLIENT_ID_${envSuffix}`);
    const authUrl = Deno.env.get(`ABC_AUTHORIZATION_URL_${envSuffix}`) || DEFAULTS[environment].auth_url;
    const redirectUri =
      Deno.env.get("ABC_REDIRECT_URI") ||
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/abc-oauth-callback`;
    const scopes = Deno.env.get("ABC_SCOPES") || DEFAULT_SCOPES;

    if (!clientId) {
      return new Response(
        JSON.stringify({ error: `ABC_CLIENT_ID_${envSuffix} not configured.` }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Upsert integration row for this tenant+environment
    let { data: integration } = await supabase
      .from("abc_integrations")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("environment", environment)
      .maybeSingle();

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
    } else {
      await supabase
        .from("abc_integrations")
        .update({ client_id: clientId, redirect_uri: redirectUri, scopes, status: "pending" })
        .eq("id", integration.id);
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

    const url = new URL(authUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    return new Response(
      JSON.stringify({ authorization_url: url.toString(), state, redirect_uri: redirectUri, environment }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("abc-oauth-start error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
