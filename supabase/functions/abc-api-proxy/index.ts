// ABC Supply API proxy — uses per-tenant OAuth token (auth_code + PKCE) stored
// in abc_connections, auto-refreshes when expired, and submits real orders.
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

interface ProxyRequest {
  action: "test_connection" | "submit_test_order" | "get_status" | "start_oauth" | "submit_order";
  environment?: "staging" | "sandbox" | "production";
  tenant_id?: string;
  // submit_order payload
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

const AUTH_URLS: Record<Env, string> = {
  sandbox: "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/authorize",
  production: "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/authorize",
};
const DEFAULT_SCOPES =
  "pricing.read order.read order.write product.read account.read location.read notification.read notification.write offline_access";

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

async function getValidAccessToken(
  supabase: ReturnType<typeof createClient>,
  tenant_id: string,
  env: Env,
): Promise<{ token?: string; error?: string; expires_at?: string }> {
  const { data: conn } = await supabase
    .from("abc_connections")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("environment", env)
    .maybeSingle();

  if (!conn || !conn.access_token) {
    return { error: "not_connected" };
  }

  // 60s safety buffer
  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) {
    return { token: conn.access_token, expires_at: conn.expires_at };
  }

  // Refresh inline
  if (!conn.refresh_token) return { error: "expired_no_refresh" };
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
      refresh_token: conn.refresh_token,
      scope: conn.scope ?? "offline_access",
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
  await supabase
    .from("abc_connections")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? conn.refresh_token,
      token_type: json.token_type ?? "Bearer",
      scope: json.scope ?? conn.scope,
      expires_at: newExpires,
      connection_status: "connected",
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("tenant_id", tenant_id)
    .eq("environment", env);

  return { token: json.access_token, expires_at: newExpires };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let requestAction: ProxyRequest["action"] | undefined;

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

    // Resolve tenant_id from JWT if not provided
    let tenant_id = body.tenant_id;
    if (!tenant_id && auth) {
      const { data: userRes } = await authClient.auth.getUser();
      const userId = userRes?.user?.id;
      if (userId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("id", userId)
          .maybeSingle();
        tenant_id = (prof as any)?.tenant_id ?? undefined;
      }
    }

    console.log("abc-api-proxy", { action, env, tenant_id });

    if (action === "start_oauth") {
      if (!auth) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: userRes } = await authClient.auth.getUser();
      const user = userRes?.user;
      if (!user) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!tenant_id) {
        return new Response(JSON.stringify({ error: "tenant_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const envSuffix = env === "production" ? "PRODUCTION" : "SANDBOX";
      const clientId = Deno.env.get(`ABC_CLIENT_ID_${envSuffix}`);
      const authUrl = Deno.env.get(`ABC_AUTHORIZATION_URL_${envSuffix}`) || AUTH_URLS[env];
      const redirectUri =
        Deno.env.get("ABC_REDIRECT_URI") ||
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/abc-oauth-callback`;
      const scopes = Deno.env.get("ABC_SCOPES") || DEFAULT_SCOPES;
      if (!clientId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `ABC_CLIENT_ID_${envSuffix} not configured`,
            interpretation: `No ${env} OAuth Client ID is configured on the server. Add the ABC_CLIENT_ID_${envSuffix} secret in Supabase, then retry.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
            created_by: user.id,
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
        JSON.stringify({ authorization_url: url.toString(), state, redirect_uri: redirectUri, environment: env }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "get_status") {
      if (!tenant_id) {
        return new Response(JSON.stringify({ connected: false, error: "no_tenant" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: conn } = await supabase
        .from("abc_connections")
        .select("connection_status,expires_at,last_refreshed_at,last_validated_at,last_error,scope,environment")
        .eq("tenant_id", tenant_id)
        .eq("environment", env)
        .maybeSingle();
      return new Response(
        JSON.stringify({
          connected: conn?.connection_status === "connected",
          environment: env,
          ...conn,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "test_connection") {
      // Discovery probe
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

      // Try to obtain a real tenant token
      if (!tenant_id) {
        return new Response(
          JSON.stringify({
            success: false,
            environment: env,
            metadata: { ok: metaOk, status: metaStatus, url: cfg.metaUrl },
            interpretation: "No tenant context. Sign in and complete OAuth.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
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
      return new Response(
        JSON.stringify({
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
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "submit_test_order") {
      if (!tenant_id) {
        return new Response(
          JSON.stringify({
            success: false,
            environment: env,
            error: "no_tenant_context",
            interpretation: "Sign in and select a tenant before submitting a test order.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const tok = await getValidAccessToken(supabase, tenant_id, env);
      if (!tok.token) {
        return new Response(
          JSON.stringify({
            success: false,
            environment: env,
            error: tok.error,
            interpretation:
              tok.error === "not_connected"
                ? "Complete ABC OAuth (Begin OAuth Authorization) before submitting an order."
                : `Cannot obtain token: ${tok.error}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const testPayload = {
        sourceSystem: "PITCH",
        purchaseOrderNumber: `PITCH-TEST-${Date.now()}`,
        accountNumber: Deno.env.get("ABC_ACCOUNT_NUMBER") ?? "TEST-ACCOUNT",
        branchCode: Deno.env.get("ABC_DEFAULT_BRANCH") ?? "0001",
        deliveryType: "PICKUP",
        lines: [{ productNumber: "TEST-SHINGLE-001", quantity: 1, unitOfMeasure: "EA" }],
        notes: "PITCH integration sandbox smoke test — please ignore",
      };

      const orderRes = await fetch(`${cfg.apiBase}/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tok.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(testPayload),
      });
      const orderText = await orderRes.text();
      let orderJson: any = null;
      try { orderJson = JSON.parse(orderText); } catch { /* keep text */ }

      try {
        await supabase.from("integration_audit_logs").insert({
          integration: "abc",
          action: "submit_test_order",
          environment: env,
          request_payload: testPayload,
          response_status: orderRes.status,
          response_body: orderJson ?? orderText,
        });
      } catch { /* non-fatal */ }

      return new Response(
        JSON.stringify({
          success: orderRes.ok,
          environment: env,
          tokenIssued: true,
          orderRequest: testPayload,
          orderResponse: { status: orderRes.status, body: orderJson ?? orderText },
          timestamp: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "submit_order") {
      if (!tenant_id) {
        return new Response(
          JSON.stringify({ success: false, error: "no_tenant_context" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const items = (body.items || []).filter(
        (i) => Number(i.quantity) > 0 && (i.abc_item_code || i.srs_item_code || i.item_name),
      );
      if (!items.length) {
        return new Response(
          JSON.stringify({ success: false, error: "no_items", interpretation: "No items to submit." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const tok = await getValidAccessToken(supabase, tenant_id, env);
      if (!tok.token) {
        return new Response(
          JSON.stringify({
            success: false,
            error: tok.error,
            interpretation:
              tok.error === "not_connected"
                ? "Complete ABC OAuth (Begin OAuth Authorization) before submitting an order."
                : `Cannot obtain token: ${tok.error}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: conn } = await supabase
        .from("abc_connections")
        .select("account_number,default_branch_code")
        .eq("tenant_id", tenant_id)
        .eq("environment", env)
        .maybeSingle();

      const accountNumber =
        (conn as any)?.account_number ||
        Deno.env.get("ABC_ACCOUNT_NUMBER") ||
        "";
      const branchCode = (body.branch_code || (conn as any)?.default_branch_code || "").toString().trim();
      const deliveryType =
        body.delivery_method === "pickup"
          ? "PICKUP"
          : body.delivery_method === "ground_drop"
            ? "GROUND_DROP"
            : "ROOF_LOAD";

      const parseAddr = (raw?: string) => {
        if (!raw) return null;
        const m = raw.match(/^(.*?),\s*(.*?),\s*([A-Z]{2})\s*(\d{5})/i);
        return m
          ? { addressLine1: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), postalCode: m[4] }
          : { addressLine1: raw.trim() };
      };

      const poNumber = `PITCH-${body.job_number || "JOB"}-${Date.now()}`;
      const orderPayload = {
        sourceSystem: "PITCH",
        purchaseOrderNumber: poNumber,
        accountNumber,
        branchCode,
        deliveryType,
        requestedDeliveryDate: body.delivery_date,
        shipTo: parseAddr(body.delivery_address),
        notes: body.notes || (body.customer_name ? `For ${body.customer_name}` : undefined),
        lines: items.map((i, idx) => ({
          lineNumber: idx + 1,
          productNumber: (i.abc_item_code || i.srs_item_code || i.item_name).toString(),
          description: i.description || i.item_name,
          quantity: Number(i.quantity),
          unitOfMeasure: (i.unit || "EA").toUpperCase(),
          color: i.color_specs || undefined,
        })),
      };

      const orderRes = await fetch(`${cfg.apiBase}/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tok.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(orderPayload),
      });
      const orderText = await orderRes.text();
      let orderJson: any = null;
      try { orderJson = JSON.parse(orderText); } catch { /* keep text */ }

      // Audit
      try {
        await supabase.from("integration_audit_logs").insert({
          integration: "abc",
          action: "submit_order",
          environment: env,
          request_payload: orderPayload,
          response_status: orderRes.status,
          response_body: orderJson ?? orderText,
        });
      } catch { /* non-fatal */ }

      // Persist on success
      if (orderRes.ok) {
        try {
          const orderNumber =
            orderJson?.orderNumber || orderJson?.order_number || poNumber;
          const confirmation =
            orderJson?.confirmationNumber || orderJson?.confirmation_number || null;
          const totalAmount =
            Number(orderJson?.totalAmount || orderJson?.total_amount || 0) ||
            items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0);

          const { data: orderRow } = await supabase
            .from("abc_orders")
            .insert({
              tenant_id,
              order_number: orderNumber,
              purchase_order: poNumber,
              confirmation_number: confirmation,
              order_status: orderJson?.status || "submitted",
              branch_number: branchCode || null,
              sold_to_number: accountNumber || null,
              ship_to_number: accountNumber || null,
              ordered_on: new Date().toISOString().slice(0, 10),
              delivery_requested_for: body.delivery_date || null,
              total_amount: totalAmount,
              currency: "USD",
              source: "pitch",
              raw_payload: { request: orderPayload, response: orderJson ?? orderText },
            })
            .select("id")
            .single();

          if (orderRow?.id) {
            await supabase.from("abc_order_lines").insert(
              items.map((i, idx) => ({
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
          console.error("abc submit_order persist error", persistErr);
        }
      }

      return new Response(
        JSON.stringify({
          success: orderRes.ok,
          environment: env,
          orderRequest: orderPayload,
          orderResponse: { status: orderRes.status, body: orderJson ?? orderText },
          purchaseOrderNumber: poNumber,
          abcOrderNumber: orderJson?.orderNumber || null,
          timestamp: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("abc-api-proxy error:", error);
    // Robustly extract a human message from Error, PostgrestError, FetchError,
    // plain objects, etc. (avoids the "[object Object]" toast bug)
    const serializeErr = (e: unknown): string => {
      if (!e) return "unknown error";
      if (typeof e === "string") return e;
      if (e instanceof Error) return e.message;
      const anyE = e as any;
      const parts = [
        anyE.message,
        anyE.error_description,
        anyE.error,
        anyE.details,
        anyE.hint,
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
});
