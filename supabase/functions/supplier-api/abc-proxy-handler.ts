// ABC Supply API proxy — per-tenant OAuth (auth_code + PKCE), tokens stored
// ENCRYPTED in abc_tokens via SECURITY DEFINER RPC. Auto-refreshes when expired.
// Endpoints used (correct ABC paths):
//   POST {apiBase}/order/v2/orders                  - place order (JSON ARRAY body)
//   GET  {apiBase}/order/v2/orders?confirmationNumber=...
//   GET  {apiBase}/order/v2/orders/{orderNumber}
//   POST {apiBase}/pricing/v2/prices                - price items
//   GET  {apiBase}/location/v1/branches             - list branches
//   GET  {apiBase}/location/v1/branches/{branchNumber}
//   POST {apiBase}/product/v1/search/items          - product search
//   GET  {apiBase}/product/v1/items/{itemNumber}    - get item
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ABC = {
  sandbox: {
    tokenUrl: "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token",
    metaUrl: "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/.well-known/oauth-authorization-server",
    apiBase: "https://partners-sb.abcsupply.com/api",
  },
  production: {
    tokenUrl: "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token",
    metaUrl: "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/.well-known/oauth-authorization-server",
    apiBase: "https://partners.abcsupply.com/api",
  },
};

type Env = "sandbox" | "production";

const AUTH_URLS: Record<Env, string> = {
  sandbox: "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/authorize",
  production: "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/authorize",
};

const DEFAULT_SCOPES =
  "pricing.read order.read order.write product.read account.read location.read offline_access";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://alxelfrbjzkmtnsulcei.supabase.co";
// Canonical, hardcoded redirect URI — must match ABC Okta app registration
// and the URL handled by abc-oauth-callback.
const CANONICAL_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/abc-oauth-callback`;

function normalizeEnv(env?: string): Env {
  return env === "production" ? "production" : "sandbox";
}

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

/** Map ABC/transport errors to stable codes the UI can act on. */
function mapAbcError(status: number, body: any): string {
  if (status === 0) return "abc_network_error";
  if (status === 400) return "abc_400_bad_payload";
  if (status === 401) return "abc_401_unauthorized";
  if (status === 403) return "abc_403_forbidden";
  if (status === 404) return "abc_404_not_found";
  if (status === 429) return "abc_429_rate_limited";
  if (status >= 500) return "abc_500_upstream";
  const err = (body?.error || body?.code || "").toString().toLowerCase();
  if (err.includes("redirect_uri")) return "invalid_redirect_uri";
  if (err.includes("invalid_client")) return "invalid_client";
  if (err.includes("scope")) return "missing_scope";
  return `abc_${status}`;
}

interface TokenLookup {
  token?: string;
  refresh_token?: string;
  expires_at?: string;
  scope?: string;
  integration_id?: string;
  error?: string;
}

async function refreshAccessToken(
  supabase: ReturnType<typeof createClient>,
  env: Env,
  integration_id: string,
  tenant_id: string,
  refresh_token: string,
  scope: string | undefined,
  encKey: string,
): Promise<TokenLookup> {
  const envSuffix = env === "production" ? "PRODUCTION" : "SANDBOX";
  const clientId = Deno.env.get(`ABC_CLIENT_ID_${envSuffix}`);
  const clientSecret = Deno.env.get(`ABC_CLIENT_SECRET_${envSuffix}`);
  if (!clientId || !clientSecret) return { error: "missing_server_credentials" };

  const basic = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(ABC[env].tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      scope: scope ?? DEFAULT_SCOPES,
    }),
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
      .eq("environment", env);
    return { error: `refresh_failed:${json.error || resp.status}` };
  }
  const newExpires = new Date(Date.now() + ((json.expires_in ?? 3600) - 60) * 1000).toISOString();

  await supabase.rpc("abc_tokens_upsert", {
    p_integration_id: integration_id,
    p_tenant_id: tenant_id,
    p_access_token: json.access_token,
    p_refresh_token: json.refresh_token ?? refresh_token,
    p_token_type: json.token_type ?? "Bearer",
    p_scope: json.scope ?? scope,
    p_access_token_expires_at: newExpires,
    p_raw: json,
    p_enc_key: encKey,
  });

  await supabase
    .from("abc_connections")
    .update({
      expires_at: newExpires,
      connection_status: "connected",
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("tenant_id", tenant_id)
    .eq("environment", env);

  return { token: json.access_token, expires_at: newExpires, scope: json.scope ?? scope, integration_id };
}

async function getValidAccessToken(
  supabase: ReturnType<typeof createClient>,
  tenant_id: string,
  env: Env,
): Promise<TokenLookup> {
  const encKey = Deno.env.get("ABC_TOKEN_ENC_KEY");
  if (!encKey) return { error: "missing_enc_key" };

  const { data: integration } = await supabase
    .from("abc_integrations")
    .select("id, tenant_id, scopes")
    .eq("tenant_id", tenant_id)
    .eq("environment", env)
    .maybeSingle();

  if (!integration) return { error: "not_connected" };

  const { data: rows, error: rpcErr } = await supabase.rpc("abc_tokens_get", {
    p_integration_id: (integration as any).id,
    p_enc_key: encKey,
  });
  if (rpcErr) return { error: `token_read_failed:${rpcErr.message}` };
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.access_token) return { error: "not_connected" };

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) {
    return {
      token: row.access_token,
      refresh_token: row.refresh_token,
      expires_at: row.access_token_expires_at,
      scope: row.scope,
      integration_id: (integration as any).id,
    };
  }

  if (!row.refresh_token) return { error: "expired_no_refresh" };
  return await refreshAccessToken(
    supabase,
    env,
    (integration as any).id,
    tenant_id,
    row.refresh_token,
    row.scope ?? (integration as any).scopes,
    encKey,
  );
}

async function auditCall(
  supabase: ReturnType<typeof createClient>,
  args: {
    tenant_id?: string | null;
    environment: Env;
    action: string;
    endpoint?: string;
    request_body_redacted?: any;
    status_code?: number;
    response_body?: any;
    error_code?: string | null;
    duration_ms?: number;
    created_by?: string | null;
  },
) {
  try {
    await supabase.from("abc_api_audit").insert({
      tenant_id: args.tenant_id ?? null,
      environment: args.environment,
      action: args.action,
      endpoint: args.endpoint ?? null,
      request_body_redacted: args.request_body_redacted ?? null,
      status_code: args.status_code ?? null,
      response_body: args.response_body ?? null,
      error_code: args.error_code ?? null,
      duration_ms: args.duration_ms ?? null,
      created_by: args.created_by ?? null,
    });
  } catch (e) {
    console.error("abc_api_audit insert failed", e);
  }
}

async function callAbc(
  token: string,
  method: "GET" | "POST",
  url: string,
  body?: any,
): Promise<{ status: number; json: any; text: string; ok: boolean }> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: resp.status, json, text, ok: resp.ok };
}

interface ProxyRequest {
  action:
    | "test_connection"
    | "get_status"
    | "start_oauth"
    | "price_items"
    | "get_branches"
    | "get_branch"
    | "search_products"
    | "get_item"
    | "place_order"
    | "submit_order"           // legacy alias for place_order
    | "submit_test_order"
    | "get_order_status";
  environment?: "staging" | "sandbox" | "production";
  tenant_id?: string;
  // pricing
  requestId?: string;
  shipToNumber?: string;
  branchNumber?: string;
  purpose?: string;
  lines?: Array<{ itemNumber: string; quantity: number; unitOfMeasure?: string }>;
  // products
  query?: string;
  itemNumber?: string;
  // branches
  branchCode?: string;
  // orders
  confirmationNumber?: string;
  orderNumber?: string;
  order?: any; // pre-shaped ABC order object
  // legacy submit_order fields (kept for back-compat)
  project_id?: string;
  estimate_id?: string;
  job_number?: string;
  customer_name?: string;
  branch_code?: string;
  delivery_method?: "roof_load" | "ground_drop" | "pickup";
  delivery_date?: string;
  delivery_address?: string;
  notes?: string;
  items?: Array<{
    item_name: string;
    description?: string;
    quantity: number;
    unit?: string;
    unit_cost?: number;
    abc_item_code?: string | null;
    srs_item_code?: string | null;
    color_specs?: string | null;
  }>;
}

export const handle = async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let requestAction: ProxyRequest["action"] | undefined;
  const startedAt = Date.now();

  try {
    const auth = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      auth ? { global: { headers: { Authorization: auth } } } : undefined,
    );

    const body = (await req.json()) as ProxyRequest;
    const action = body.action;
    requestAction = action;
    const env = normalizeEnv(body.environment);
    const cfg = ABC[env];

    // Resolve tenant_id + user from JWT if not provided
    let tenant_id = body.tenant_id;
    let userId: string | null = null;
    if (auth) {
      const { data: userRes } = await authClient.auth.getUser();
      userId = userRes?.user?.id ?? null;
      if (!tenant_id && userId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("id", userId)
          .maybeSingle();
        tenant_id = (prof as any)?.tenant_id ?? undefined;
      }
    }

    console.log("abc-api-proxy", { action, env, tenant_id });

    const json = (data: any, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // ---------------- start_oauth ----------------
    if (action === "start_oauth") {
      const envSuffix = env === "production" ? "PRODUCTION" : "SANDBOX";
      const clientId = Deno.env.get(`ABC_CLIENT_ID_${envSuffix}`);
      const clientSecret = Deno.env.get(`ABC_CLIENT_SECRET_${envSuffix}`);
      const configuredRedirect = Deno.env.get("ABC_REDIRECT_URI");
      const authorizeBaseUrl = Deno.env.get(`ABC_AUTHORIZATION_URL_${envSuffix}`) || AUTH_URLS[env];
      const redirectUri = CANONICAL_REDIRECT_URI;
      const scopes = Deno.env.get("ABC_SCOPES") || DEFAULT_SCOPES;

      // ---- Pre-flight validation ----
      const fail = (
        error_code: string,
        human_message: string,
        missing_env?: string,
        expected_value?: string,
      ) =>
        json({
          success: false,
          error_code,
          human_message,
          missing_env: missing_env ?? null,
          expected_value: expected_value ?? null,
          environment: env,
        });

      if (!auth || !userId) {
        return fail(
          "unauthenticated_user",
          "You must be signed in to start the ABC OAuth flow.",
        );
      }
      if (!tenant_id) {
        return fail(
          "missing_tenant_id",
          "No tenant context for this request. Switch into a company and retry.",
        );
      }
      if (!clientId) {
        return fail(
          "missing_client_id",
          `ABC ${env} OAuth Client ID is not configured on the server.`,
          `ABC_CLIENT_ID_${envSuffix}`,
        );
      }
      if (!clientSecret) {
        return fail(
          "missing_client_secret",
          `ABC ${env} OAuth Client Secret is not configured on the server.`,
          `ABC_CLIENT_SECRET_${envSuffix}`,
        );
      }
      if (configuredRedirect && configuredRedirect.trim() !== CANONICAL_REDIRECT_URI) {
        return fail(
          "redirect_uri_mismatch",
          "ABC_REDIRECT_URI secret does not match the canonical callback URL used by abc-oauth-callback.",
          "ABC_REDIRECT_URI",
          CANONICAL_REDIRECT_URI,
        );
      }

      let { data: integration } = await supabase
        .from("abc_integrations")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("environment", env)
        .maybeSingle();

      if (!integration) {
        const { data: created, error: createErr } = await supabase
          .from("abc_integrations")
          .insert({
            tenant_id,
            environment: env,
            abc_mode: "individual_business",
            token_strategy: "auth_code_pkce",
            client_id: clientId,
            redirect_uri: redirectUri,
            scopes,
            status: "disconnected",
            created_by: userId,
          })
          .select()
          .single();
        if (createErr) throw createErr;
        integration = created;
      } else {
        await supabase
          .from("abc_integrations")
          .update({
            abc_mode: "individual_business",
            token_strategy: "auth_code_pkce",
            client_id: clientId,
            redirect_uri: redirectUri,
            scopes,
            status: "disconnected",
          })
          .eq("id", (integration as any).id);
      }

      const { verifier, challenge } = await pkce();
      const state = b64url(crypto.getRandomValues(new Uint8Array(24)));

      const { error: stateErr } = await supabase.from("abc_oauth_states").insert({
        state,
        tenant_id,
        integration_id: (integration as any).id,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        created_by: userId,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      if (stateErr) throw stateErr;

      const url = new URL(authorizeBaseUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", scopes);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");

      return json({
        success: true,
        authorization_url: url.toString(),
        authorize_base_url: authorizeBaseUrl,
        client_id: clientId,
        redirect_uri: redirectUri,
        scopes,
        state,
        environment: env,
        tenant_id,
        pkce_enabled: true,
        code_challenge_method: "S256",
        instructions:
          "Open authorization_url, log in with the ABC customer test account (e.g. connect_user@test.com), and confirm ABC redirects to abc-oauth-callback with code and state.",
      });
    }


    // ---------------- get_status ----------------
    if (action === "get_status") {
      if (!tenant_id) return json({ connected: false, error: "no_tenant" });
      const { data: conn } = await supabase
        .from("abc_connections")
        .select("connection_status,expires_at,last_refreshed_at,last_validated_at,last_error,scope,environment")
        .eq("tenant_id", tenant_id)
        .eq("environment", env)
        .maybeSingle();
      return json({
        connected: conn?.connection_status === "connected",
        environment: env,
        ...conn,
      });
    }

    // ---------------- test_connection ----------------
    if (action === "test_connection") {
      let metaOk = false;
      let metaStatus = 0;
      try {
        const m = await fetch(cfg.metaUrl);
        metaStatus = m.status;
        metaOk = m.ok;
        await m.text();
      } catch {
        metaOk = false;
      }

      if (!tenant_id) {
        return json({
          success: false,
          environment: env,
          metadata: { ok: metaOk, status: metaStatus, url: cfg.metaUrl },
          interpretation: "No tenant context. Sign in and complete OAuth.",
        });
      }
      const tok = await getValidAccessToken(supabase, tenant_id, env);
      const success = !!tok.token;
      if (success) {
        await supabase
          .from("abc_connections")
          .update({ last_validated_at: new Date().toISOString() })
          .eq("tenant_id", tenant_id)
          .eq("environment", env);
      }
      return json({
        success,
        environment: env,
        metadata: { ok: metaOk, status: metaStatus, url: cfg.metaUrl },
        token: success
          ? { ok: true, expires_at: tok.expires_at }
          : { ok: false, error: tok.error },
        interpretation: success
          ? "Tenant has a valid OAuth token; ABC is reachable."
          : tok.error === "not_connected"
            ? "Tenant has not completed ABC OAuth. Click 'Begin OAuth Authorization'."
            : `Token unavailable: ${tok.error}`,
        timestamp: new Date().toISOString(),
      });
    }

    // ---------------- token-requiring actions: get a token first ----------------
    if (!tenant_id) return json({ success: false, error: "no_tenant_context" }, 400);
    const tok = await getValidAccessToken(supabase, tenant_id, env);
    if (!tok.token) {
      const code = tok.error === "not_connected" ? "not_connected" : "token_expired";
      return json({
        success: false,
        environment: env,
        error: tok.error,
        error_code: code,
        interpretation:
          tok.error === "not_connected"
            ? "Complete ABC OAuth (Begin OAuth Authorization) first."
            : `Cannot obtain token: ${tok.error}`,
      });
    }

    // ---------------- get_branches / get_branch ----------------
    if (action === "get_branches") {
      const endpoint = `${cfg.apiBase}/location/v1/branches`;
      const r = await callAbc(tok.token, "GET", endpoint);
      const error_code = r.ok ? null : mapAbcError(r.status, r.json);
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint,
        status_code: r.status, response_body: r.json ?? r.text, error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      return json({ success: r.ok, environment: env, endpoint, status: r.status, body: r.json ?? r.text, error_code });
    }

    if (action === "get_branch") {
      const bn = (body.branchNumber || body.branchCode || "").toString().trim();
      if (!bn) return json({ success: false, error: "branchNumber required" }, 400);
      const endpoint = `${cfg.apiBase}/location/v1/branches/${encodeURIComponent(bn)}`;
      const r = await callAbc(tok.token, "GET", endpoint);
      const error_code = r.ok ? null : mapAbcError(r.status, r.json);
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint,
        status_code: r.status, response_body: r.json ?? r.text, error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      return json({ success: r.ok, environment: env, endpoint, status: r.status, body: r.json ?? r.text, error_code });
    }

    // ---------------- search_products / get_item ----------------
    if (action === "search_products") {
      // ABC documented body: filters[] + pagination{}.
      const endpoint = `${cfg.apiBase}/product/v1/search/items`;
      const filters: Array<Record<string, unknown>> = [];
      const itemNumber = (body.itemNumber || "").toString().trim();
      const query = (body.query || "").toString().trim();
      if (itemNumber) {
        filters.push({
          key: "itemNumber",
          condition: "equals",
          values: [itemNumber],
          joinCondition: "and",
        });
      } else {
        filters.push({
          key: "itemDescription",
          condition: "contains",
          values: [query],
          joinCondition: "and",
        });
      }
      const branchNumber = (body.branchNumber || "").toString().trim();
      if (branchNumber) {
        filters.push({
          key: "branchNumber",
          condition: "equals",
          values: [branchNumber],
          joinCondition: "and",
        });
      }
      const payload = {
        filters,
        pagination: { itemsPerPage: 10, pageNumber: 1 },
      };
      const r = await callAbc(tok.token, "POST", endpoint, payload);
      const error_code = r.ok ? null : mapAbcError(r.status, r.json);
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint,
        request_body_redacted: payload,
        status_code: r.status, response_body: r.json ?? r.text, error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      return json({ success: r.ok, environment: env, endpoint, request: payload, status: r.status, body: r.json ?? r.text, error_code });
    }

    if (action === "get_item") {
      const itm = (body.itemNumber || "").toString().trim();
      if (!itm) return json({ success: false, error: "itemNumber required" }, 400);
      const endpoint = `${cfg.apiBase}/product/v1/items/${encodeURIComponent(itm)}`;
      const r = await callAbc(tok.token, "GET", endpoint);
      const error_code = r.ok ? null : mapAbcError(r.status, r.json);
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint,
        status_code: r.status, response_body: r.json ?? r.text, error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      return json({ success: r.ok, environment: env, endpoint, status: r.status, body: r.json ?? r.text, error_code });
    }

    // ---------------- price_items ----------------
    if (action === "price_items") {
      const endpoint = `${cfg.apiBase}/pricing/v2/prices`;
      const lines = (body.lines || []).map((l, i) => ({
        id: String(i + 1),
        itemNumber: l.itemNumber,
        quantity: Number(l.quantity) || 1,
        uom: (l.unitOfMeasure || "EA").toUpperCase(),
      }));
      if (!lines.length) return json({ success: false, error: "lines required" }, 400);
      const payload = {
        requestId: body.requestId || `PITCH-PRICE-${Date.now()}`,
        shipToNumber: body.shipToNumber,
        branchNumber: body.branchNumber,
        purpose: body.purpose || "estimating",
        lines,
      };
      const r = await callAbc(tok.token, "POST", endpoint, payload);
      const error_code = r.ok ? null : mapAbcError(r.status, r.json);
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint,
        request_body_redacted: payload,
        status_code: r.status, response_body: r.json ?? r.text, error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      return json({ success: r.ok, environment: env, endpoint, request: payload, status: r.status, body: r.json ?? r.text, error_code });
    }


    // ---------------- get_order_status ----------------
    if (action === "get_order_status") {
      let endpoint = "";
      if (body.orderNumber) {
        endpoint = `${cfg.apiBase}/order/v2/orders/${encodeURIComponent(body.orderNumber)}`;
      } else if (body.confirmationNumber) {
        endpoint = `${cfg.apiBase}/order/v2/orders?confirmationNumber=${encodeURIComponent(body.confirmationNumber)}`;
      } else {
        return json({ success: false, error: "orderNumber or confirmationNumber required" }, 400);
      }
      const r = await callAbc(tok.token, "GET", endpoint);
      const error_code = r.ok ? null : mapAbcError(r.status, r.json);
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint,
        status_code: r.status, response_body: r.json ?? r.text, error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });

      // Persist status-lookup result onto the matching abc_orders row.
      // abc_orders has no `last_status_payload` column — stash into raw_payload.status_lookup.
      if (r.ok) {
        try {
          const respBody: any = r.json ?? null;
          const first = Array.isArray(respBody) ? respBody[0] : respBody?.orders?.[0] ?? respBody;
          const newStatus =
            first?.status ?? first?.orderStatus ?? first?.order_status ?? null;

          const filters: string[] = [];
          if (body.orderNumber) filters.push(`order_number.eq.${body.orderNumber}`);
          if (body.confirmationNumber) filters.push(`confirmation_number.eq.${body.confirmationNumber}`);

          if (filters.length) {
            const { data: existing } = await (supabase as any)
              .from("abc_orders")
              .select("id, raw_payload")
              .eq("tenant_id", tenant_id)
              .or(filters.join(","))
              .limit(1)
              .maybeSingle();

            if (existing?.id) {
              const merged = {
                ...(existing.raw_payload || {}),
                status_lookup: {
                  status: r.status,
                  body: r.json ?? r.text,
                  at: new Date().toISOString(),
                },
              };
              const upd: any = {
                raw_payload: merged,
                updated_at: new Date().toISOString(),
              };
              if (newStatus) upd.order_status = String(newStatus).toLowerCase();
              await (supabase as any).from("abc_orders").update(upd).eq("id", existing.id);
            }
          }
        } catch (e) {
          console.warn("[supplier-api abc] get_order_status persist failed", e);
        }
      }

      return json({ success: r.ok, environment: env, endpoint, status: r.status, body: r.json ?? r.text, error_code });
    }


    // ---------------- submit_test_order ----------------
    if (action === "submit_test_order") {
      const endpoint = `${cfg.apiBase}/order/v2/orders`;
      const branchNumber = (body.branchNumber || body.branch_code || "").toString().trim();
      const shipToNumber = (body.shipToNumber || "").toString().trim();
      const itemNumber = (body.itemNumber || "").toString().trim();
      if (!branchNumber || !shipToNumber || !itemNumber) {
        return json({
          success: false,
          error: "missing_demo_inputs",
          interpretation:
            "shipToNumber, branchNumber, and itemNumber are all required. Use Product Search to select a real item at the target branch.",
        }, 400);
      }
      const ts = Date.now();
      const requestId = `PITCH-TEST-${ts}`;
      const purchaseOrder = `PITCH-TEST-${ts}`;

      const delivery = new Date();
      delivery.setUTCDate(delivery.getUTCDate() + 1);
      const deliveryRequestedFor = delivery.toISOString().slice(0, 10);

      const orderObj = body.order ?? {
        requestId,
        purchaseOrder,
        branchNumber,
        deliveryService: "CPU",
        typeCode: "SO",
        dates: { deliveryRequestedFor },
        currency: "USD",
        shipTo: {
          name: "ABC Sandbox Test",
          number: shipToNumber,
          address: {
            line1: "123 Test Street",
            city: "North Port",
            state: "FL",
            postal: "34286",
            country: "USA",
          },
        },
        orderComments: [
          {
            code: "H",
            description: "PITCH integration sandbox test order - non-production QA",
          },
        ],
        lines: [{
          id: 1,
          itemNumber,
          itemDescription: "Sandbox test item",
          orderedQty: { value: 1, uom: "EA" },
        }],
      };

      // ABC /order/v2/orders accepts an ARRAY of orders.
      const payload = [orderObj];
      const r = await callAbc(tok.token, "POST", endpoint, payload);
      const error_code = r.ok ? null : mapAbcError(r.status, r.json);
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint,
        request_body_redacted: payload,
        status_code: r.status, response_body: r.json ?? r.text, error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });

      const respBody: any = r.json ?? null;
      const first = Array.isArray(respBody) ? respBody[0] : respBody?.orders?.[0] ?? respBody;
      const orderNumber =
        first?.orderNumber ?? first?.order_number ?? first?.order?.orderNumber ?? first?.orderId ?? null;
      const confirmationNumber =
        first?.confirmationNumber ?? first?.confirmation_number ?? first?.order?.confirmationNumber ?? null;
      const transactionID =
        first?.transactionID ?? first?.transactionId ?? first?.transaction_id ?? null;

      // Persist sandbox attempt to abc_orders (query-then-insert/update).
      try {
        const { data: existing } = await (supabase as any)
          .from("abc_orders")
          .select("id")
          .eq("tenant_id", tenant_id)
          .or(
            [
              `request_id.eq.${requestId}`,
              `purchase_order.eq.${purchaseOrder}`,
              orderNumber ? `order_number.eq.${orderNumber}` : null,
              confirmationNumber ? `confirmation_number.eq.${confirmationNumber}` : null,
            ].filter(Boolean).join(","),
          )
          .limit(1)
          .maybeSingle();

        const orderStatus = r.ok
          ? (orderNumber || confirmationNumber ? "submitted" : "submitted_pending_reference")
          : "error";

        const orderRow = {
          tenant_id,
          request_id: requestId,
          purchase_order: purchaseOrder,
          order_number: orderNumber,
          confirmation_number: confirmationNumber,
          order_status: orderStatus,
          branch_number: branchNumber,
          ship_to_number: shipToNumber,
          sold_to_number: shipToNumber,
          ordered_on: new Date().toISOString().slice(0, 10),
          delivery_requested_for: deliveryRequestedFor,
          currency: "USD",
          source: "sandbox",
          raw_payload: {
            request: payload,
            response: { status: r.status, body: r.json ?? r.text },
            transactionID,
          },
          updated_at: new Date().toISOString(),
        };

        let orderId: string | null = existing?.id ?? null;
        if (orderId) {
          await (supabase as any).from("abc_orders").update(orderRow).eq("id", orderId);
        } else {
          const { data: ins } = await (supabase as any)
            .from("abc_orders")
            .insert(orderRow)
            .select("id")
            .single();
          orderId = ins?.id ?? null;
        }

        if (orderId) {
          await (supabase as any)
            .from("abc_order_lines")
            .delete()
            .eq("order_id", orderId)
            .eq("tenant_id", tenant_id);
          const line0 = orderObj.lines?.[0];
          if (line0) {
            await (supabase as any).from("abc_order_lines").insert({
              order_id: orderId,
              tenant_id,
              line_id: String(line0.id ?? 1),
              item_number: line0.itemNumber,
              item_description: line0.itemDescription,
              ordered_qty: Number(line0.orderedQty?.value ?? 1),
              ordered_uom: line0.orderedQty?.uom ?? "EA",
              raw_payload: line0,
            });
          }
        }
      } catch (persistErr) {
        console.warn("[supplier-api abc] submit_test_order persist failed", persistErr);
      }

      return json({
        success: r.ok,
        environment: env,
        endpoint,
        tokenIssued: true,
        orderRequest: payload,
        orderResponse: { status: r.status, body: r.json ?? r.text },
        orderNumber,
        confirmationNumber,
        transactionID,
        requestId,
        purchaseOrder,
        branchNumber,
        shipToNumber,
        error_code,
        timestamp: new Date().toISOString(),
      });
    }



    // ---------------- place_order / submit_order (legacy) ----------------
    if (action === "place_order" || action === "submit_order") {
      const endpoint = `${cfg.apiBase}/order/v2/orders`;

      let payload: any[];

      if (body.order) {
        // Caller supplied a pre-shaped ABC order object (or array).
        payload = Array.isArray(body.order) ? body.order : [body.order];
      } else {
        // Legacy item-based shape — build an ABC order from items[].
        const items = (body.items || []).filter(
          (i) => Number(i.quantity) > 0 && (i.abc_item_code || i.srs_item_code || i.item_name),
        );
        if (!items.length) {
          return json({ success: false, error: "no_items", interpretation: "No items to submit." }, 400);
        }
        const { data: conn } = await supabase
          .from("abc_connections")
          .select("account_number,default_branch_code")
          .eq("tenant_id", tenant_id)
          .eq("environment", env)
          .maybeSingle();
        const shipToNumber =
          body.shipToNumber ||
          (conn as any)?.account_number ||
          Deno.env.get("ABC_ACCOUNT_NUMBER") ||
          "";
        const branchNumber =
          (body.branchNumber || body.branch_code || (conn as any)?.default_branch_code || "")
            .toString().trim();
        // Map our delivery method enum -> ABC delivery service codes.
        // CPU = Customer Pickup, OTG = Other Ground, OTR = Other Roof, COM = Commercial.
        const deliveryService =
          body.delivery_method === "pickup" ? "CPU"
            : body.delivery_method === "ground_drop" ? "OTG"
              : body.delivery_method === "roof_load" ? "OTR"
                : "CPU";

        const parseAddr = (raw?: string) => {
          if (!raw) return { line1: "", city: "", state: "", postal: "", country: "USA" };
          const m = raw.match(/^(.*?),\s*(.*?),\s*([A-Z]{2})\s*(\d{5})/i);
          return m
            ? { line1: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), postal: m[4], country: "USA" }
            : { line1: raw.trim(), city: "", state: "", postal: "", country: "USA" };
        };

        const ts = Date.now();
        const poNumber = `PITCH-${body.job_number || "JOB"}-${ts}`;
        payload = [{
          requestId: poNumber,
          purchaseOrder: poNumber,
          branchNumber,
          deliveryService,
          typeCode: "SO",
          dates: body.delivery_date ? { deliveryRequestedFor: body.delivery_date } : undefined,
          currency: "USD",
          shipTo: {
            name: body.customer_name || "",
            number: shipToNumber,
            address: parseAddr(body.delivery_address),
          },
          orderComments: body.notes
            ? [{ code: "H", description: String(body.notes).slice(0, 500) }]
            : [],
          lines: items.map((i, idx) => ({
            id: idx + 1,
            itemNumber: (i.abc_item_code || i.srs_item_code || i.item_name).toString(),
            itemDescription: i.description || i.item_name,
            orderedQty: {
              value: Number(i.quantity),
              uom: (i.unit || "EA").toUpperCase(),
            },
          })),
        }];
      }

      const r = await callAbc(tok.token, "POST", endpoint, payload);
      const error_code = r.ok ? null : mapAbcError(r.status, r.json);

      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint,
        request_body_redacted: payload,
        status_code: r.status, response_body: r.json ?? r.text, error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });

      // Persist on success (legacy shape only)
      if (r.ok && !body.order && body.items?.length) {
        try {
          const respFirst = Array.isArray(r.json) ? r.json[0] : r.json;
          const orderObj = payload[0];
          const orderNumber = respFirst?.orderNumber || respFirst?.order_number || orderObj.purchaseOrder;
          const confirmation = respFirst?.confirmationNumber || respFirst?.confirmation_number || null;
          const totalAmount =
            Number(respFirst?.totalAmount || respFirst?.total_amount || 0) ||
            body.items!.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0);

          const { data: orderRow } = await supabase
            .from("abc_orders")
            .insert({
              tenant_id,
              order_number: orderNumber,
              purchase_order: orderObj.purchaseOrder,
              confirmation_number: confirmation,
              order_status: respFirst?.status || "submitted",
              branch_number: orderObj.branchNumber || null,
              sold_to_number: orderObj.shipTo?.number || null,
              ship_to_number: orderObj.shipTo?.number || null,
              ordered_on: new Date().toISOString().slice(0, 10),
              delivery_requested_for: body.delivery_date || null,
              total_amount: totalAmount,
              currency: "USD",
              source: "pitch",
              raw_payload: { request: payload, response: r.json ?? r.text },
            })
            .select("id")
            .single();

          if (orderRow?.id) {
            await supabase.from("abc_order_lines").insert(
              body.items!.map((i, idx) => ({
                order_id: orderRow.id,
                tenant_id,
                line_id: String(idx + 1),
                item_number: (i.abc_item_code || i.srs_item_code || i.item_name).toString(),
                item_description: i.description || i.item_name,
                ordered_qty: Number(i.quantity),
                ordered_uom: (i.unit || "EA").toUpperCase(),
                unit_price: Number(i.unit_cost || 0),
                amount: Number(i.quantity || 0) * Number(i.unit_cost || 0),
                raw_payload: i,
              })),
            );
            if (body.project_id) {
              await supabase.from("abc_order_job_links").insert({
                tenant_id,
                order_id: orderRow.id,
                job_id: body.project_id,
                estimate_id: body.estimate_id || null,
              });
            }
          }
        } catch (persistErr) {
          console.error("abc place_order persist error", persistErr);
        }
      }

      return json({
        success: r.ok,
        environment: env,
        endpoint,
        orderRequest: payload,
        orderResponse: { status: r.status, body: r.json ?? r.text },
        error_code,
        timestamp: new Date().toISOString(),
      });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("abc-api-proxy error:", error);
    const serializeErr = (e: unknown): string => {
      if (!e) return "unknown error";
      if (typeof e === "string") return e;
      if (e instanceof Error) return e.message;
      const anyE = e as any;
      const parts = [
        anyE.message, anyE.error_description, anyE.error, anyE.details, anyE.hint,
        anyE.code ? `code=${anyE.code}` : null,
      ].filter(Boolean);
      if (parts.length) return parts.join(" | ");
      try { return JSON.stringify(e); } catch { return String(e); }
    };
    const msg = serializeErr(error);
    return new Response(
      JSON.stringify({
        success: false,
        error: msg,
        raw_error: (() => { try { return JSON.parse(JSON.stringify(error)); } catch { return null; } })(),
        interpretation: requestAction === "start_oauth"
          ? `Could not start ABC OAuth: ${msg}`
          : undefined,
      }),
      {
        status: requestAction === "start_oauth" ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
};
