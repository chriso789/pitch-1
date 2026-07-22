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
import {
  startPricingRun,
  recordPriceHistoryBulk,
  completePricingRun,
  type PriceHistoryLineInput,
  type PricingRunStatus,
} from "../_shared/supplier-pricing-history.ts";
import {
  searchAbcCatalog,
  getAbcCatalogItem,
} from "../_shared/abc/catalogService.ts";
import {
  priceItems as priceItemsService,
  validatePricingRequest,
  type AbcPricingServiceRequest,
} from "../_shared/abc/pricingService.ts";

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

/** Detect Imperva/Incapsula WAF challenges in upstream responses. */
function detectWaf(status: number, text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes("_incapsula_resource")) return true;
  if (t.includes("incident_id") && t.includes("incapsula")) return true;
  if (t.includes("incident id") && (t.includes("imperva") || t.includes("incapsula"))) return true;
  if ((status === 403 || status === 406 || status === 503) && t.includes("<html") &&
      (t.includes("incapsula") || t.includes("imperva") || t.includes("request unsuccessful"))) return true;
  return false;
}

/** Map ABC/transport errors to stable codes the UI can act on. */
function mapAbcError(status: number, body: any): string {
  if (status === 499) return "abc_waf_blocked"; // sentinel injected by callAbc on WAF detection
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

function interpretAbcError(errorCode: string | null, status: number, body: any): string | null {
  if (errorCode === "abc_waf_blocked") {
    return "ABC/Imperva blocked the server-to-server request before ABC order validation. The sandbox payload shape is valid; ABC must allowlist the Supabase Edge Function egress/WAF path for this environment.";
  }
  const message = typeof body?.errorMessage === "string" ? body.errorMessage : "";
  if (status === 400 && message) return message;
  return null;
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
): Promise<{ status: number; json: any; text: string; ok: boolean; headers: Record<string, string> }> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  if (!resp.ok && detectWaf(resp.status, text)) {
    return { status: 499, json: { waf: true, upstream_status: resp.status }, text, ok: false, headers };
  }
  return { status: resp.status, json, text, ok: resp.ok, headers };
}


interface ProxyRequest {
  action:
    | "test_connection"
    | "get_status"
    | "sandbox_test_login_status"
    | "start_oauth"
    | "sync_accounts"
    | "price_items"
    | "price_items_record_history"
    | "get_branches"
    | "get_branch"
    | "search_products"
    | "get_item"
    | "place_order"
    | "submit_order"           // legacy alias for place_order
    | "submit_test_order"
    | "validate_payload_only"
    | "get_order_status"
    | "register_webhook"
    | "list_webhooks";

  // price_items_record_history extras
  source_context?: "template" | "estimate" | "project" | "order";
  source_id?: string | null;

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
  // submit_test_order extended inputs (Sandy contract)
  uom?: string;
  quantity?: number;
  itemDescription?: string;
  jobsiteContact?: { name?: string; email?: string; phone?: string };
  priceOverride?: { value: number; reason: string };
  sandboxDemo?: boolean;
}

const ABC_SANDBOX_DEMO_FALLBACK = { shipToNumber: "2010466-2", branchNumber: "1209" } as const;

// Sandbox-only Product API snapshot. Used ONLY when:
//   env === "sandbox" AND body.sandboxDemo === true
//   AND the live ABC Product API call was WAF-blocked (status 499).
// Manually confirmed from ABC sandbox Product API logs. Do NOT widen this
// map without first verifying itemNumber + validUoms against a real ABC
// Product API response captured in abc_api_audit.
const ABC_SANDBOX_DEMO_CATALOG: Record<string, { itemNumber: string; itemDescription: string; validUoms: string[] }> = {
  "02OCTDUMP": {
    itemNumber: "02OCTDUMP",
    itemDescription: "Sandbox Demo Item 02OCTDUMP",
    validUoms: ["EA"],
  },
};

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

    // ── Tenant resolution + anti-spoof gate ──────────────────────────
    // Never trust body.tenant_id as source of truth. Always resolve from JWT.
    // If body supplied a tenant_id that disagrees with the resolved tenant,
    // reject 403 unless caller is a verified master / platform admin.
    let tenant_id: string | undefined = undefined;
    let userId: string | null = null;
    let callerIsMaster = false;
    const bodyTenantId = body.tenant_id?.toString().trim() || undefined;

    if (auth) {
      const { data: userRes } = await authClient.auth.getUser();
      userId = userRes?.user?.id ?? null;
      if (userId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("tenant_id, active_tenant_id, role")
          .eq("id", userId)
          .maybeSingle();
        const p: any = prof || {};
        tenant_id = p.active_tenant_id ?? p.tenant_id ?? undefined;

        // Verified master/platform_admin via has_role RPC (not profile column alone).
        try {
          const { data: isMaster } = await (supabase as any).rpc("has_role", {
            _user_id: userId,
            _role: "master",
          });
          if (isMaster === true) callerIsMaster = true;
          if (!callerIsMaster) {
            const { data: isPa } = await (supabase as any).rpc("has_role", {
              _user_id: userId,
              _role: "platform_admin",
            });
            if (isPa === true) callerIsMaster = true;
          }
        } catch (_e) { /* role helper missing → treat as non-master */ }
      }
    }

    // Spoof guard: applies to every ABC action.
    if (bodyTenantId && bodyTenantId !== tenant_id) {
      if (!callerIsMaster) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "tenant_spoof_forbidden",
            interpretation:
              "Request body tenant_id does not match the authenticated user's tenant. Master role required to override.",
            resolved_tenant_id: tenant_id ?? null,
            body_tenant_id: bodyTenantId,
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Master override: honor body.tenant_id, log it.
      console.warn("[supplier-api abc] master tenant override", {
        userId, from: tenant_id, to: bodyTenantId, action: body.action,
      });
      tenant_id = bodyTenantId;
    }

    console.log("abc-api-proxy", { action: body.action, env, tenant_id, callerIsMaster, hasAuthHeader: !!auth, authPrefix: auth ? auth.slice(0, 16) : null, userId });



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

      const rawReturnOrigin = (body.return_origin || "").toString().trim();
      let safeReturnOrigin: string | null = null;
      try {
        if (rawReturnOrigin) {
          const u = new URL(rawReturnOrigin);
          if (u.protocol === "http:" || u.protocol === "https:") {
            safeReturnOrigin = `${u.protocol}//${u.host}`;
          }
        }
      } catch { /* ignore bad origin */ }

      const { error: stateErr } = await supabase.from("abc_oauth_states").insert({
        state,
        tenant_id,
        integration_id: (integration as any).id,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        return_origin: safeReturnOrigin,
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
      url.searchParams.set("prompt", "login");
      url.searchParams.set("max_age", "0");
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


    // ---------------- sandbox_test_login_status ----------------
    if (action === "sandbox_test_login_status") {
      const username = Deno.env.get("ABC_SANDBOX_TEST_USERNAME") || null;
      const passwordSet = !!Deno.env.get("ABC_SANDBOX_TEST_PASSWORD");
      return json({
        success: true,
        configured: !!username && passwordSet,
        username: username ?? null,
        password_masked: passwordSet ? "********" : null,
        environment: env,
        note: "Sandbox test login is used only for the manual OAuth consent step. ABC sandbox is non-production QA.",
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
    // validate_payload_only never calls ABC, so it does not require a token.
    if (action !== "validate_payload_only") {
      if (!tenant_id) return json({ success: false, error: "no_tenant_context" }, 400);
    }
    const tok = action === "validate_payload_only"
      ? { token: "", error: undefined as string | undefined }
      : await getValidAccessToken(supabase, tenant_id!, env);
    if (action !== "validate_payload_only" && !tok.token) {
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
    // Delegates payload construction + response normalization to the shared
    // ABC catalog service (Phase 1B Slice 1). Wire contract and audit shape
    // remain byte-for-byte identical to the pre-refactor handler.
    if (action === "search_products") {
      const result = await searchAbcCatalog(
        { apiBase: cfg.apiBase, token: tok.token, callAbc, mapAbcError },
        {
          itemNumber: body.itemNumber,
          query: body.query,
          branchNumber: body.branchNumber,
          itemsPerPage: body.itemsPerPage,
        },
      );
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint: result.endpoint,
        request_body_redacted: result.request,
        status_code: result.status, response_body: result.body, error_code: result.error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      return json({
        success: result.success, environment: env, endpoint: result.endpoint,
        request: result.request, status: result.status, body: result.body,
        error_code: result.error_code, normalized: result.normalized,
      });
    }

    if (action === "get_item") {
      const itm = (body.itemNumber || "").toString().trim();
      if (!itm) return json({ success: false, error: "itemNumber required" }, 400);
      const result = await getAbcCatalogItem(
        { apiBase: cfg.apiBase, token: tok.token, callAbc, mapAbcError },
        itm,
      );
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint: result.endpoint,
        status_code: result.status, response_body: result.body, error_code: result.error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      return json({
        success: result.success, environment: env, endpoint: result.endpoint,
        status: result.status, body: result.body,
        error_code: result.error_code, normalized: result.normalized,
      });
    }

    // ---------------- price_items ----------------
    // Routes through the shared pricing service. See _shared/abc/pricingService.ts.
    // `success` reflects parsed.runStatus, NOT HTTP status.
    if (action === "price_items") {
      const req: AbcPricingServiceRequest = {
        requestId: body.requestId,
        shipToNumber: body.shipToNumber,
        branchNumber: body.branchNumber,
        purpose: body.purpose as any,
        lines: (body.lines || []).map((l: any) => ({
          itemNumber: l.itemNumber,
          quantity: Number(l.quantity) || 1,
          uom: l.unitOfMeasure || l.uom || "EA",
        })),
      };
      const invalid = validatePricingRequest(req);
      if (invalid) {
        return json({ success: false, error: invalid.error_code, missing: invalid.missing, message: invalid.message }, 400);
      }
      const result = await priceItemsService(
        { apiBase: cfg.apiBase, token: tok.token, callAbc, mapAbcError },
        req,
      );
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint: result.endpoint,
        request_body_redacted: result.request,
        status_code: result.status, response_body: result.body, error_code: result.error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      return json({
        success: result.success,
        environment: env,
        endpoint: result.endpoint,
        request: result.request,
        status: result.status,
        body: result.body,
        error_code: result.error_code,
        parsed: result.parsed,
        runStatus: result.runStatus,
        counts: result.counts,
        warnings: result.warnings,
      });
    }


    // ---------------- price_items_record_history ----------------
    // Calls ABC Price Items and records every result line into
    // supplier_price_history under a supplier_pricing_runs run. Does NOT
    // overwrite estimate cost. Reference / fulfillment pricing only.
    if (action === "price_items_record_history") {
      const sourceContext = body.source_context;
      const rawItems = Array.isArray((body as any).items) ? (body as any).items : [];
      type InItem = {
        template_item_id?: string | null;
        estimate_line_item_id?: string | null;
        itemNumber?: string;
        itemDescription?: string | null;
        uom?: string | null;
        quantity?: number | null;
      };
      const items: InItem[] = rawItems;

      if (!sourceContext || !["template", "estimate", "project", "order"].includes(sourceContext)) {
        return json({ success: false, error: "source_context required (template|estimate|project|order)" }, 400);
      }
      if (!body.shipToNumber || !body.branchNumber) {
        return json({ success: false, error: "shipToNumber and branchNumber required" }, 400);
      }
      if (!items.length || !items.every((i) => i && typeof i.itemNumber === "string" && i.itemNumber.length > 0)) {
        return json({ success: false, error: "items[] required; each must have itemNumber" }, 400);
      }

      // 1) Open run (service role)
      let runId: string;
      try {
        const r = await startPricingRun(supabase, {
          tenant_id: tenant_id!,
          supplier: "abc",
          source_context: sourceContext,
          source_id: body.source_id ?? null,
          environment: env,
          ship_to_number: body.shipToNumber,
          branch_number: body.branchNumber,
          created_by: userId,
          metadata: { route: "supplier-api/abc/proxy", action },
        });
        runId = r.id;
      } catch (e: any) {
        return json({ success: false, error: "pricing_run_start_failed", details: e?.message ?? String(e) }, 500);
      }

      // 2) Call ABC Price Items via shared pricing service
      const serviceReq: AbcPricingServiceRequest = {
        requestId: `PITCH-PRICE-RUN-${runId}`,
        shipToNumber: body.shipToNumber,
        branchNumber: body.branchNumber,
        purpose: (body.purpose as any) ?? "estimating",
        lines: items.map((l) => ({
          itemNumber: l.itemNumber!,
          quantity: Number(l.quantity) || 1,
          uom: (l.uom || "EA").toString(),
          itemDescription: l.itemDescription ?? null,
          templateItemId: l.template_item_id ?? null,
          estimateLineItemId: l.estimate_line_item_id ?? null,
        })),
      };
      const result = await priceItemsService(
        { apiBase: cfg.apiBase, token: tok.token, callAbc, mapAbcError },
        serviceReq,
      );
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint: result.endpoint,
        request_body_redacted: result.request,
        status_code: result.status, response_body: result.body, error_code: result.error_code,
        duration_ms: Date.now() - startedAt, created_by: userId,
      });

      // 3) Build history rows from parsed lines (single source of truth)
      const parsed = result.parsed;
      const isWaf = result.status === 499 || result.error_code === "abc_waf_blocked";
      const errorSummary = parsed.errorSummary
        ?? (isWaf ? "abc_waf_blocked" : result.error_code ?? null);

      const historyRows: PriceHistoryLineInput[] = items.map((it, idx) => {
        const p = parsed.lines[idx];
        const lineStatus: PriceHistoryLineInput["status"] = p?.status === "ok"
          ? "ok"
          : isWaf || p?.status === "unavailable"
            ? "unavailable"
            : "error";
        return {
          tenant_id: tenant_id!,
          pricing_run_id: runId,
          supplier: "abc",
          template_id: sourceContext === "template" ? (body.source_id ?? null) : null,
          template_item_id: sourceContext === "template" ? (it.template_item_id ?? null) : null,
          estimate_id: sourceContext === "estimate" ? (body.source_id ?? null) : null,
          estimate_line_item_id: sourceContext === "estimate" ? (it.estimate_line_item_id ?? null) : null,
          supplier_item_number: it.itemNumber ?? null,
          supplier_item_description: p?.itemDescription ?? it.itemDescription ?? null,
          uom: (p?.returnedUom ?? p?.requestedUom ?? it.uom ?? "EA").toString().toUpperCase(),
          quantity: Number(it.quantity) || 1,
          unit_price: p?.unitPrice ?? null,
          extended_price: p?.extendedPrice ?? null,
          availability: p?.availability?.status ? String(p.availability.status) : null,
          ship_to_number: body.shipToNumber ?? null,
          branch_number: body.branchNumber ?? null,
          price_source: "abc_price_items",
          raw_response: p?.raw ?? (result.status !== 200
            ? { error_code: result.error_code, status: result.status, body: result.body }
            : null),
          status: lineStatus,
          created_by: userId,
        };
      });

      let recordedCount = 0;
      try {
        const ins = await recordPriceHistoryBulk(supabase, historyRows);
        recordedCount = ins.inserted;
      } catch (e) {
        console.warn("[supplier-api abc] recordPriceHistoryBulk failed", e);
      }

      // 4) Complete run — status derived from parsed.runStatus (NOT HTTP)
      const finalStatus: Exclude<PricingRunStatus, "running"> =
        parsed.runStatus === "completed"
          ? "completed"
          : parsed.runStatus === "partial"
            ? "partial"
            : "failed";

      try {
        await completePricingRun(supabase, runId, {
          status: finalStatus,
          error_summary: errorSummary,
          metadata_patch: {
            abc_status: result.status,
            abc_error_code: result.error_code,
            run_status: parsed.runStatus,
            counts: parsed.counts,
            recorded_count: recordedCount,
            requested_count: historyRows.length,
          },
        });
      } catch (e) {
        console.warn("[supplier-api abc] completePricingRun failed", e);
      }

      return json({
        success: result.success,
        environment: env,
        endpoint: result.endpoint,
        run_id: runId,
        run_status: finalStatus,
        recorded_count: recordedCount,
        requested_count: historyRows.length,
        error_code: result.error_code,
        error_summary: errorSummary,
        parsed,
        counts: parsed.counts,
        warnings: parsed.warnings,
        lines: historyRows.map((h) => ({
          template_item_id: h.template_item_id,
          estimate_line_item_id: h.estimate_line_item_id,
          itemNumber: h.supplier_item_number,
          uom: h.uom,
          quantity: h.quantity,
          unit_price: h.unit_price,
          extended_price: h.extended_price,
          availability: h.availability,
          status: h.status,
        })),
      });
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


    // ---------------- validate_payload_only ----------------
    // Runs every Sandy contract check, builds the EXACT outgoing ABC orderRequest,
    // writes an abc_api_audit row tagged "validate_payload_only", and returns
    // payloadProof + the built payload. NEVER POSTs to ABC. NEVER writes
    // abc_orders or abc_order_lines. Production rejects sandboxDemo with
    // sandbox_demo_forbidden_in_production.
    if (action === "validate_payload_only") {
      const endpoint = `${cfg.apiBase}/order/v2/orders`;

      // Hard gate: sandbox-demo fallbacks are sandbox-only.
      if (body.sandboxDemo && env !== "sandbox") {
        return json({
          success: false,
          validation: "FAIL",
          error: "sandbox_demo_forbidden_in_production",
          interpretation:
            "Sandbox demo fallbacks are not allowed when environment !== sandbox. Remove sandboxDemo for production.",
        }, 400);
      }
      if (!tenant_id) {
        return json({
          success: false,
          validation: "FAIL",
          error: "no_tenant_context",
          interpretation:
            "validate_payload_only requires an authenticated tenant context. Sign in and retry.",
        }, 400);
      }
      const sandboxDemo = !!body.sandboxDemo && env === "sandbox";

      let shipToNumber = (body.shipToNumber || "").toString().trim();
      let branchNumber = (body.branchNumber || body.branch_code || "").toString().trim();
      if (sandboxDemo) {
        if (!shipToNumber) shipToNumber = ABC_SANDBOX_DEMO_FALLBACK.shipToNumber;
        if (!branchNumber) branchNumber = ABC_SANDBOX_DEMO_FALLBACK.branchNumber;
      }

      const itemNumber = (body.itemNumber || "").toString().trim();
      const requestedUom = (body.uom || "").toString().trim().toUpperCase();
      const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 1) || 1));
      const itemDescriptionInput = (body.itemDescription || "").toString().trim();
      const jc = body.jobsiteContact || {};
      const jcName = (jc.name || "").toString().trim();
      const jcEmail = (jc.email || "").toString().trim();
      const jcPhone = (jc.phone || "").toString().trim();
      const jcPhoneDigits = jcPhone.replace(/\D/g, "");
      const override = body.priceOverride;

      // Sandy required-field gate.
      const missing: string[] = [];
      if (!shipToNumber) missing.push("shipToNumber");
      if (!branchNumber) missing.push("branchNumber");
      if (!itemNumber) missing.push("itemNumber");
      if (!requestedUom) missing.push("uom");
      if (!jcName) missing.push("jobsiteContact.name");
      if (!jcEmail) missing.push("jobsiteContact.email");
      if (!jcPhoneDigits) missing.push("jobsiteContact.phone");
      if (override && (!Number.isFinite(Number(override.value)) || Number(override.value) <= 0)) {
        missing.push("priceOverride.value");
      }
      if (override && !String(override.reason || "").trim()) {
        missing.push("priceOverride.reason");
      }
      if (missing.length) {
        return json({
          success: false,
          validation: "FAIL",
          error: "missing_required_fields",
          missing,
          interpretation: `Cannot validate ABC order — missing: ${missing.join(", ")}.`,
        }, 400);
      }

      // Catalog gate — validate-only NEVER calls ABC. Use sandbox demo snapshot
      // when sandboxDemo, otherwise require caller-provided itemDescription.
      let catalogValidUoms: string[] = [];
      let catalogDescription: string | null = null;
      let catalogSource: "caller_provided" | "sandbox_demo_snapshot" = "caller_provided";
      if (sandboxDemo) {
        const snap = ABC_SANDBOX_DEMO_CATALOG[itemNumber];
        if (!snap) {
          return json({
            success: false,
            validation: "FAIL",
            error: "sandbox_demo_item_not_whitelisted",
            interpretation:
              `validate_payload_only with sandboxDemo only accepts whitelisted items: [${Object.keys(ABC_SANDBOX_DEMO_CATALOG).join(", ")}]. Got "${itemNumber}".`,
          }, 400);
        }
        catalogValidUoms = snap.validUoms.map((u) => u.toUpperCase());
        catalogDescription = snap.itemDescription;
        catalogSource = "sandbox_demo_snapshot";
      }

      if (catalogValidUoms.length && !catalogValidUoms.includes(requestedUom)) {
        return json({
          success: false,
          validation: "FAIL",
          error: "invalid_uom_for_item",
          interpretation: `UOM "${requestedUom}" is not in the sandbox demo valid UOM list for ${itemNumber}. Valid UOMs: ${catalogValidUoms.join(", ")}.`,
          itemNumber,
          validUoms: catalogValidUoms,
          catalogSource,
        }, 400);
      }

      const itemDescription = itemDescriptionInput || catalogDescription || "";
      if (!itemDescription) {
        return json({
          success: false,
          validation: "FAIL",
          error: "missing_item_description",
          interpretation:
            `validate_payload_only requires itemDescription (caller-supplied or sandbox snapshot) for ${itemNumber}.`,
        }, 400);
      }

      // Price: validate-only never calls ABC. Require an override when no
      // Price Items echo is available. (In sandbox demo this is the WAF
      // contingency the UI exposes.)
      if (!override) {
        return json({
          success: false,
          validation: "FAIL",
          error: "price_override_required_for_validate",
          interpretation:
            "validate_payload_only does not call ABC Price Items. Supply priceOverride.value + priceOverride.reason to build the payload.",
        }, 422);
      }
      const finalUnitPrice = Number(override.value);
      const priceSource = "override" as const;

      const ts = Date.now();
      const requestId = `PITCH-VALIDATE-${ts}`;
      const purchaseOrder = `PITCH-${ts}`;
      const delivery = new Date();
      delivery.setUTCDate(delivery.getUTCDate() + 1);
      const deliveryRequestedFor = delivery.toISOString().slice(0, 10);

      const orderObj = {
        requestId,
        purchaseOrder,
        branchNumber,
        deliveryService: "CPU",
        typeCode: "SO",
        dates: { deliveryRequestedFor },
        currency: "USD",
        shipTo: {
          name: jcName.slice(0, 60),
          number: shipToNumber,
          address: {
            line1: "123 Test Street", line2: "", line3: "",
            city: "North Port", state: "FL", postal: "34286", country: "USA",
          },
          contacts: [{
            functionCode: "DC",
            name: jcName.slice(0, 60),
            email: jcEmail.slice(0, 80),
            phones: [{ number: jcPhoneDigits, type: "MOBILE", ext: "" }],
          }],
        },
        orderComments: [{
          code: "H",
          description:
            "PITCH integration validate_payload_only - payload validation only, NOT sent to ABC" +
            (sandboxDemo ? " [SANDBOX DEMO]" : ""),
        }],
        lines: [{
          id: "1",
          itemNumber,
          itemDescription,
          orderedQty: { value: quantity, uom: requestedUom },
          unitPrice: { value: finalUnitPrice, uom: requestedUom, instructions: "PITCH validate-only" },
        }],
      };
      const payload = [orderObj];

      const sandboxWarning = sandboxDemo
        ? "ABC sandbox validate-only path. Payload was NOT sent to ABC. payloadProof reflects shape only — ABC acceptance is unproven until live submit succeeds."
        : null;

      const payloadProof = {
        shipToNumber,
        branchNumber,
        shipToContactDC: orderObj.shipTo.contacts.find((c: any) => c.functionCode === "DC") ?? null,
        itemNumber,
        itemDescription,
        orderedQty: { value: quantity, uom: requestedUom },
        unitPrice: { value: finalUnitPrice, uom: requestedUom },
        priceSource,
        sandboxDemoFallback: sandboxDemo,
        catalogSource,
        sandboxWarning,
      };

      await auditCall(supabase, {
        tenant_id,
        environment: env,
        action: "validate_payload_only",
        endpoint: "(no upstream call)",
        request_body_redacted: payload,
        status_code: 0,
        response_body: { validation: "PASS", payloadProof },
        error_code: null,
        duration_ms: Date.now() - startedAt,
        created_by: userId,
      });

      return json({
        success: true,
        validation: "PASS",
        environment: env,
        endpoint,
        sentToAbc: false,
        payloadProof,
        orderRequest: payload,
        catalogValidUoms,
        finalUnitPrice,
        priceSource,
        requestId,
        purchaseOrder,
        sandboxWarning,
        interpretation:
          "Validate Payload Only: PASS. ABC orderRequest built and audited; no POST to ABC, no abc_orders / abc_order_lines row written. ABC acceptance is NOT proven by this run.",
        timestamp: new Date().toISOString(),
      });
    }

    // ---------------- submit_test_order ----------------
    // Sandy's order-acceptance contract:
    //   - shipToNumber / branchNumber required (sandbox demo mode may fall back
    //     to the published sandbox pair only when env === sandbox + sandboxDemo)
    //   - itemNumber + itemDescription + UOM must come from Product API
    //   - UOM must match Product API valid UOMs for that item (verified here)
    //   - Price Items echo is required; override allowed only with reason
    //   - shipTo.contacts[] must include DC jobsite contact with name+email+phone
    //   - Full price/UOM/branch metadata persisted to abc_order_lines
    if (action === "submit_test_order") {
      const endpoint = `${cfg.apiBase}/order/v2/orders`;

      const sandboxDemo = !!body.sandboxDemo && env === "sandbox";
      let shipToNumber = (body.shipToNumber || "").toString().trim();
      let branchNumber = (body.branchNumber || body.branch_code || "").toString().trim();
      if (sandboxDemo) {
        if (!shipToNumber) shipToNumber = ABC_SANDBOX_DEMO_FALLBACK.shipToNumber;
        if (!branchNumber) branchNumber = ABC_SANDBOX_DEMO_FALLBACK.branchNumber;
      }

      const itemNumber = (body.itemNumber || "").toString().trim();
      const requestedUom = (body.uom || "").toString().trim().toUpperCase();
      const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 1) || 1));
      const itemDescriptionInput = (body.itemDescription || "").toString().trim();
      const jc = body.jobsiteContact || {};
      const jcName = (jc.name || "").toString().trim();
      const jcEmail = (jc.email || "").toString().trim();
      const jcPhone = (jc.phone || "").toString().trim();
      const jcPhoneDigits = jcPhone.replace(/\D/g, "");
      const override = body.priceOverride;

      // ----- Acceptance checks (block submit with exact missing field) -----
      const missing: string[] = [];
      if (!shipToNumber) missing.push("shipToNumber");
      if (!branchNumber) missing.push("branchNumber");
      if (!itemNumber) missing.push("itemNumber");
      if (!requestedUom) missing.push("uom");
      if (!jcName) missing.push("jobsiteContact.name");
      if (!jcEmail) missing.push("jobsiteContact.email");
      if (!jcPhoneDigits) missing.push("jobsiteContact.phone");
      if (override && (!Number.isFinite(Number(override.value)) || Number(override.value) <= 0)) {
        missing.push("priceOverride.value");
      }
      if (override && !String(override.reason || "").trim()) {
        missing.push("priceOverride.reason");
      }
      if (missing.length) {
        return json({
          success: false,
          error: "missing_required_fields",
          missing,
          interpretation: `Cannot submit ABC order — missing: ${missing.join(", ")}.`,
        }, 400);
      }

      const ts = Date.now();
      const requestId = `PITCH-TEST-${ts}`;
      const purchaseOrder = `PITCH-${ts}`;
      const delivery = new Date();
      delivery.setUTCDate(delivery.getUTCDate() + 1);
      const deliveryRequestedFor = delivery.toISOString().slice(0, 10);

      // ----- Catalog gate: itemNumber + valid UOM must come from Product API -----
      let catalogItem: any = null;
      let catalogValidUoms: string[] = [];
      let catalogDescription: string | null = null;
      let catalogFetchError: string | null = null;
      try {
        const catalogEndpoint = `${cfg.apiBase}/catalog/v1/items/${encodeURIComponent(itemNumber)}`;
        const cr = await callAbc(tok.token, "GET", catalogEndpoint, undefined);
        if (cr.ok && cr.json) {
          const cj: any = cr.json;
          catalogItem = Array.isArray(cj?.items) ? cj.items[0] : cj?.item ?? cj;
          catalogDescription =
            catalogItem?.itemDescription ??
            catalogItem?.description ??
            catalogItem?.name ??
            null;
          const uomList =
            catalogItem?.uoms ??
            catalogItem?.unitsOfMeasure ??
            catalogItem?.validUoms ??
            [];
          catalogValidUoms = (Array.isArray(uomList) ? uomList : [])
            .map((u: any) => String(u?.uom ?? u?.code ?? u?.unitOfMeasure ?? u).toUpperCase())
            .filter(Boolean);
        } else {
          catalogFetchError = `catalog_${cr.status}`;
        }
      } catch (e) {
        catalogFetchError = (e as Error)?.message || "catalog_fetch_failed";
      }

      // If catalog returned UOMs, the requested UOM MUST be in that list.
      if (catalogValidUoms.length && !catalogValidUoms.includes(requestedUom)) {
        return json({
          success: false,
          error: "invalid_uom_for_item",
          interpretation: `UOM "${requestedUom}" is not a valid Product API UOM for ${itemNumber}. Valid UOMs: ${catalogValidUoms.join(", ")}.`,
          itemNumber,
          validUoms: catalogValidUoms,
          catalogFetchError,
        }, 400);
      }

      const itemDescription =
        itemDescriptionInput ||
        catalogDescription ||
        "";
      if (!itemDescription) {
        return json({
          success: false,
          error: "missing_item_description",
          interpretation: `Cannot submit ABC order — itemDescription must come from Product API for ${itemNumber}.`,
          catalogFetchError,
        }, 400);
      }

      // ----- Price Items echo -----
      let priceItemsPrice: number | null = null;
      let priceItemsTimestamp: string | null = null;
      let priceItemsRaw: any = null;
      try {
        const priceEndpoint = `${cfg.apiBase}/pricing/v2/prices`;
        const pricePayload = {
          requestId: `PITCH-PRICE-${ts}`,
          shipToNumber,
          branchNumber,
          purpose: "ordering",
          lines: [{ id: "1", itemNumber, quantity, uom: requestedUom }],
        };
        const pr = await callAbc(tok.token, "POST", priceEndpoint, pricePayload);
        priceItemsRaw = pr.json ?? pr.text ?? null;
        const pj: any = pr.json;
        const respLines = Array.isArray(pj?.lines) ? pj.lines
          : Array.isArray(pj) ? (pj[0]?.lines ?? [])
            : [];
        const first = respLines[0] ?? pj;
        const candidate = Number(
          first?.unitPrice?.value ?? first?.unitPrice ?? first?.netPrice ?? first?.price ?? NaN,
        );
        if (Number.isFinite(candidate) && candidate > 0) {
          priceItemsPrice = candidate;
          priceItemsTimestamp = new Date().toISOString();
        }
      } catch (_e) { /* non-fatal; handled below */ }

      const overrideValue = override ? Number(override.value) : null;
      const finalUnitPrice = override ? overrideValue! : priceItemsPrice;
      if (finalUnitPrice == null || !(finalUnitPrice > 0)) {
        return json({
          success: false,
          error: "price_unavailable",
          interpretation:
            "Price Items did not return a positive unit price. Re-verify shipToNumber/branchNumber/itemNumber/UOM, or supply priceOverride with a reason.",
          itemNumber,
          uom: requestedUom,
          shipToNumber,
          branchNumber,
          priceItemsRaw,
        }, 422);
      }

      // ----- Build the ABC order payload -----
      const orderObj = body.order ?? {
        requestId,
        purchaseOrder,
        branchNumber,
        deliveryService: "CPU",
        typeCode: "SO",
        dates: { deliveryRequestedFor },
        currency: "USD",
        shipTo: {
          name: jcName.slice(0, 60),
          number: shipToNumber,
          address: {
            line1: "123 Test Street",
            line2: "",
            line3: "",
            city: "North Port",
            state: "FL",
            postal: "34286",
            country: "USA",
          },
          contacts: [{
            functionCode: "DC",
            name: jcName.slice(0, 60),
            email: jcEmail.slice(0, 80),
            phones: [{ number: jcPhoneDigits, type: "MOBILE", ext: "" }],
          }],
        },
        orderComments: [
          {
            code: "H",
            description:
              "PITCH integration sandbox test order - non-production QA" +
              (sandboxDemo ? " [SANDBOX DEMO FALLBACK ship-to/branch]" : ""),
          },
        ],
        lines: [{
          id: "1",
          itemNumber,
          itemDescription,
          orderedQty: { value: quantity, uom: requestedUom },
          unitPrice: { value: finalUnitPrice, uom: requestedUom, instructions: "PITCH sandbox test" },
        }],
      };

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
      let orderNumber =
        first?.orderNumber ?? first?.order_number ?? first?.order?.orderNumber ?? first?.orderId ?? null;
      let confirmationNumber =
        first?.confirmationNumber ?? first?.confirmation_number ?? first?.order?.confirmationNumber ?? null;
      const transactionID =
        first?.transactionID ?? first?.transactionId ?? first?.transaction_id ?? null;

      if (!confirmationNumber && !orderNumber) {
        const loc = r.headers?.location || r.headers?.["content-location"] || "";
        const headerRef =
          r.headers?.["x-confirmation-number"] ||
          r.headers?.["x-confirmationnumber"] ||
          r.headers?.["x-order-number"] ||
          r.headers?.["x-order-id"] ||
          r.headers?.["x-transaction-id"] ||
          null;
        const locTail = loc ? loc.split("?")[0].split("/").filter(Boolean).pop() : null;
        const asyncRef = headerRef || locTail || transactionID || null;
        if (asyncRef) confirmationNumber = String(asyncRef);
      }

      // ----- Persist order + line with full ABC tracking metadata -----
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
          source: sandboxDemo ? "sandbox_demo" : "sandbox",
          is_sandbox_demo_fallback: sandboxDemo,
          jobsite_contact_name: jcName,
          jobsite_contact_email: jcEmail,
          jobsite_contact_phone: jcPhoneDigits,
          raw_payload: {
            request: payload,
            response: { status: r.status, body: r.json ?? r.text },
            priceItems: priceItemsRaw,
            catalog: catalogItem,
            transactionID,
            sandbox_demo_fallback: sandboxDemo,
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
              ordered_qty: Number(line0.orderedQty?.value ?? quantity),
              ordered_uom: line0.orderedQty?.uom ?? requestedUom,
              unit_price: finalUnitPrice,
              amount: Number((finalUnitPrice * quantity).toFixed(2)),
              abc_item_number: itemNumber,
              abc_item_description: itemDescription,
              abc_uom: requestedUom,
              abc_price: finalUnitPrice,
              abc_price_timestamp: priceItemsTimestamp ?? new Date().toISOString(),
              abc_branch_number: branchNumber,
              abc_ship_to_number: shipToNumber,
              abc_price_source: override ? "override" : "price_items",
              abc_price_override_reason: override?.reason ?? null,
              abc_catalog_payload: catalogItem ?? null,
              raw_payload: { line: line0, priceItems: priceItemsRaw },
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
        sandboxDemoFallback: sandboxDemo,
        catalogValidUoms,
        catalogFetchError,
        priceSource: override ? "override" : "price_items",
        priceItemsPrice,
        priceItemsRaw,
        finalUnitPrice,
        orderRequest: payload,
        orderResponse: { status: r.status, body: r.json ?? r.text },
        orderNumber,
        confirmationNumber,
        transactionID,
        requestId,
        purchaseOrder,
        branchNumber,
        shipToNumber,
        itemNumber,
        itemDescription,
        uom: requestedUom,
        error_code,
        interpretation: interpretAbcError(error_code, r.status, r.json),
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

        // UOM gate — branches reject invalid UOMs. Reject early.
        const missingUom = items.find((i: any) => !String(i.unit || "").trim());
        if (missingUom) {
          return json({
            success: false,
            error: "missing_item_uom",
            interpretation: `Item "${(missingUom as any).item_name || (missingUom as any).abc_item_code}" is missing a UOM. Pull the UOM from the Product API for the selected item and resubmit.`,
          }, 400);
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

        // Price echo — resolve any missing unit_cost from /pricing/v2/prices
        const ts = Date.now();
        const priceMap = new Map<string, number>();
        const needsPrice = items.filter((i: any) => !(Number(i.unit_cost) > 0));
        if (needsPrice.length && shipToNumber && branchNumber) {
          try {
            const priceEndpoint = `${cfg.apiBase}/pricing/v2/prices`;
            const pricePayload = {
              requestId: `PITCH-PRICE-${ts}`,
              shipToNumber,
              branchNumber,
              purpose: "ordering",
              lines: needsPrice.map((i: any, idx: number) => ({
                id: String(idx + 1),
                itemNumber: (i.abc_item_code || i.srs_item_code || i.item_name).toString(),
                quantity: Number(i.quantity) || 1,
                uom: String(i.unit).toUpperCase(),
              })),
            };
            const pr = await callAbc(tok.token, "POST", priceEndpoint, pricePayload);
            const pj: any = pr.json;
            const respLines = Array.isArray(pj?.lines)
              ? pj.lines
              : Array.isArray(pj)
                ? (pj[0]?.lines ?? [])
                : [];
            for (const rl of respLines) {
              const itemNum = String(rl?.itemNumber ?? "").trim();
              const price = Number(rl?.unitPrice?.value ?? rl?.unitPrice ?? rl?.netPrice ?? rl?.price);
              if (itemNum && Number.isFinite(price) && price > 0) priceMap.set(itemNum, price);
            }
          } catch (_e) { /* non-fatal */ }
        }

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

        // Jobsite contact (DC) for branch driver
        const jc = body.jobsite_contact || {};
        const jobsiteContacts: Array<Record<string, unknown>> = [];
        if (jc.name || jc.phone || jc.email) {
          const phoneDigits = String(jc.phone || "").replace(/\D/g, "");
          jobsiteContacts.push({
            functionCode: "DC",
            name: String(jc.name || body.customer_name || "Jobsite Contact").slice(0, 60),
            email: jc.email ? String(jc.email).slice(0, 80) : "",
            phones: phoneDigits ? [{ number: phoneDigits, type: "WORK", ext: "" }] : [],
          });
        }

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
            ...(jobsiteContacts.length ? { contacts: jobsiteContacts } : {}),
          },
          orderComments: body.notes
            ? [{ code: "H", description: String(body.notes).slice(0, 500) }]
            : [],
          lines: items.map((i: any, idx: number) => {
            const itemNumber = (i.abc_item_code || i.srs_item_code || i.item_name).toString();
            const uom = String(i.unit).toUpperCase();
            const resolvedPrice = Number(i.unit_cost) > 0
              ? Number(i.unit_cost)
              : (priceMap.get(itemNumber) ?? 0);
            return {
              id: idx + 1,
              itemNumber,
              itemDescription: i.description || i.item_name,
              orderedQty: { value: Number(i.quantity), uom },
              unitPrice: { value: resolvedPrice, uom },
            };
          }),
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

    // ---------------- register_webhook ----------------
    if (action === "register_webhook") {
      if (!userId) return json({ success: false, error: "unauthenticated_user" }, 401);
      if (!tenant_id) return json({ success: false, error: "missing_tenant_id" }, 400);

      const tl = await getValidAccessToken(supabase, tenant_id, env);
      if (tl.error || !tl.token) {
        return json({ success: false, error: tl.error || "no_token" }, 400);
      }

      // 1. Insert a local pending row so we have a stable id for the callback URL.
      const callbackBase = `${SUPABASE_URL}/functions/v1/supplier-webhook/abc/events`;
      const events = ["ORDER_UPDATE", "ORDER_INVOICED"];
      const { data: pending, error: pendErr } = await supabase
        .from("abc_webhooks")
        .insert({
          tenant_id,
          integration_id: tl.integration_id ?? null,
          webhook_type: "ORDER",
          events,
          url: "", // filled after we know our row id
          status: "pending",
          environment: env,
          raw_payload: {},
        })
        .select("id")
        .single();
      if (pendErr || !pending) {
        return json({ success: false, error: pendErr?.message || "pending_insert_failed" }, 500);
      }

      const localId = (pending as any).id as string;
      const callbackUrl = `${callbackBase}/${localId}`;

      // 2. Patch pending row with its callback URL so it's recoverable even if ABC call fails.
      await supabase.from("abc_webhooks").update({ url: callbackUrl }).eq("id", localId);

      // 3. Register with ABC.
      const abcUrl = `${cfg.apiBase}/notification/v2/webhooks`;
      const regBody = { type: "ORDER", events, url: callbackUrl };
      const callStart = Date.now();
      const r = await callAbc(tl.token, "POST", abcUrl, regBody);
      const duration = Date.now() - callStart;

      // Redacted audit: never log the secret itself.
      await auditCall(supabase, {
        tenant_id,
        environment: env,
        action: "register_webhook",
        endpoint: abcUrl,
        request_body_redacted: regBody,
        status_code: r.status,
        response_body: r.ok
          ? { ok: true, webhook_id: r.json?.id || r.json?.webhookId, secret_stored: !!r.json?.secret }
          : { error: mapAbcError(r.status, r.json), upstream_status: r.status },
        error_code: r.ok ? null : mapAbcError(r.status, r.json),
        duration_ms: duration,
        created_by: userId,
      });

      if (!r.ok) {
        await supabase
          .from("abc_webhooks")
          .update({ status: "error", raw_payload: { error: r.json ?? r.text } })
          .eq("id", localId);
        return json({
          success: false,
          error: "abc_register_failed",
          status: r.status,
          error_code: mapAbcError(r.status, r.json),
          interpretation: interpretAbcError(mapAbcError(r.status, r.json), r.status, r.json),
        }, 200);
      }

      const abcWebhookId = r.json?.id || r.json?.webhookId || null;
      const abcSecret = r.json?.secret || r.json?.apiKey || null;

      if (!abcSecret) {
        // ABC docs: secret is returned ONCE. If missing, mark error so user can retry.
        await supabase
          .from("abc_webhooks")
          .update({ status: "error", raw_payload: { warning: "no_secret_in_response", response: r.json } })
          .eq("id", localId);
        return json({
          success: false,
          error: "no_secret_returned",
          interpretation: "ABC did not return a webhook secret. Delete this registration and try again.",
        }, 200);
      }

      // 4. Store immediately (secret is single-use from ABC's side).
      await supabase
        .from("abc_webhooks")
        .update({
          webhook_id: abcWebhookId,
          secret: abcSecret,
          status: "active",
          active_since: new Date().toISOString(),
          raw_payload: { registered_response: { ...r.json, secret: "[REDACTED]" } },
        })
        .eq("id", localId);

      return json({
        success: true,
        registration_id: localId,
        abc_webhook_id: abcWebhookId,
        callback_url: callbackUrl,
        events,
        environment: env,
        secret_stored: true,
      });
    }

    // ---------------- list_webhooks ----------------
    if (action === "list_webhooks") {
      if (!tenant_id) return json({ success: false, error: "missing_tenant_id" }, 400);
      const { data, error } = await supabase
        .from("abc_webhooks")
        .select("id, webhook_id, status, environment, events, url, active_since, last_event_received_at, created_at, updated_at")
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, webhooks: data ?? [], secret_stored_note: "Secret never returned to client." });
    }

    // ---------------- sync_accounts ----------------
    // Post-OAuth hydration: pulls Ship-To accounts (accountType=ship-to) and
    // their branches into abc_ship_to_accounts / abc_account_branches /
    // abc_branches so the setup wizard has real options. Ship-Tos with
    // empty branches[] are SKIPPED per Sandy's required setup flow.
    if (action === "sync_accounts") {
      const { data: conn } = await supabase
        .from("abc_connections")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("environment", env)
        .maybeSingle();
      const connectionId = (conn as any)?.id ?? null;

      const accountSearchPath = Deno.env.get("ABC_ACCOUNT_SEARCH_PATH") || "/account/v1/search/accounts";
      const shipToPath = Deno.env.get("ABC_SHIPTO_PATH") || "/account/v1/shiptos";

      const accountsPayload = {
        filters: [{ field: "accountType", op: "eq", value: "ship-to" }],
        pagination: { itemsPerPage: 100, pageNumber: 1 },
      };
      const accountsEndpoint = `${cfg.apiBase}${accountSearchPath}`;
      const accountsResp = await callAbc(tok.token, "POST", accountsEndpoint, accountsPayload);
      await auditCall(supabase, {
        tenant_id, environment: env, action, endpoint: accountsEndpoint,
        request_body_redacted: accountsPayload,
        status_code: accountsResp.status, response_body: accountsResp.json ?? accountsResp.text,
        error_code: accountsResp.ok ? null : mapAbcError(accountsResp.status, accountsResp.json),
        duration_ms: Date.now() - startedAt, created_by: userId,
      });
      if (!accountsResp.ok) {
        const errCode = mapAbcError(accountsResp.status, accountsResp.json);
        await supabase
          .from("abc_connections")
          .update({
            last_error: `sync_accounts.search_accounts ${accountsResp.status}: ${errCode}`.slice(0, 500),
          })
          .eq("tenant_id", tenant_id)
          .eq("environment", env);
        return json({
          success: false,
          stage: "search_accounts",
          status: accountsResp.status,
          error: errCode,
          body: accountsResp.json ?? accountsResp.text,
        });
      }

      const accountsBody: any = accountsResp.json ?? {};
      const accountRows: any[] = Array.isArray(accountsBody?.accounts)
        ? accountsBody.accounts
        : Array.isArray(accountsBody?.data)
          ? accountsBody.data
          : Array.isArray(accountsBody?.items)
            ? accountsBody.items
            : Array.isArray(accountsBody)
              ? accountsBody
              : [];

      const shipToNumbers = new Set<string>();
      for (const a of accountRows) {
        const candidates = [
          a?.shipToNumber, a?.shipTo?.number, a?.shipTo?.shipToNumber,
          a?.accountNumber, a?.number,
        ];
        for (const c of candidates) {
          if (c == null) continue;
          const s = String(c).trim();
          if (s) shipToNumbers.add(s);
        }
        if (Array.isArray(a?.shipTos)) {
          for (const s of a.shipTos) {
            const v = s?.shipToNumber ?? s?.number ?? s?.id;
            if (v) shipToNumbers.add(String(v).trim());
          }
        }
      }

      const shipToRows: Array<{ ship_to_number: string; payload: any }> = [];
      const branchRowsByNumber = new Map<string, any>();
      const accountBranchRows: Array<{ ship_to_number: string; branch: any }> = [];

      for (const stn of Array.from(shipToNumbers).slice(0, 50)) {
        const endpoint = `${cfg.apiBase}${shipToPath}/${encodeURIComponent(stn)}`;
        const r = await callAbc(tok.token, "GET", endpoint);
        if (!r.ok) continue;
        const payload = (r.json ?? {}) as any;
        shipToRows.push({ ship_to_number: stn, payload });
        const branches: any[] = Array.isArray(payload?.branches)
          ? payload.branches
          : Array.isArray(payload?.shipTo?.branches)
            ? payload.shipTo.branches
            : [];
        for (const b of branches) {
          const bn = String(b?.number ?? b?.branchNumber ?? "").trim();
          if (!bn) continue;
          accountBranchRows.push({ ship_to_number: stn, branch: { ...b, branchNumber: bn } });
          if (!branchRowsByNumber.has(bn)) branchRowsByNumber.set(bn, b);
        }
      }

      const shipToNumbersWithBranches = new Set<string>(
        accountBranchRows.map((r) => r.ship_to_number),
      );
      const skippedNoBranches = shipToRows.filter(
        (r) => !shipToNumbersWithBranches.has(r.ship_to_number),
      ).length;
      const shipToUpserts = shipToRows
        .filter((r) => shipToNumbersWithBranches.has(r.ship_to_number))
        .map(({ ship_to_number, payload }) => {
          const st = payload?.shipTo ?? payload ?? {};
          const addr = st?.address ?? st?.shippingAddress ?? {};
          return {
            connection_id: connectionId,
            tenant_id,
            user_id: userId,
            ship_to_number,
            name: st?.name ?? st?.shipToName ?? null,
            address_line1: addr?.line1 ?? addr?.addressLine1 ?? null,
            address_line2: addr?.line2 ?? addr?.addressLine2 ?? null,
            city: addr?.city ?? null,
            state: addr?.state ?? addr?.stateCode ?? null,
            postal_code: addr?.postalCode ?? addr?.zip ?? null,
            country: addr?.country ?? addr?.countryCode ?? null,
            contacts: st?.contacts ?? null,
            raw: payload,
          };
        });

      const shipToIdByNumber = new Map<string, string>();
      if (shipToUpserts.length && connectionId) {
        const { data: upserted } = await supabase
          .from("abc_ship_to_accounts")
          .upsert(shipToUpserts, { onConflict: "connection_id,ship_to_number" })
          .select("id, ship_to_number");
        for (const row of (upserted ?? []) as any[]) {
          shipToIdByNumber.set(row.ship_to_number, row.id);
        }
      }

      if (accountBranchRows.length && shipToIdByNumber.size) {
        const branchUpserts = accountBranchRows
          .map(({ ship_to_number, branch }) => {
            const ship_to_id = shipToIdByNumber.get(ship_to_number);
            if (!ship_to_id) return null;
            const addr = branch?.address ?? {};
            return {
              ship_to_id,
              tenant_id,
              user_id: userId,
              branch_number: String(branch.branchNumber),
              name: branch?.name ?? null,
              address_line1: addr?.line1 ?? addr?.addressLine1 ?? null,
              city: addr?.city ?? null,
              state: addr?.state ?? addr?.stateCode ?? null,
              postal_code: addr?.postalCode ?? addr?.zip ?? null,
              is_home_branch: !!(branch?.homeBranch ?? branch?.isHomeBranch),
              is_default: false,
              raw: branch,
            };
          })
          .filter(Boolean) as any[];
        if (branchUpserts.length) {
          await supabase
            .from("abc_account_branches")
            .upsert(branchUpserts, { onConflict: "ship_to_id,branch_number" });
        }
      }

      if (branchRowsByNumber.size) {
        const branchMeta = Array.from(branchRowsByNumber.entries()).map(([bn, b]) => {
          const addr = b?.address ?? {};
          return {
            tenant_id,
            branch_number: bn,
            name: b?.name ?? null,
            storefront: b?.storefront ?? null,
            status: b?.status ?? null,
            city: addr?.city ?? null,
            state: addr?.state ?? addr?.stateCode ?? null,
            postal: addr?.postalCode ?? addr?.zip ?? null,
            country: addr?.country ?? addr?.countryCode ?? null,
            latitude: b?.latitude ?? addr?.latitude ?? null,
            longitude: b?.longitude ?? addr?.longitude ?? null,
            time_zone_code: b?.timeZoneCode ?? null,
            raw_payload: b,
          };
        });
        await supabase
          .from("abc_branches")
          .upsert(branchMeta, { onConflict: "tenant_id,branch_number" });
      }

      await supabase
        .from("abc_connections")
        .update({ last_validated_at: new Date().toISOString(), last_error: null })
        .eq("tenant_id", tenant_id)
        .eq("environment", env);

      return json({
        success: true,
        environment: env,
        ship_to_count: shipToUpserts.length,
        ship_to_total_returned: shipToRows.length,
        ship_to_skipped_no_branches: skippedNoBranches,
        branch_count: branchRowsByNumber.size,
      });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);


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
