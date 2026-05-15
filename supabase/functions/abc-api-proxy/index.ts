// ABC Supply API proxy — handles test_connection and submit_test_order against
// ABC's sandbox OAuth + Partner API using project-level sandbox credentials.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ABC = {
  staging: {
    tokenUrl:
      "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token",
    metaUrl:
      "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/.well-known/oauth-authorization-server",
    apiBase: "https://partners-sb.abcsupply.com/api",
  },
  production: {
    tokenUrl:
      "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token",
    metaUrl:
      "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/.well-known/oauth-authorization-server",
    apiBase: "https://partners.abcsupply.com/api",
  },
};

interface ProxyRequest {
  action: "test_connection" | "submit_test_order";
  environment?: "staging" | "production";
}

async function getCreds(env: "staging" | "production") {
  if (env === "production") {
    return {
      clientId: Deno.env.get("ABC_CLIENT_ID") ?? "",
      clientSecret: Deno.env.get("ABC_CLIENT_SECRET") ?? "",
    };
  }
  return {
    clientId: Deno.env.get("ABC_CLIENT_ID_SANDBOX") ?? "",
    clientSecret: Deno.env.get("ABC_CLIENT_SECRET_SANDBOX") ?? "",
  };
}

async function tryClientCredentialsToken(env: "staging" | "production") {
  const { tokenUrl } = ABC[env];
  const { clientId, clientSecret } = await getCreds(env);
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      step: "credentials",
      error: `Missing ABC ${env} client_id / client_secret in project secrets.`,
    };
  }
  const basic = btoa(`${clientId}:${clientSecret}`);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "pricing.read product.read account.read",
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return {
    ok: res.ok,
    step: "token",
    status: res.status,
    response: json ?? text,
    clientIdLast4: clientId.slice(-4),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { action, environment = "staging" } = (await req.json()) as ProxyRequest;
    const env = environment === "production" ? "production" : "staging";
    const cfg = ABC[env];

    console.log("abc-api-proxy", { action, env });

    if (action === "test_connection") {
      // Step 1: hit the OAuth discovery doc — proves DNS/network/issuer reachable.
      let metaOk = false;
      let metaStatus = 0;
      try {
        const metaRes = await fetch(cfg.metaUrl);
        metaStatus = metaRes.status;
        metaOk = metaRes.ok;
        await metaRes.text();
      } catch (e) {
        metaOk = false;
      }

      // Step 2: attempt a client_credentials token grant with the sandbox secrets.
      // ABC primarily issues authorization_code + PKCE — client_credentials may be
      // rejected, but the response still tells us whether ABC recognises our client.
      const tokenResult = await tryClientCredentialsToken(env);

      const recognised =
        tokenResult.ok ||
        (tokenResult.response &&
          typeof tokenResult.response === "object" &&
          // Okta returns these when it knows the client but rejects the grant/scope/policy
          [
            "unsupported_grant_type",
            "invalid_grant",
            "invalid_scope",
            "access_denied", // policy blocks client_credentials — expected for PKCE-only clients
          ].includes((tokenResult.response as any).error));

      return new Response(
        JSON.stringify({
          success: !!recognised,
          environment: env,
          metadata: { ok: metaOk, status: metaStatus, url: cfg.metaUrl },
          token: tokenResult,
          interpretation: tokenResult.ok
            ? "Client credentials accepted — access token issued."
            : recognised
            ? "ABC recognised the client but rejected the grant type. Credentials are valid; full access requires the user-driven authorization_code + PKCE flow."
            : "ABC did not recognise the client. Verify ABC_CLIENT_ID_SANDBOX / ABC_CLIENT_SECRET_SANDBOX and that ABC has provisioned this client.",
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (action === "submit_test_order") {
      // Best-effort sandbox order submission. Without an access token we cannot
      // actually call the order endpoint, so we attempt client_credentials, then
      // POST a minimal payload to /orders for the audit trail. ABC will reject
      // with an auth error if no token is available — that's the expected state
      // until a tenant completes the OAuth authorization_code flow.
      const tokenResult = await tryClientCredentialsToken(env);
      const accessToken = (tokenResult.response as any)?.access_token;

      const testPayload = {
        sourceSystem: "PITCH",
        purchaseOrderNumber: `PITCH-TEST-${Date.now()}`,
        accountNumber: Deno.env.get("ABC_ACCOUNT_NUMBER") ?? "TEST-ACCOUNT",
        branchCode: Deno.env.get("ABC_DEFAULT_BRANCH") ?? "0001",
        deliveryType: "PICKUP",
        lines: [
          {
            productNumber: "TEST-SHINGLE-001",
            quantity: 1,
            unitOfMeasure: "EA",
          },
        ],
        notes: "PITCH integration sandbox smoke test — please ignore",
      };

      const orderRes = await fetch(`${cfg.apiBase}/orders`, {
        method: "POST",
        headers: {
          Authorization: accessToken ? `Bearer ${accessToken}` : "Bearer none",
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Source-System": "PITCH",
        },
        body: JSON.stringify(testPayload),
      });
      const orderText = await orderRes.text();
      let orderJson: any = null;
      try {
        orderJson = JSON.parse(orderText);
      } catch {
        /* keep text */
      }

      // Audit log (best effort)
      try {
        await supabase.from("integration_audit_logs").insert({
          integration: "abc",
          action: "submit_test_order",
          environment: env,
          request_payload: testPayload,
          response_status: orderRes.status,
          response_body: orderJson ?? orderText,
        });
      } catch {
        /* table may not exist — non-fatal */
      }

      return new Response(
        JSON.stringify({
          success: orderRes.ok,
          environment: env,
          tokenIssued: !!accessToken,
          orderRequest: testPayload,
          orderResponse: {
            status: orderRes.status,
            body: orderJson ?? orderText,
          },
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("abc-api-proxy error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
