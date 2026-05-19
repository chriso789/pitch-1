import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SRS_STAGING_URL = "https://services-qa.roofhub.pro";
const SRS_PRODUCTION_URL = "https://services.roofhub.pro";
// Identifier assigned to us by SRS (Angel Perez, 5/14/2026 onboarding email).
// Sent on every authenticated SRS call so SRS can attribute traffic to PITCH.
const SRS_SOURCE_SYSTEM = "PITCH";

/**
 * Build the SRS /orders/v2/submit payload.
 * Spec aligned with the RoofHub sample shared by Jessica Zapata (2026-05-18):
 *  - top-level `notes`, `accountNumber` (string), `shipToSequenceNumber`
 *  - structured `shipTo` { addressLine1/2/3, city, state, zipCode }
 *  - poDetails: { poNumber, reference, jobNumber, orderDate,
 *                 expectedDeliveryDate, expectedDeliveryTime,
 *                 orderType:"WHSE", shippingMethod (label e.g. "Ground Drop") }
 *  - orderLineItemDetails: { productId (number), productName, option,
 *                            quantity, uom, customerItem }
 *      → SRS prices the order from their catalog; we do NOT send `price`.
 *  - customerContactInfo: structured object with nested address +
 *    additionalContactEmails[].
 */

type SrsShipTo = {
  addressLine1?: string; addressLine2?: string; addressLine3?: string;
  city?: string; state?: string; zipCode?: string;
};

type SrsCustomerContact = {
  customerContactName?: string;
  customerContactPhone?: string;
  customerContactEmail?: string;
  customerContactAddress?: {
    addressLine1?: string; city?: string; state?: string; zipCode?: string;
  };
  additionalContactEmails?: string[];
};

type SrsLineItem = {
  productId: number | string;
  productName?: string;
  option?: string;
  quantity: number;
  uom: string;
  customerItem?: string;
};

function buildSubmitOrderPayload(args: {
  sourceSystem: string;
  customerCode: string;
  accountNumber?: string | null;          // string form of S046834
  jobAccountNumber?: number | null;       // numeric (kept for legacy callers)
  shipToSequenceNumber?: number;          // default 1
  branchCode: string;
  poNumber: string;
  reference?: string | null;
  jobNumber?: string | null;
  orderDate?: string | null;              // YYYY-MM-DD
  expectedDeliveryDate?: string | null;   // YYYY-MM-DD
  expectedDeliveryTime?: string | null;   // e.g. "Anytime"
  shippingMethod: string;                 // label e.g. "Ground Drop", "Will Call", "Delivery"
  shipTo?: SrsShipTo | null;
  customerContact?: SrsCustomerContact | null;
  notes?: string | null;
  items: SrsLineItem[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const payload: Record<string, unknown> = {
    sourceSystem: args.sourceSystem,
    customerCode: args.customerCode,
    shipToSequenceNumber: args.shipToSequenceNumber ?? 1,
    branchCode: args.branchCode,
    accountNumber: String(args.accountNumber ?? args.customerCode ?? "").trim(),
    transactionID: crypto.randomUUID(),
    transactionDate: new Date().toISOString(),
    notes: args.notes ?? "",
    shipTo: args.shipTo ?? {
      addressLine1: "", addressLine2: "", addressLine3: "",
      city: "", state: "", zipCode: "",
    },
    poDetails: {
      poNumber: args.poNumber,
      reference: args.reference ?? "",
      jobNumber: args.jobNumber ?? "",
      orderDate: args.orderDate ?? today,
      expectedDeliveryDate: args.expectedDeliveryDate ?? today,
      expectedDeliveryTime: args.expectedDeliveryTime ?? "Anytime",
      orderType: "WHSE",
      shippingMethod: args.shippingMethod,
    },
    orderLineItemDetails: args.items.map((i) => {
      const numericId = Number(i.productId);
      return {
        productId: Number.isFinite(numericId) ? numericId : i.productId,
        productName: i.productName ?? "",
        option: i.option ?? "",
        quantity: Number(i.quantity),
        uom: String(i.uom || "EA").trim(),
        customerItem: i.customerItem ?? "",
      };
    }),
    customerContactInfo: args.customerContact ?? {},
  };
  // jobAccountNumber kept only when present — some SRS flows still echo it.
  if (args.jobAccountNumber != null && !Number.isNaN(Number(args.jobAccountNumber))) {
    payload.jobAccountNumber = Number(args.jobAccountNumber);
  }
  return payload;
}

/** Map our internal delivery_method codes to SRS shipping-method labels. */
function srsShippingMethodLabel(internal: string | null | undefined): string {
  switch ((internal || "").toLowerCase()) {
    case "pickup":
    case "wc":
    case "will_call":
      return "Will Call";
    case "ground_drop":
    case "drop":
      return "Ground Drop";
    case "roof_load":
    case "rooftop":
      return "Roof Load";
    case "delivery":
    case "del":
    default:
      return "Delivery";
  }
}

/** Best-effort parse of a freeform single-line address into structured shipTo. */
function parseShipToFreeform(address: string | null | undefined): SrsShipTo {
  if (!address) return { addressLine1: "", addressLine2: "", addressLine3: "", city: "", state: "", zipCode: "" };
  // Format expected: "123 Main St, City, ST 12345"
  const m = address.match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)\s*$/);
  if (m) {
    return { addressLine1: m[1].trim(), addressLine2: "", addressLine3: "", city: m[2].trim(), state: m[3].toUpperCase(), zipCode: m[4] };
  }
  return { addressLine1: address.trim(), addressLine2: "", addressLine3: "", city: "", state: "", zipCode: "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null;
  const userAgent = req.headers.get("user-agent") || null;

  // Resolve caller identity from JWT (best-effort)
  let actorUserId: string | null = null;
  let actorEmail: string | null = null;
  try {
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) { actorUserId = user.id; actorEmail = user.email ?? null; }
    }
  } catch (_) { /* anonymous call ok */ }

  async function audit(args: {
    tenant_id: string;
    connection_id?: string | null;
    action: string;
    success?: boolean;
    error?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await supabase.from("srs_credential_audit").insert({
        tenant_id: args.tenant_id,
        connection_id: args.connection_id ?? null,
        action: args.action,
        actor_user_id: actorUserId,
        actor_email: actorEmail,
        ip_address: ip,
        user_agent: userAgent,
        success: args.success ?? true,
        error: args.error ?? null,
        metadata: args.metadata ?? {},
      });
    } catch (e) {
      console.warn("audit log failed:", e);
    }
  }

  try {
    const body = await req.json();
    const { action, tenant_id, ...params } = body;

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ------------------------------------------------------------------
    // Credential write actions: must run BEFORE we require an existing row.
    // ------------------------------------------------------------------
    if (action === "save_credentials" || action === "rotate_credentials") {
      const { client_id, client_secret, customer_code, environment } = params as Record<string, string>;
      if (!client_id || !client_secret) {
        await audit({ tenant_id, action, success: false, error: "missing client_id/client_secret" });
        return new Response(JSON.stringify({ error: "client_id and client_secret required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const last4 = client_secret.trim().slice(-4);
      const nowIso = new Date().toISOString();

      const { data: existing } = await supabase
        .from("srs_connections").select("id").eq("tenant_id", tenant_id).maybeSingle();

      const payload: Record<string, unknown> = {
        tenant_id,
        client_id: client_id.trim(),
        client_secret: client_secret.trim(),
        client_secret_last_four: last4,
        client_secret_rotated_at: nowIso,
        customer_code: (customer_code || "").trim() || null,
        environment: environment || "staging",
        connection_status: "disconnected",
        access_token: null,
        token_expires_at: null,
        valid_indicator: false,
        last_error: null,
      };

      let connId: string | null = existing?.id ?? null;
      if (existing) {
        const { error } = await supabase.from("srs_connections").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("srs_connections").insert(payload).select("id").single();
        if (error) throw error;
        connId = data.id;
      }
      await audit({ tenant_id, connection_id: connId, action, success: true, metadata: { last_four: last4, environment } });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "revoke_credentials") {
      const { data: existing } = await supabase
        .from("srs_connections").select("id").eq("tenant_id", tenant_id).maybeSingle();
      if (existing) {
        await supabase.from("srs_connections").update({
          client_secret: null,
          client_secret_last_four: null,
          access_token: null,
          token_expires_at: null,
          connection_status: "disconnected",
          valid_indicator: false,
          last_error: "Credentials revoked",
        }).eq("id", existing.id);
      }
      await audit({ tenant_id, connection_id: existing?.id ?? null, action: "revoke", success: true });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load SRS connection for this tenant (all other actions require it)
    const { data: connection, error: connErr } = await supabase
      .from("srs_connections")
      .select("*")
      .eq("tenant_id", tenant_id)
      .single();

    if (connErr || !connection) {
      return new Response(
        JSON.stringify({ error: "SRS connection not configured" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const getBaseUrl = () => connection.environment === "production" ? SRS_PRODUCTION_URL : SRS_STAGING_URL;

    // Helper to get valid access token
    async function getAccessToken(): Promise<string> {
      // Check if existing token is still valid (with 5 min buffer)
      if (connection.access_token && connection.token_expires_at) {
        const expiresAt = new Date(connection.token_expires_at);
        if (expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
          return connection.access_token;
        }
      }

      const clientId = String(connection.client_id || "").trim();
      const clientSecret = String(connection.client_secret || "").trim();
      if (!clientId || !clientSecret) {
        throw new Error("Missing client_id or client_secret in saved SRS connection. Re-enter and save credentials.");
      }

      // SRS SIPS /authentication/token. Try JSON first, fall back to
      // form-encoded if SRS rejects the JSON payload (some tenants/environments
      // accept only application/x-www-form-urlencoded for the OAuth token call).
      const jsonBody = JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "ALL",
      });
      const formBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "ALL",
      }).toString();

      let tokenResp = await fetch(`${getBaseUrl()}/authentication/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: jsonBody,
      });

      if (!tokenResp.ok) {
        const firstErr = await tokenResp.text();
        console.warn(`SRS token JSON attempt failed [${tokenResp.status}]: ${firstErr}. Retrying as form-encoded.`);
        tokenResp = await fetch(`${getBaseUrl()}/authentication/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: formBody,
        });

        if (!tokenResp.ok) {
          const errText = await tokenResp.text();
          throw new Error(`Auth failed [${tokenResp.status}]: ${errText}. Confirm the selected environment matches these SRS credentials.`);
        }
      }

      const tokenData = await tokenResp.json();
      const newToken = tokenData.access_token;
      const expiresIn = tokenData.expires_in || 86400;
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Save token
      await supabase
        .from("srs_connections")
        .update({ access_token: newToken, token_expires_at: expiresAt })
        .eq("id", connection.id);

      await audit({ tenant_id, connection_id: connection.id, action: "token_fetch", success: true, metadata: { expires_at: expiresAt } });
      return newToken;
    }

    // Helper for authenticated API calls
    async function srsApiCall(path: string, method = "GET", reqBody?: any): Promise<any> {
      const token = await getAccessToken();
      const opts: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Source-System": SRS_SOURCE_SYSTEM,
          "X-Source-System": SRS_SOURCE_SYSTEM,
        },
      };
      if (reqBody) opts.body = JSON.stringify(reqBody);

      const resp = await fetch(`${getBaseUrl()}${path}`, opts);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`SRS API error [${resp.status}]: ${errText}`);
      }
      return resp.json();
    }

    let result: any;

    switch (action) {
      case "validate_connection": {
        try {
          // If caller passed an environment, persist it before validating so the dropdown selection sticks
          const envParam = (params as Record<string, string>).environment;
          if (envParam && (envParam === "production" || envParam === "staging") && envParam !== connection.environment) {
            const { error: envUpdateError } = await supabase.from("srs_connections").update({
              environment: envParam,
              access_token: null,
              token_expires_at: null,
            }).eq("id", connection.id);
            if (envUpdateError) throw envUpdateError;
            connection.environment = envParam;
            connection.access_token = null;
            connection.token_expires_at = null;
          }

          await getAccessToken();

          const { invoice_number, invoice_date, billed_amount, integration_key } = params as Record<string, string>;
          if (!integration_key && (!invoice_number || (!invoice_date && !billed_amount))) {
            const msg = "SRS requires either an Integration Key OR Invoice # plus Invoice Date/Billed Amount to validate the customer account.";
            await supabase.from("srs_connections").update({
              connection_status: "error", last_error: msg, last_validated_at: new Date().toISOString(),
            }).eq("id", connection.id);
            await audit({ tenant_id, connection_id: connection.id, action: "validate", success: false, error: msg });
            result = { success: false, error: msg };
            break;
          }

          // Validate customer (SRS accepts IntegrationKey OR invoice proof of ownership)
          const qs = new URLSearchParams();
          qs.set("accountNumber", String(connection.customer_code || "").trim());
          if (integration_key) qs.set("IntegrationKey", integration_key.trim());
          if (invoice_number) qs.set("InvoiceNumber", invoice_number.trim());
          if (invoice_date) qs.set("InvoiceDate", invoice_date.trim());
          if (billed_amount) qs.set("BilledAmount", billed_amount.trim());
          const validateData = await srsApiCall(`/customers/validate/?${qs.toString()}`);
          console.log(`SRS validate response (env=${connection.environment}, account=${connection.customer_code}, invoice=${invoice_number}):`, JSON.stringify(validateData));

          const isValid = validateData?.validIndicator === "Y" || validateData?.validIndicator === true;
          const validationDetail = isValid
            ? null
            : `SRS rejected validation. Response: ${JSON.stringify(validateData)}. Confirm the Customer Code, Invoice #, Invoice Date and Billed Amount all belong to the ${connection.environment} environment.`;

          // Pull home branch directly from validate response — most reliable source.
          let jobAccountNumber: number | null = null;
          let defaultBranch: string | null = validateData?.homeBranchCode || null;

          if (isValid && connection.customer_code) {
            // Try customerBranchLocations with branchCode (required by SRS) to pull JAN.
            const branchCodeForQuery = defaultBranch || "SRORL";
            try {
              const branchData = await srsApiCall(
                `/branches/v2/customerBranchLocations/${connection.customer_code}?branchCode=${encodeURIComponent(branchCodeForQuery)}`
              );
              if (Array.isArray(branchData) && branchData.length > 0) {
                jobAccountNumber = Number(branchData[0].jobAccountNumber) || null;
                defaultBranch = branchData[0].branchCode || defaultBranch;
              } else if (branchData?.jobAccountNumber) {
                jobAccountNumber = Number(branchData.jobAccountNumber) || null;
                defaultBranch = branchData.branchCode || defaultBranch;
              }
            } catch (e) {
              console.warn("Could not fetch branch locations:", e);
            }
          }

          // Update connection status
          await supabase
            .from("srs_connections")
            .update({
              connection_status: isValid ? "connected" : "error",
              valid_indicator: isValid,
              last_validated_at: new Date().toISOString(),
              last_error: isValid ? null : validationDetail,
              job_account_number: jobAccountNumber,
              default_branch_code: defaultBranch,
            })
            .eq("id", connection.id);

          result = {
            success: isValid,
            jobAccountNumber,
            defaultBranch,
            error: isValid ? undefined : validationDetail,
            srsResponse: validateData,
          };
          await audit({ tenant_id, connection_id: connection.id, action: "validate", success: isValid, error: isValid ? null : validationDetail, metadata: { jobAccountNumber, srsResponse: validateData } });
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          await supabase
            .from("srs_connections")
            .update({
              connection_status: "error",
              last_error: msg,
              last_validated_at: new Date().toISOString(),
            })
            .eq("id", connection.id);

          await audit({ tenant_id, connection_id: connection.id, action: "validate", success: false, error: msg });
          result = { success: false, error: msg };
        }
        break;
      }

      case "sync_branches": {
        // SRS /branches/v2/branchLocations requires BranchCode or lat/long, so
        // we use the customer-scoped endpoint instead (same as validate). It
        // returns the branches this customer can actually order from.
        if (!connection.customer_code) {
          throw new Error("Missing customer_code on connection. Run Test Connection / validate first.");
        }
        const branchData = await srsApiCall(
          `/branches/v2/customerBranchLocations/${encodeURIComponent(connection.customer_code)}`
        );
        const branches = Array.isArray(branchData)
          ? branchData
          : branchData?.customerBranchLocations || branchData?.branchLocations || (branchData ? [branchData] : []);

        // Upsert branches
        for (const branch of branches) {
          const code = branch.branchCode || branch.code || branch.homeBranchCode;
          if (!code) continue;
          await supabase.from("srs_branches").upsert(
            {
              tenant_id,
              branch_code: code,
              branch_name: branch.branchName || branch.name || branch.customerName || code,
              address: branch.address || branch.streetAddress || branch.customerAddress1,
              city: branch.city || branch.customerCity,
              state: branch.state || branch.customerState,
              zip: branch.zip || branch.postalCode || branch.customerZipCode,
              phone: branch.phone || branch.customerPhone,
              shipping_methods: branch.shippingMethods || [],
              cached_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id,branch_code" }
          );
        }

        result = { success: true, branchCount: branches.length };
        break;
      }

      case "get_branches": {
        const { data: branches } = await supabase
          .from("srs_branches")
          .select("*")
          .eq("tenant_id", tenant_id)
          .order("branch_name");

        result = { branches: branches || [] };
        break;
      }

      case "get_products": {
        const { branch_code } = params;
        if (!branch_code) throw new Error("branch_code required");

        const products = await srsApiCall(
          `/branches/v2/activeBranchProducts/${branch_code}`
        );

        result = { products: Array.isArray(products) ? products : products?.products || [] };
        break;
      }

      case "get_pricing": {
        const { branch_code, product_list, job_account_number } = params as Record<string, any>;
        if (!branch_code || !product_list) throw new Error("branch_code and product_list required");
        if (!Array.isArray(product_list) || product_list.length === 0) {
          throw new Error("product_list must be a non-empty array");
        }

        // SRS /products/v2/price requires a NUMERIC JobAccountNumber that came
        // from /branches/v2/customerBranchLocations. customer_code is NOT a
        // valid fallback (SRS will silently strip the call).
        const janRaw = job_account_number ?? connection.job_account_number;
        const jan = typeof janRaw === "number" ? janRaw : Number(janRaw);
        if (!jan || Number.isNaN(jan)) {
          throw new Error("Missing numeric jobAccountNumber. Run validate_connection first so we can pull it from /branches/v2/customerBranchLocations.");
        }

        // Documented body shape per SRS /products/v2/price (2026-05 spec).
        const pricingPayload = {
          sourceSystem: SRS_SOURCE_SYSTEM,
          transactionId: crypto.randomUUID(),
          customerCode: String(connection.customer_code || "").trim(),
          jobAccountNumber: jan,
          branchCode: String(branch_code).trim(),
          productList: product_list.map((p: any) => ({
            productNumber: String(p.productNumber ?? p.product_number ?? p.sku ?? "").trim(),
            quantity: Number(p.quantity ?? p.qty ?? 1),
            uom: String(p.uom ?? p.unitOfMeasure ?? "EA").trim(),
          })),
        };

        const pricing = await srsApiCall("/products/v2/price", "POST", pricingPayload);
        result = { pricing, request: pricingPayload };
        break;
      }

      case "submit_test_order": {
        const branch = String(
          (params as any).branch_code
            || connection.default_branch_code
            || "SRORL",
        ).trim();
        const janRaw = (params as any).job_account_number ?? connection.job_account_number;
        const jan = typeof janRaw === "number" ? janRaw : Number(janRaw);
        const jobAccountNumber = janRaw != null && Number.isFinite(jan) ? jan : null;
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10);

        const orderItems = ((params as any).order_items as any[] | undefined) || [
          { productId: 3473, productName: "Atlas ProLam HP42 Shingles", option: "Black Shadow", quantity: 1, uom: "BD", customerItem: "TEST" },
        ];

        const testShipTo = (params as any).ship_to || {
          addressLine1: "4063 Fonsica Ave",
          addressLine2: "",
          addressLine3: "",
          city: "North Port",
          state: "FL",
          zipCode: "34286",
        };
        const testContact = (params as any).customer_contact || {
          customerContactName: "PITCH Integration Test",
          customerContactPhone: "7708420812",
          customerContactEmail: "test@pitch-crm.ai",
          customerContactAddress: {
            addressLine1: "4063 Fonsica Ave",
            city: "North Port",
            state: "FL",
            zipCode: "34286",
          },
          additionalContactEmails: [],
        };

        const testPayload = buildSubmitOrderPayload({
          sourceSystem: SRS_SOURCE_SYSTEM,
          customerCode: String(connection.customer_code || "").trim(),
          accountNumber: String(connection.customer_code || "").trim(),
          jobAccountNumber,
          shipToSequenceNumber: (params as any).ship_to_sequence_number ?? 1,
          branchCode: branch,
          poNumber: `PITCH-TEST-${Date.now()}`,
          reference: (params as any).reference ?? "",
          jobNumber: (params as any).job_number ?? "",
          orderDate: new Date().toISOString().slice(0, 10),
          expectedDeliveryDate: tomorrow,
          expectedDeliveryTime: (params as any).expected_delivery_time ?? "Anytime",
          shippingMethod: srsShippingMethodLabel((params as any).shipping_method || "will_call"),
          shipTo: testShipTo,
          customerContact: testContact,
          notes: "PITCH integration test order — please ignore",
          items: orderItems,
        });

        let srsResp: any;
        let success = false;
        let errorMsg: string | null = null;
        try {
          srsResp = await srsApiCall("/orders/v2/submit", "POST", testPayload);
          success = true;
        } catch (e: any) {
          errorMsg = e?.message || String(e);
          srsResp = { error: errorMsg };
        }

        await audit({
          tenant_id, connection_id: connection.id, action: "submit_test_order",
          success, error: errorMsg, metadata: { request: testPayload, response: srsResp },
        });

        result = { success, request: testPayload, response: srsResp, error: errorMsg };
        break;
      }

      case "submit_order": {
        const { order_id } = params;
        if (!order_id) throw new Error("order_id required");

        const { data: order } = await supabase
          .from("srs_orders")
          .select("*, srs_order_items(*)")
          .eq("id", order_id)
          .maybeSingle();

        if (!order) throw new Error("Order not found");

        const janRaw = connection.job_account_number;
        const jan = typeof janRaw === "number" ? janRaw : Number(janRaw);
        if (!jan || Number.isNaN(jan)) {
          throw new Error("Missing numeric jobAccountNumber on connection. Run validate_connection first.");
        }

        const orderPayload = buildSubmitOrderPayload({
          sourceSystem: SRS_SOURCE_SYSTEM,
          customerCode: String(connection.customer_code || "").trim(),
          accountNumber: String(connection.customer_code || "").trim(),
          jobAccountNumber: jan,
          shipToSequenceNumber: Number(order.ship_to_sequence_number ?? 1),
          branchCode: String(order.branch_code || connection.default_branch_code || "").trim(),
          // Prefix `job:` so RoofHub webhooks echo back a unique parseable PO.
          poNumber: `job:${order.order_number}`,
          reference: order.reference || "",
          jobNumber: order.job_number || "",
          orderDate: new Date().toISOString().slice(0, 10),
          expectedDeliveryDate: order.delivery_date,
          expectedDeliveryTime: order.delivery_time_window || "Anytime",
          shippingMethod: srsShippingMethodLabel(order.delivery_method),
          shipTo: order.delivery_address ? parseShipToFreeform(order.delivery_address) : null,
          customerContact: order.customer_contact_info || null,
          notes: order.notes,
          items: (order.srs_order_items || []).map((item: any) => ({
            productId: item.srs_product_id,
            productName: item.product_name || item.product_description || "",
            option: item.product_option || "",
            quantity: item.quantity,
            uom: item.uom,
            customerItem: item.customer_item || "",
          })),
        });

        let orderResult: any;
        try {
          orderResult = await srsApiCall("/orders/v2/submit", "POST", orderPayload);
        } catch (e: any) {
          const errMsg = e?.message || String(e);
          // Persist the failure so we can debug w/ SRS (transactionID + payload + error).
          await supabase
            .from("srs_orders")
            .update({
              status: "failed",
              srs_transaction_id: (orderPayload as any).transactionID,
              srs_response: { error: errMsg, request: orderPayload },
            })
            .eq("id", order_id);
          await supabase.from("srs_order_status_history").insert({
            order_id, old_status: "draft", new_status: "failed",
            status_message: `SRS submit failed: ${errMsg}`,
          });
          throw new Error(`SRS submit failed (transactionID=${(orderPayload as any).transactionID}): ${errMsg}`);
        }

        await supabase
          .from("srs_orders")
          .update({
            srs_order_id: orderResult.orderID,
            srs_transaction_id: orderResult.transactionID,
            status: "submitted",
            submitted_at: new Date().toISOString(),
            srs_response: orderResult,
          })
          .eq("id", order_id);

        await supabase.from("srs_order_status_history").insert({
          order_id, old_status: "draft", new_status: "submitted",
          status_message: `Order submitted. SRS Order ID: ${orderResult.orderID}`,
        });

        result = { success: true, srsOrderId: orderResult.orderID, request: orderPayload };
        break;
      }


      case "qa_verify": {
        // Documented 7-step happy-path against the active environment.
        // Read-only unless params.include_submit === true.
        const steps: Array<{ step: string; ok: boolean; detail?: any; error?: string }> = [];
        const safe = async (name: string, fn: () => Promise<any>) => {
          try { const detail = await fn(); steps.push({ step: name, ok: true, detail }); return detail; }
          catch (e: any) { steps.push({ step: name, ok: false, error: e?.message || String(e) }); return null; }
        };

        await safe("1_token", async () => {
          const t = await getAccessToken();
          return { acquired: !!t, expiresAt: connection.token_expires_at };
        });
        await safe("2_validate", async () => {
          const ik = (params as any).integration_key;
          const qs = new URLSearchParams();
          qs.set("accountNumber", String(connection.customer_code || "").trim());
          if (ik) qs.set("IntegrationKey", String(ik).trim());
          const v = await srsApiCall(`/customers/validate/?${qs.toString()}`);
          return { validIndicator: v?.validIndicator };
        });
        await safe("3_branchLocations", async () => {
          const b = await srsApiCall("/branches/v2/branchLocations");
          return { count: Array.isArray(b) ? b.length : (b?.branchLocations?.length ?? 0) };
        });
        const probeBranch = String((params as any).branch_code || connection.default_branch_code || "SRORL");
        const cbl = await safe("4_customerBranchLocations", async () => {
          // SRS requires BranchCode (or lat/lng) as a query parameter on this endpoint.
          const b = await srsApiCall(
            `/branches/v2/customerBranchLocations/${connection.customer_code}?BranchCode=${encodeURIComponent(probeBranch)}`,
          );
          const first = Array.isArray(b) ? b[0] : (b?.customerBranchLocations?.[0] || b);
          const ja = Array.isArray(first?.jobAccounts) ? first.jobAccounts[0] : null;
          return {
            jobAccountNumber: first?.jobAccountNumber ?? ja?.jobAccountNumber ?? null,
            jobAccountName: ja?.jobAccountName ?? null,
            branchCode: first?.branchCode ?? probeBranch,
            branchName: first?.branchName ?? null,
            jobAccountsCount: Array.isArray(first?.jobAccounts) ? first.jobAccounts.length : 0,
          };
        });
        const branchForProbe = String(
          (params as any).branch_code
            || (cbl as any)?.branchCode
            || connection.default_branch_code
            || probeBranch,
        );
        const products = await safe("5_activeBranchProducts", async () => {
          const p = await srsApiCall(`/branches/v2/activeBranchProducts/${branchForProbe}`);
          const list = Array.isArray(p) ? p : (p?.products || []);
          const sample = list[0] || null;
          return {
            count: list.length,
            sampleProductNumber: sample?.productNumber ?? sample?.productId ?? null,
            sampleProductName: sample?.productName ?? null,
          };
        });
        await safe("6_price", async () => {
          const productNumber = String(
            (params as any).product_number
              || (products as any)?.sampleProductNumber
              || "",
          );
          if (!productNumber) throw new Error("No productNumber available for price probe");
          const jan = Number(
            (params as any).job_account_number
              || connection.job_account_number
              || (cbl as any)?.jobAccountNumber
              || 0,
          );
          if (!jan) throw new Error("jobAccountNumber missing (none on connection or customerBranchLocations response)");
          return await srsApiCall("/products/v2/price", "POST", {
            sourceSystem: SRS_SOURCE_SYSTEM,
            transactionId: crypto.randomUUID(),
            customerCode: String(connection.customer_code || "").trim(),
            jobAccountNumber: jan,
            branchCode: branchForProbe,
            productList: [{ productNumber, quantity: 1, uom: "EA" }],
          });
        });
        if ((params as any).include_submit === true) {
          await safe("7_submit", async () => {
            return await srsApiCall("/orders/v2/submit", "POST", buildSubmitOrderPayload({
              sourceSystem: SRS_SOURCE_SYSTEM,
              customerCode: String(connection.customer_code || "").trim(),
              accountNumber: String(connection.customer_code || "").trim(),
              jobAccountNumber: Number(connection.job_account_number),
              shipToSequenceNumber: 1,
              branchCode: branchForProbe,
              poNumber: `PITCH-QA-${Date.now()}`,
              orderDate: new Date().toISOString().slice(0, 10),
              expectedDeliveryDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
              expectedDeliveryTime: "Anytime",
              shippingMethod: "Will Call",
              shipTo: null,
              customerContact: null,
              notes: "PITCH QA verify — please ignore",
              items: [{ productId: 3473, productName: "Atlas ProLam HP42 Shingles", option: "Black Shadow", quantity: 1, uom: "BD", customerItem: "QA" }],
            }));
          });
        } else {
          steps.push({ step: "7_submit", ok: true, detail: "skipped (set include_submit=true to exercise)" });
        }

        const allOk = steps.every((s) => s.ok);
        await audit({
          tenant_id, connection_id: connection.id, action: "qa_verify",
          success: allOk, metadata: { steps, environment: connection.environment },
        });
        result = { success: allOk, environment: connection.environment, steps };
        break;
      }

      case "ping": {
        // Lightweight connection smoke test: forces a token fetch + a simple
        // authenticated GET so we can prove auth + Source-System headers work
        // even when no real invoice exists in the staging dataset.
        const token = await getAccessToken();
        let branchProbe: any = null;
        let branchProbeError: string | null = null;
        try {
          branchProbe = await srsApiCall("/branches/v2/branchLocations");
        } catch (e: any) {
          branchProbeError = e instanceof Error ? e.message : String(e);
        }
        result = {
          success: !!token && !branchProbeError,
          environment: connection.environment,
          baseUrl: getBaseUrl(),
          sourceSystem: SRS_SOURCE_SYSTEM,
          tokenAcquired: !!token,
          tokenExpiresAt: connection.token_expires_at,
          branchProbeOk: !branchProbeError,
          branchProbeError,
          branchCount: Array.isArray(branchProbe) ? branchProbe.length : (branchProbe?.branchLocations?.length ?? null),
        };
        await audit({ tenant_id, connection_id: connection.id, action: "ping", success: result.success, error: branchProbeError, metadata: { environment: connection.environment } });
        break;
      }

      case "get_order_status": {
        const { srs_order_id, transaction_id } = params as Record<string, string>;
        if (!srs_order_id && !transaction_id) {
          throw new Error("srs_order_id or transaction_id required");
        }
        const path = srs_order_id
          ? `/orders/v2/status/${encodeURIComponent(srs_order_id)}`
          : `/orders/v2/status?transactionID=${encodeURIComponent(transaction_id)}`;
        const statusData = await srsApiCall(path);

        // Mirror status into our orders table if we recognize the order
        const matchKey = srs_order_id ? "srs_order_id" : "srs_transaction_id";
        const matchVal = srs_order_id || transaction_id;
        const { data: order } = await supabase
          .from("srs_orders")
          .select("id, status")
          .eq("tenant_id", tenant_id)
          .eq(matchKey, matchVal)
          .maybeSingle();

        if (order && statusData?.status && statusData.status !== order.status) {
          await supabase.from("srs_orders").update({ status: statusData.status }).eq("id", order.id);
          await supabase.from("srs_order_status_history").insert({
            order_id: order.id,
            old_status: order.status,
            new_status: statusData.status,
            status_message: statusData.statusMessage || `Polled status: ${statusData.status}`,
            raw_webhook_data: statusData,
          });
        }

        result = { success: true, status: statusData };
        break;
      }

      case "list_orders": {
        // List recent orders for this tenant (DB-backed; SRS does not expose a
        // tenant-scoped list endpoint — orders are echoed via webhook)
        const { limit = 50 } = params as Record<string, number>;
        const { data: orders } = await supabase
          .from("srs_orders")
          .select("*, srs_order_items(*)")
          .eq("tenant_id", tenant_id)
          .order("created_at", { ascending: false })
          .limit(Math.min(Number(limit) || 50, 200));
        result = { success: true, orders: orders || [] };
        break;
      }

      case "cancel_order": {
        const { order_id } = params as Record<string, string>;
        if (!order_id) throw new Error("order_id required");
        const { data: order } = await supabase
          .from("srs_orders")
          .select("*")
          .eq("id", order_id)
          .eq("tenant_id", tenant_id)
          .single();
        if (!order) throw new Error("Order not found");
        if (!order.srs_order_id) throw new Error("Order has not been submitted to SRS yet");

        const cancelResult = await srsApiCall(
          `/orders/v2/cancel/${encodeURIComponent(order.srs_order_id)}`,
          "POST",
          { reason: (params as any).reason || "Cancelled by user" }
        );

        await supabase.from("srs_orders").update({ status: "cancelled" }).eq("id", order_id);
        await supabase.from("srs_order_status_history").insert({
          order_id,
          old_status: order.status,
          new_status: "cancelled",
          status_message: (params as any).reason || "Cancelled by user",
          raw_webhook_data: cancelResult,
        });
        await audit({ tenant_id, connection_id: connection.id, action: "cancel_order", success: true, metadata: { srs_order_id: order.srs_order_id } });
        result = { success: true, srsResponse: cancelResult };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("SRS API Proxy error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
