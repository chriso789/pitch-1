import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { buildSupplierVerifiedInvoice } from "../_shared/supplier-verified-invoice.ts";
import { verifyAuthAndTenant } from "../_shared/auth-tenant.ts";
import { isSrsDebugModeEnabled } from "../_shared/srs/debugMode.ts";


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
  name?: string;
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
  price?: number;
  uom: string;
  customerItem?: string;
};

export function buildSubmitOrderPayload(args: {
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
  orderType?: "WHSE" | "WILLCALL";        // defaults to WHSE
  shippingMethod: string;                 // label e.g. "Ground Drop", "Will Call"
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
      orderType: args.orderType ?? "WHSE",
      shippingMethod: args.shippingMethod,
    },
    // Per SRS spec (Jessica Zapata sample 2026-05-18): submit payload does
    // NOT include `price` on line items. SRS prices server-side from their
    // catalog; sending price triggers price-mismatch rejection.
    orderLineItemDetails: args.items.map((i) => {
      const numericId = Number(i.productId);
      return {
        productId: Number.isFinite(numericId) ? numericId : i.productId,
        productName: i.productName ?? "",
        option: i.option ?? "N/A",
        quantity: Number(i.quantity),
        uom: normalizeUom(i.uom),
        customerItem: i.customerItem ?? "",
      };
    }),

    customerContactInfo: args.customerContact ?? {},
  };
  // NOTE: top-level `jobAccountNumber` removed — not in current SRS spec.
  // SRS resolves the job account from customerCode + shipToSequenceNumber.
  return payload;
}

/** Map internal delivery_method to SRS orderType. Pickup → WILLCALL, all delivery → WHSE. */
function srsOrderType(internal: string | null | undefined): "WHSE" | "WILLCALL" {
  const v = (internal || "").toLowerCase();
  return v === "pickup" || v === "wc" || v === "will_call" ? "WILLCALL" : "WHSE";
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
      throw new Error(
        "Generic 'delivery' is not a valid SRS shippingMethod. " +
        "Choose Roof Load, Ground Drop, or Will Call before submit."
      );
    default:
      throw new Error(`Unknown SRS shipping method: ${internal}`);
  }
}

/**
 * Normalize free-text UOM values from estimate line items into the codes
 * SRS accepts. SRS's async validator silently drops orders with unknown UOMs
 * (e.g. "EACH" instead of "EA"), so this mapping is required before submit.
 */
function normalizeUom(raw: string | null | undefined): string {
  const v = String(raw || "EA").trim().toUpperCase();
  const map: Record<string, string> = {
    "EACH": "EA",
    "EA.": "EA",
    "PC": "PC",
    "PCS": "PC",
    "PIECE": "EA",
    "PIECES": "EA",
    "UNIT": "EA",
    "UNITS": "EA",
    "BOX": "BX",
    "BOXES": "BX",
    "BUNDLE": "BD",
    "BUNDLES": "BD",
    "BDLS": "BD",
    "BDL": "BD",
    "BD": "BD",
    "ROLL": "RL",
    "ROLLS": "RL",
    "SQUARE": "SQ",
    "SQUARES": "SQ",
    "SQS": "SQ",
    "SHEET": "SHT",
    "SHEETS": "SHT",
    "LINEAL FOOT": "LF",
    "LINEAR FOOT": "LF",
    "LINEAL FEET": "LF",
    "LINEAR FEET": "LF",
    "LFT": "LF",
    "FT": "LF",
    "FOOT": "LF",
    "FEET": "LF",
    "GAL": "GA",
    "GALLON": "GA",
    "GALLONS": "GA",
    "PAIL": "PL",
    "PAILS": "PL",
    "BAG": "BG",
    "BAGS": "BG",
    "TUBE": "TB",
    "TUBES": "TB",
  };
  return map[v] || v;
}


function normalizeCustomerBranchLocations(branchData: any): any[] {
  if (Array.isArray(branchData)) return branchData;
  return branchData?.customerBranchLocations || branchData?.branchLocations || (branchData ? [branchData] : []);
}

function extractJobAccountNumber(branch: any): number | null {
  const direct = Number(branch?.jobAccountNumber);
  if (Number.isFinite(direct) && direct > 1) return direct;

  const accounts = Array.isArray(branch?.jobAccounts) ? branch.jobAccounts : [];
  for (const account of accounts) {
    const value = Number(account?.jobAccountNumber);
    if (Number.isFinite(value) && value > 1) return value;
  }

  if (Number.isFinite(direct) && direct > 0) return direct;
  const firstRaw = Number(accounts[0]?.jobAccountNumber);
  return Number.isFinite(firstRaw) && firstRaw > 0 ? firstRaw : null;
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

  // Parse body once so we can read the requested tenant_id for verification.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // SECURITY: never trust body.tenant_id from a user-facing caller. Resolve from JWT +
  // user_company_access. Background workers (poller, pricing-refresh, pricelist-backfill)
  // authenticate with the service-role key and may pass body.tenant_id directly.
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const isServiceRoleCaller = !!SERVICE_ROLE && bearer === SERVICE_ROLE;

  let tenant_id: string;
  let actorUserId: string | null = null;
  let actorEmail: string | null = null;

  if (isServiceRoleCaller) {
    // Trusted internal worker call — body.tenant_id is authoritative.
    const requested = body && typeof body.tenant_id === "string" ? body.tenant_id : null;
    if (!requested) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    tenant_id = requested;
  } else {
    const requestedTenantId = body && typeof body.tenant_id === "string" ? body.tenant_id : null;
    const auth = await verifyAuthAndTenant(req, requestedTenantId);
    if (auth.error) return auth.error;
    tenant_id = auth.tenantId;
    actorUserId = auth.userId;
    try {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) actorEmail = user.email ?? null;
    } catch (_) { /* email best-effort */ }
  }


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
    const { action, tenant_id: _ignoredBodyTenant, ...params } = body;
    // tenant_id is the server-resolved value from auth above; ignore body.tenant_id.


    // ------------------------------------------------------------------
    // Credential write actions: must run BEFORE we require an existing row.
    // ------------------------------------------------------------------
    if (action === "save_credentials" || action === "rotate_credentials") {
      const { client_id, client_secret, customer_code, environment, integration_key, default_branch_code } = params as Record<string, string>;

      // Partner-level Pitch SRS OAuth client (one set of credentials for the
      // whole platform). Per-tenant rows only need customer_code +
      // integration_key (or invoice validation). Developer mode may still
      // pass per-tenant client_id/client_secret to override.
      const envClientId = (Deno.env.get("SRS_CLIENT_ID") || "").trim();
      const envClientSecret = (Deno.env.get("SRS_CLIENT_SECRET") || "").trim();

      const effectiveClientId = (client_id && client_id.trim()) || envClientId;
      const effectiveClientSecret = (client_secret && client_secret.trim()) || envClientSecret;

      if (!effectiveClientId || !effectiveClientSecret) {
        await audit({ tenant_id, action, success: false, error: "missing partner SRS client credentials" });
        return new Response(JSON.stringify({
          error: "SRS connection is temporarily unavailable. Contact support.",
          dev_error: "Pitch SRS platform credentials are not configured. Set SRS_CLIENT_ID and SRS_CLIENT_SECRET in Supabase function secrets.",
          code: "srs_platform_credentials_missing",
        }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!customer_code || !customer_code.trim()) {
        await audit({ tenant_id, action, success: false, error: "missing customer_code" });
        return new Response(JSON.stringify({ error: "Customer Code is required." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const last4 = effectiveClientSecret.slice(-4);
      const nowIso = new Date().toISOString();

      const { data: existing } = await supabase
        .from("srs_connections").select("id, integration_key, default_branch_code").eq("tenant_id", tenant_id).maybeSingle();

      const payload: Record<string, unknown> = {
        tenant_id,
        client_id: effectiveClientId,
        client_secret: effectiveClientSecret,
        client_secret_last_four: last4,
        client_secret_rotated_at: nowIso,
        customer_code: customer_code.trim(),
        environment: environment || "production",
        connection_status: "disconnected",
        access_token: null,
        token_expires_at: null,
        valid_indicator: false,
        last_error: null,
      };

      if (typeof integration_key === "string" && integration_key.trim()) {
        payload.integration_key = integration_key.trim();
      } else if (existing?.integration_key) {
        payload.integration_key = existing.integration_key;
      }
      if (typeof default_branch_code === "string" && default_branch_code.trim()) {
        payload.default_branch_code = default_branch_code.trim().toUpperCase();
      } else if (existing?.default_branch_code) {
        payload.default_branch_code = existing.default_branch_code;
      }

      let connId: string | null = existing?.id ?? null;
      if (existing) {
        const { error } = await supabase.from("srs_connections").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("srs_connections").insert(payload).select("id").single();
        if (error) throw error;
        connId = data.id;
      }
      await audit({ tenant_id, connection_id: connId, action, success: true, metadata: { last_four: last4, environment: payload.environment, integration_key_saved: !!payload.integration_key, default_branch_code: payload.default_branch_code, partner_credentials: !client_id } });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Lightweight settings update — does not touch credentials.
    if (action === "update_connection_settings") {
      const { default_branch_code, integration_key } = params as Record<string, string>;
      const patch: Record<string, unknown> = {};
      if (typeof default_branch_code === "string" && default_branch_code.trim()) {
        patch.default_branch_code = default_branch_code.trim().toUpperCase();
      }
      if (typeof integration_key === "string") {
        patch.integration_key = integration_key.trim() || null;
      }
      if (!Object.keys(patch).length) {
        return new Response(JSON.stringify({ error: "no fields to update" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: existing } = await supabase
        .from("srs_connections").select("id").eq("tenant_id", tenant_id).maybeSingle();
      if (!existing) {
        return new Response(JSON.stringify({ error: "SRS connection not configured" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase.from("srs_connections").update(patch).eq("id", existing.id);
      if (error) throw error;
      await audit({ tenant_id, connection_id: existing.id, action: "update_connection_settings", success: true, metadata: patch });
      return new Response(JSON.stringify({ success: true, patch }), {
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

      // SRS SIPS /authentication/token — form-urlencoded per SRS QA-verified
      // contract (Task 3 of production hardening). JSON kept only as a legacy
      // fallback in case a specific tenant/environment requires it.
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
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: formBody,
      });

      if (!tokenResp.ok) {
        const firstErr = await tokenResp.text();
        console.warn(`SRS token form-encoded attempt failed [${tokenResp.status}]: ${firstErr}. Retrying as JSON (legacy fallback).`);
        tokenResp = await fetch(`${getBaseUrl()}/authentication/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: jsonBody,
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

    const productArrayFromCatalog = (catalogResp: any): any[] =>
      Array.isArray(catalogResp) ? catalogResp : (catalogResp?.products || catalogResp?.data || []);

    const firstCatalogVariant = (product: any, hint = "") => {
      const variants = Array.isArray(product?.productVariant) ? product.productVariant : [];
      const normalizedHint = String(hint || "").toLowerCase().trim();
      if (!normalizedHint) return variants[0] || null;
      // Prefer an exact colorName / selectedOption match, then substring.
      const exact = variants.find((v: any) => {
        const c = String(v?.colorName || "").toLowerCase().trim();
        const o = String(v?.selectedOption || "").toLowerCase().trim();
        return (c && c === normalizedHint) || (o && o === normalizedHint);
      });
      if (exact) return exact;
      const partial = variants.find((v: any) => {
        const c = String(v?.colorName || "").toLowerCase();
        const o = String(v?.selectedOption || "").toLowerCase();
        return (c && normalizedHint.includes(c)) || (o && normalizedHint.includes(o));
      });
      return partial || variants[0] || null;
    };

    const buildCatalogSubmitItem = (item: any, product: any, customerItemFallback: string) => {
      // Prefer the explicit color/option persisted on the order line.
      const colorHint = String(
        item.product_option || item.product_color || item.product_description || item.product_name || ""
      );
      const variant = firstCatalogVariant(product, colorHint);
      const allowedUoms = Array.isArray(variant?.uoMs) ? variant.uoMs.map((u: any) => String(u).toUpperCase()) : [];
      const requestedUom = normalizeUom(item.uom);
      const catalogUom = allowedUoms.includes(requestedUom)
        ? requestedUom
        : String(variant?.defaultUOM || allowedUoms[0] || requestedUom || "EA").toUpperCase();

      // Resolve the SRS `option` (color/style). Priority:
      //   1. explicit product_option/product_color saved with the order line
      //   2. the matched catalog variant's colorName / selectedOption
      //   3. product-level productOptions[0]
      const explicitOption = String(item.product_option || item.product_color || "").trim();
      const variantOption = String(variant?.colorName || variant?.selectedOption || "").trim();
      const productOptions: string[] = Array.isArray(product?.productOptions) ? product.productOptions : [];
      const option = (explicitOption || variantOption || String(productOptions[0] || "")).trim();

      // Guardrail: if SRS lists >1 color/variant on this product and we have
      // no explicit option, refuse to submit rather than silently shipping the
      // wrong color. SRS will price/pick the wrong SKU otherwise.
      const distinctColors = new Set(
        (Array.isArray(product?.productVariant) ? product.productVariant : [])
          .map((v: any) => String(v?.colorName || v?.selectedOption || "").trim().toLowerCase())
          .filter(Boolean),
      );
      if (!explicitOption && distinctColors.size > 1) {
        throw new Error(
          `SRS product "${product?.productName || item.product_name}" has ${distinctColors.size} color/variant options — a color must be selected on the order line before pushing to SRS.`,
        );
      }

      return {
        productId: Number(item.srs_product_id),
        productName: product?.productName || item.product_name || item.product_description || "",
        option: option || "N/A",
        quantity: Number(item.quantity),
        uom: catalogUom,
        customerItem: (item.customer_item && String(item.customer_item).trim()) || customerItemFallback,
      };
    };

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

          const { invoice_number, invoice_date, billed_amount, integration_key: ikRaw } = params as Record<string, string>;
          // Use the supplied key first, fall back to whatever was previously
          // saved on the connection so users don't have to re-paste it.
          // Per SRS SIPS docs, accountNumber alone is sufficient to validate;
          // invoice fields and IntegrationKey are optional sharper proofs of
          // ownership. We no longer require either here — let SRS decide.
          const integration_key = (ikRaw && ikRaw.trim()) || (connection.integration_key && String(connection.integration_key).trim()) || "";


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
            const branchCodeForQuery = defaultBranch || "SRFTL";
            try {
              const branchData = await srsApiCall(
                `/branches/v2/customerBranchLocations/${encodeURIComponent(connection.customer_code)}?BranchCode=${encodeURIComponent(branchCodeForQuery)}`
              );
              const branches = normalizeCustomerBranchLocations(branchData);
              const preferred = branches.find((b: any) => String(b?.branchCode || b?.code || "").toUpperCase() === String(branchCodeForQuery).toUpperCase()) || branches[0];
              if (preferred) {
                jobAccountNumber = extractJobAccountNumber(preferred);
                defaultBranch = preferred.branchCode || preferred.code || defaultBranch;
              }
            } catch (e) {
              console.warn("Could not fetch branch locations:", e);
            }
          }

          // Extract customer/home-branch metadata from SRS validate response.
          const customerNameFromSrs: string | null =
            validateData?.customerName
              || validateData?.customer?.customerName
              || validateData?.name
              || null;

          const connectionUpdate: Record<string, unknown> = {
            connection_status: isValid ? "connected" : "error",
            valid_indicator: isValid,
            last_validated_at: new Date().toISOString(),
            last_error: isValid ? null : validationDetail,
          };
          if (isValid && customerNameFromSrs) {
            connectionUpdate.customer_name = String(customerNameFromSrs).trim();
          }
          if (isValid && defaultBranch) {
            connectionUpdate.home_branch_code = defaultBranch;
          }
          // Persist the integration_key on a successful validation so it
          // can be reused without re-typing.
          if (isValid && ikRaw && ikRaw.trim()) {
            connectionUpdate.integration_key = ikRaw.trim();
          }
          // Only seed default_branch_code from SRS if the user hasn't set one
          // explicitly yet. Once set, preserve the user's override.
          if (defaultBranch && !connection.default_branch_code) {
            connectionUpdate.default_branch_code = defaultBranch;
          }
          if (jobAccountNumber && jobAccountNumber > 1) connectionUpdate.job_account_number = jobAccountNumber;


          // Update connection status without wiping an existing JAN when SRS omits it.
          await supabase
            .from("srs_connections")
            .update(connectionUpdate)
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
        const requestedBranchCode = String((params as any).branch_code || connection.default_branch_code || "SRFTL").trim();
        const branchData = await srsApiCall(
          `/branches/v2/customerBranchLocations/${encodeURIComponent(connection.customer_code)}?BranchCode=${encodeURIComponent(requestedBranchCode)}`
        );
        const branches = normalizeCustomerBranchLocations(branchData);

        // Upsert branches
        const preferredBranchCode = requestedBranchCode.toUpperCase();
        let defaultBranch = connection.default_branch_code || null;
        let jobAccountNumber: number | null = null;
        for (const branch of branches) {
          const code = branch.branchCode || branch.code || branch.homeBranchCode;
          if (!code) continue;
          if (!jobAccountNumber && (String(code).toUpperCase() === preferredBranchCode || !defaultBranch)) {
            jobAccountNumber = extractJobAccountNumber(branch);
            defaultBranch = code;
          }
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

        const connectionPatch: Record<string, unknown> = { default_branch_code: defaultBranch };
        if (jobAccountNumber) connectionPatch.job_account_number = jobAccountNumber;
        if (jobAccountNumber && connection.valid_indicator) {
          connectionPatch.connection_status = "connected";
          connectionPatch.last_error = null;
        }
        connectionPatch.last_sync_at = new Date().toISOString();
        await supabase.from("srs_connections").update(connectionPatch).eq("id", connection.id);

        result = { success: true, branchCount: branches.length, jobAccountNumber, defaultBranch };
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
            || "SRFTL",
        ).trim();

        // ---- Resolve a real numeric jobAccountNumber. ----
        // SRS treats `1` as a placeholder — orders submitted with it are
        // queued (HTTP 200) but silently rejected by their order-placement
        // backend. Refuse to send a stub.
        const janInitialRaw = (params as any).job_account_number ?? connection.job_account_number;
        let jan: number | null = (() => {
          const n = Number(janInitialRaw);
          return Number.isFinite(n) && n > 1 ? n : null;
        })();

        let recoveryDiagnostic: any = null;

        if (!jan) {
          // Auto-recover from /branches/v2/customerBranchLocations.
          try {
            const branchData = await srsApiCall(
              `/branches/v2/customerBranchLocations/${encodeURIComponent(String(connection.customer_code || ""))}?BranchCode=${encodeURIComponent(branch)}`
            );
            const branches = normalizeCustomerBranchLocations(branchData);
            recoveryDiagnostic = { source: "customerBranchLocations", branchCount: branches.length, sample: branches.slice(0, 3) };

            // Look across *every* returned branch for a JAN > 1.
            for (const b of branches) {
              const candidate = extractJobAccountNumber(b);
              if (candidate && candidate > 1) {
                jan = candidate;
                await supabase.from("srs_connections").update({
                  job_account_number: candidate,
                  default_branch_code: b?.branchCode || connection.default_branch_code,
                }).eq("id", connection.id);
                break;
              }
            }
          } catch (e: any) {
            recoveryDiagnostic = { source: "customerBranchLocations", error: e?.message || String(e) };
          }
        }

        if (!jan) {
          const msg =
            `SRS has not assigned a real jobAccountNumber to customer ${connection.customer_code} on branch ${branch} ` +
            `in the ${connection.environment} environment. Their API is returning the placeholder value "1", which causes orders ` +
            `to be queued (HTTP 200) but rejected during downstream order placement. ` +
            `Ask your SRS rep (Jessica) to provision a valid job account number for customer code ${connection.customer_code} on branch ${branch}, ` +
            `then re-run Validate Connection.`;
          await audit({
            tenant_id, connection_id: connection.id, action: "submit_test_order",
            success: false, error: msg,
            metadata: { blocked: true, reason: "missing_real_jan", branch, customerCode: connection.customer_code, recoveryDiagnostic },
          });
          result = { success: false, blocked: true, error: msg, recoveryDiagnostic };
          break;
        }

        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10);

        const orderItems = ((params as any).order_items as any[] | undefined) || [
          { productId: 3473, productName: "Atlas ProLam HP42 Shingles", option: "Black Shadow", quantity: 1, uom: "BD", customerItem: "TEST" },
        ];

        const testShipTo = (params as any).ship_to || {
          name: "PITCH Integration Test",
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
          jobAccountNumber: jan,
          shipToSequenceNumber: (params as any).ship_to_sequence_number ?? 1,
          branchCode: branch,
          poNumber: `PITCH-TEST-${Date.now()}`,
          reference: (params as any).reference ?? "",
          jobNumber: (params as any).job_number ?? "",
          orderDate: new Date().toISOString().slice(0, 10),
          expectedDeliveryDate: tomorrow,
          expectedDeliveryTime: (params as any).expected_delivery_time ?? "Anytime",
          orderType: srsOrderType((params as any).shipping_method || "will_call"),
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
          success, error: errorMsg, metadata: { request: testPayload, response: srsResp, recoveryDiagnostic },
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
        let jan = typeof janRaw === "number" ? janRaw : Number(janRaw);
        // Reject the legacy stub value of 1 — SRS silently queue-drops orders
        // submitted with a placeholder JAN. Force re-validation instead.
        if (jan === 1) {
          jan = NaN;
        }
        if (!jan || Number.isNaN(jan)) {

          // Auto-recover: fetch JAN from customerBranchLocations using the order's branch.
          const branchForLookup = String(order.branch_code || connection.default_branch_code || "SRFTL").trim();
          try {
            const branchData = await srsApiCall(
              `/branches/v2/customerBranchLocations/${encodeURIComponent(connection.customer_code)}?BranchCode=${encodeURIComponent(branchForLookup)}`
            );
            const branches = normalizeCustomerBranchLocations(branchData);
            const first = branches.find((b: any) => String(b?.branchCode || b?.code || "").toUpperCase() === branchForLookup.toUpperCase()) || branches[0];
            const fetched = extractJobAccountNumber(first);
            if (fetched && !Number.isNaN(fetched)) {
              jan = fetched;
              await supabase.from("srs_connections").update({
                job_account_number: fetched,
                default_branch_code: first?.branchCode || connection.default_branch_code,
              }).eq("id", connection.id);
              console.log(`Recovered jobAccountNumber=${fetched} for branch ${branchForLookup}`);
            }
          } catch (e: any) {
            console.warn("JAN auto-recovery failed:", e?.message || e);
          }
          if (!jan || Number.isNaN(jan)) {
            throw new Error(
              `Missing jobAccountNumber on SRS connection (branch ${branchForLookup}). Open Settings → SRS Distribution and run "Validate Connection" with a recent invoice or Integration Key so SRS returns the job account number for your customer code.`
            );
          }
        }

        // SRS requires non-empty customerContactInfo (name/phone/address) and a
        // non-empty customerItem on every line. srs_orders doesn't persist
        // contact info today, so derive it from the linked project → contact.
        let derivedContact: SrsCustomerContact | null =
          (order as any).customer_contact_info || null;
        let derivedShipTo: SrsShipTo | null = order.delivery_address
          ? parseShipToFreeform(order.delivery_address)
          : null;
        let derivedJobNumber: string =
          (order as any).job_number || order.order_number || "";

        try {
          if (order.project_id) {
            const { data: proj } = await supabase
              .from("projects")
              .select("job_number, pipeline_entry_id")
              .eq("id", order.project_id)
              .maybeSingle();
            if (proj?.job_number) derivedJobNumber = proj.job_number;

            if (proj?.pipeline_entry_id) {
              const { data: pe } = await supabase
                .from("pipeline_entries")
                .select("contact_id")
                .eq("id", proj.pipeline_entry_id)
                .maybeSingle();
              const contactId = (pe as any)?.contact_id;
              if (contactId) {
                const { data: contact } = await supabase
                  .from("contacts")
                  .select("first_name, last_name, company_name, phone, email, address_street, address_city, address_state, address_zip")
                  .eq("id", contactId)
                  .maybeSingle();
                if (contact) {
                  const name = [contact.first_name, contact.last_name]
                    .filter(Boolean).join(" ").trim() || contact.company_name || "Customer";
                  const addr = {
                    addressLine1: contact.address_street || "",
                    city: contact.address_city || "",
                    state: contact.address_state || "",
                    zipCode: contact.address_zip || "",
                  };
                  if (!derivedContact || !derivedContact.customerContactName) {
                    derivedContact = {
                      customerContactName: name,
                      customerContactPhone: contact.phone || "",
                      customerContactEmail: contact.email || "",
                      customerContactAddress: addr,
                    };
                  }
                  if (!derivedShipTo && contact.address_street) {
                    derivedShipTo = {
                      name,
                      addressLine1: contact.address_street,
                      addressLine2: "", addressLine3: "",
                      city: contact.address_city || "",
                      state: contact.address_state || "",
                      zipCode: contact.address_zip || "",
                    };
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn("contact derivation failed:", (e as any)?.message || e);
        }

        // Final validation — SRS rejects empty name/phone/address.
        if (!derivedContact?.customerContactName || !derivedContact?.customerContactPhone || !derivedContact?.customerContactAddress?.addressLine1) {
          throw new Error(
            "Missing customer contact info for SRS order. Add a contact name, phone, and street address on the linked lead/project, then retry Push to Supplier."
          );
        }

        const customerItemFallback = (derivedJobNumber || order.order_number || "PITCH").toString().slice(0, 32);
        const orderItems = Array.isArray(order.srs_order_items) ? order.srs_order_items : [];
        const missingSkuItems = orderItems.filter((item: any) => !Number(item.srs_product_id));
        if (missingSkuItems.length) {
          throw new Error(
            `SRS requires real branch catalog productIds before it will place the order. Map SKUs for: ${missingSkuItems.map((i: any) => i.product_name || i.product_description).join(", ")}.`
          );
        }

        const branchCode = String(order.branch_code || connection.default_branch_code || "").trim();
        const catalogResp = await srsApiCall(`/branches/v2/activeBranchProducts/${encodeURIComponent(branchCode)}`);
        const productMap = new Map(productArrayFromCatalog(catalogResp).map((p: any) => [Number(p.productId), p]));
        const invalidCatalogItems = orderItems.filter((item: any) => !productMap.has(Number(item.srs_product_id)));
        if (invalidCatalogItems.length) {
          throw new Error(
            `These SRS productIds are not active for branch ${branchCode}: ${invalidCatalogItems.map((i: any) => `${i.product_name || i.product_description} (${i.srs_product_id})`).join(", ")}.`
          );
        }

        // Strip any legacy shipTo.name — SRS public spec does not include it
        // and silently rejects unknown fields in some validator versions.
        if (derivedShipTo && (derivedShipTo as any).name) {
          delete (derivedShipTo as any).name;
        }

        // Build line items from the branch catalog.
        // Per SRS spec (2026-05-18): submit payload does NOT include `price`.
        // SRS prices the order from their catalog server-side. We skip the
        // pricing probe entirely on submit to avoid price-mismatch drops.
        const pricedItems = orderItems.map((item: any) =>
          buildCatalogSubmitItem(item, productMap.get(Number(item.srs_product_id)), customerItemFallback)
        );


        const orderPayload = buildSubmitOrderPayload({
          sourceSystem: SRS_SOURCE_SYSTEM,
          customerCode: String(connection.customer_code || "").trim(),
          accountNumber: String(connection.customer_code || "").trim(),
          jobAccountNumber: jan,
          shipToSequenceNumber: Number((order as any).ship_to_sequence_number ?? 1),
          branchCode,
          // Prefix `job:` so RoofHub webhooks echo back a unique parseable PO.
          poNumber: `job:${order.order_number}`,
          reference: (order as any).reference || "",
          jobNumber: derivedJobNumber,
          orderDate: new Date().toISOString().slice(0, 10),
          expectedDeliveryDate: order.delivery_date,
          expectedDeliveryTime: (order as any).delivery_time_window || "Anytime",
          orderType: srsOrderType(order.delivery_method),
          shippingMethod: srsShippingMethodLabel(order.delivery_method),
          shipTo: derivedShipTo,
          customerContact: derivedContact,
          notes: order.notes,
          items: pricedItems,
        });

        // Persist a pre-submit audit row so we always have the exact JSON
        // that was sent to SRS, even when the submit "succeeds" but is later
        // silently dropped by their queue.
        let auditId: string | null = null;
        try {
          const { data: auditRow } = await supabase
            .from("srs_submit_audit")
            .insert({
              order_id,
              tenant_id,
              transaction_id: (orderPayload as any).transactionID,
              request_json: orderPayload,
              success: false,
            })
            .select("id")
            .single();
          auditId = (auditRow as any)?.id ?? null;
        } catch (auditErr) {
          console.warn("srs_submit_audit insert failed:", (auditErr as any)?.message || auditErr);
        }

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
          if (auditId) {
            await supabase
              .from("srs_submit_audit")
              .update({ success: false, error_message: errMsg, updated_at: new Date().toISOString() })
              .eq("id", auditId);
          }
          throw new Error(`SRS submit failed (transactionID=${(orderPayload as any).transactionID}): ${errMsg}`);
        }

        // Update audit with the SRS response on success
        if (auditId) {
          await supabase
            .from("srs_submit_audit")
            .update({ response_json: orderResult, success: true, updated_at: new Date().toISOString() })
            .eq("id", auditId);
        }


        // SRS's /orders/v2/submit always returns 200 even when the order has only
        // been accepted into their ingestion *queue*. The queue entry can later be
        // silently rejected (bad item code, JAN mismatch, etc.) and never become a
        // real PO. Detect that state and mark the order `queued`, not `submitted`.
        // A real accepted order has orderID !== queueID and message !~ "Queued".
        const queueId = (orderResult as any)?.queueID || (orderResult as any)?.queueId || null;
        const orderId = (orderResult as any)?.orderID || (orderResult as any)?.orderId || null;
        const message = String((orderResult as any)?.message || "");
        const isQueuedOnly =
          (queueId && orderId && queueId === orderId) ||
          /queued/i.test(message);
        const nextStatus = isQueuedOnly ? "queued" : "submitted";

        await supabase
          .from("srs_orders")
          .update({
            srs_order_id: orderId,
            srs_transaction_id: orderResult.transactionID,
            status: nextStatus,
            submitted_at: new Date().toISOString(),
            srs_response: orderResult,
          })
          .eq("id", order_id);

        await supabase.from("srs_order_status_history").insert({
          order_id, old_status: "draft", new_status: nextStatus,
          status_message: isQueuedOnly
            ? `SRS accepted into intake queue (queueID=${queueId}). Awaiting confirmation.`
            : `Order submitted. SRS Order ID: ${orderId}`,
          raw_webhook_data: orderResult,
        });

        result = {
          success: true,
          queued: isQueuedOnly,
          srsOrderId: orderId,
          queueId,
          request: orderPayload,
          response: orderResult,
        };

        // Auto-sweep (payload variance re-submission) is a QA-only tool.
        // Production orders MUST submit exactly once — never generate multiple
        // POs. Gated behind SRS debug mode (env SRS_DEBUG_MODE=true OR
        // tenant_settings.srs_debug_mode=true OR srs_environment='debug').
        const debugEnabled = await isSrsDebugModeEnabled(supabase, tenant_id);
        if (isQueuedOnly && debugEnabled) {
          try {
            const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
            const SR_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
            const sweepResp = await fetch(`${SUPABASE_URL}/functions/v1/srs-api-proxy`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR_KEY}` },
              body: JSON.stringify({
                action: "submit_order_variances",
                tenant_id,
                params: { order_id, max_attempts: 40 },
              }),
            });
            const sweepJson = await sweepResp.json().catch(() => ({}));
            (result as any).autoSweep = sweepJson;
            const wId = sweepJson?.winner?.response?.orderID || sweepJson?.winner?.response?.orderId;
            if (wId) {
              (result as any).queued = false;
              (result as any).srsOrderId = wId;
            }
          } catch (e) {
            (result as any).autoSweepError = (e as any)?.message || String(e);
          }
        } else if (isQueuedOnly) {
          // Production behavior: rely on srs-order-status-poller + webhook to
          // promote queued → accepted. Never re-submit automatically.
          (result as any).autoSweep = { skipped: true, reason: "debug_mode_disabled" };
        }
        break;
      }



      case "submit_order_variances": {
        // Iteratively re-submit an SRS order with different payload shapes
        // until SRS returns a real orderID (i.e. NOT queueID===orderID and
        // message does not look like "Queued"). Every attempt is logged to
        // srs_submit_audit so we can compare what SRS accepted vs dropped.
        //
        // QA-only. Blocked in production unless the caller is in debug mode.
        {
          const debugEnabled = await isSrsDebugModeEnabled(supabase, tenant_id);
          if (!debugEnabled) {
            return new Response(JSON.stringify({
              error: "submit_order_variances is disabled in production. Enable SRS debug mode (tenant_settings.srs_debug_mode=true, srs_environment='debug', or env SRS_DEBUG_MODE=true) to run payload experiments.",
              code: "srs_debug_mode_required",
            }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
        const { order_id, max_attempts } = params as { order_id?: string; max_attempts?: number };
        if (!order_id) throw new Error("order_id required");
        const cap = Math.min(Math.max(Number(max_attempts) || 12, 1), 40);


        const { data: order } = await supabase
          .from("srs_orders")
          .select("*, srs_order_items(*)")
          .eq("id", order_id)
          .maybeSingle();
        if (!order) throw new Error("Order not found");

        // Resolve JAN (same path as submit_order)
        const janRaw = connection.job_account_number;
        let jan = typeof janRaw === "number" ? janRaw : Number(janRaw);
        if (jan === 1) jan = NaN;
        if (!jan || Number.isNaN(jan)) {
          const branchForLookup = String(order.branch_code || connection.default_branch_code || "SRFTL").trim();
          try {
            const branchData = await srsApiCall(
              `/branches/v2/customerBranchLocations/${encodeURIComponent(connection.customer_code)}?BranchCode=${encodeURIComponent(branchForLookup)}`
            );
            const branches = normalizeCustomerBranchLocations(branchData);
            const first = branches.find((b: any) => String(b?.branchCode || b?.code || "").toUpperCase() === branchForLookup.toUpperCase()) || branches[0];
            const fetched = extractJobAccountNumber(first);
            if (fetched && !Number.isNaN(fetched)) jan = fetched;
          } catch (_) { /* will throw below */ }
          if (!jan || Number.isNaN(jan)) {
            throw new Error("Missing jobAccountNumber. Validate SRS connection in Settings first.");
          }
        }

        // Derive contact / shipTo / job number
        let derivedContact: SrsCustomerContact | null = (order as any).customer_contact_info || null;
        let derivedShipTo: SrsShipTo | null = order.delivery_address ? parseShipToFreeform(order.delivery_address) : null;
        let derivedJobNumber: string = (order as any).job_number || order.order_number || "";
        try {
          if (order.project_id) {
            const { data: proj } = await supabase.from("projects").select("job_number, pipeline_entry_id").eq("id", order.project_id).maybeSingle();
            if (proj?.job_number) derivedJobNumber = proj.job_number;
            if (proj?.pipeline_entry_id) {
              const { data: pe } = await supabase.from("pipeline_entries").select("contact_id").eq("id", proj.pipeline_entry_id).maybeSingle();
              const contactId = (pe as any)?.contact_id;
              if (contactId) {
                const { data: c } = await supabase.from("contacts")
                  .select("first_name,last_name,company_name,phone,email,address_street,address_city,address_state,address_zip")
                  .eq("id", contactId).maybeSingle();
                if (c) {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.company_name || "Customer";
                  const addr = { addressLine1: c.address_street || "", city: c.address_city || "", state: c.address_state || "", zipCode: c.address_zip || "" };
                  if (!derivedContact || !derivedContact.customerContactName) {
                    derivedContact = { customerContactName: name, customerContactPhone: c.phone || "", customerContactEmail: c.email || "", customerContactAddress: addr };
                  }
                  if (!derivedShipTo && c.address_street) {
                    derivedShipTo = { addressLine1: c.address_street, addressLine2: "", addressLine3: "", city: c.address_city || "", state: c.address_state || "", zipCode: c.address_zip || "" };
                  }
                }
              }
            }
          }
        } catch (_) {}
        if (!derivedContact?.customerContactName || !derivedContact?.customerContactPhone || !derivedContact?.customerContactAddress?.addressLine1) {
          throw new Error("Missing customer name/phone/street. Fix on linked lead, then retry.");
        }
        if (derivedShipTo && (derivedShipTo as any).name) delete (derivedShipTo as any).name;

        // Build catalog items
        const orderItems = Array.isArray(order.srs_order_items) ? order.srs_order_items : [];
        const missingSku = orderItems.filter((i: any) => !Number(i.srs_product_id));
        if (missingSku.length) throw new Error(`Missing SRS productIds for: ${missingSku.map((i: any) => i.product_name).join(", ")}`);
        const branchCode = String(order.branch_code || connection.default_branch_code || "").trim();
        const catalogResp = await srsApiCall(`/branches/v2/activeBranchProducts/${encodeURIComponent(branchCode)}`);
        const productMap = new Map(productArrayFromCatalog(catalogResp).map((p: any) => [Number(p.productId), p]));
        const invalid = orderItems.filter((i: any) => !productMap.has(Number(i.srs_product_id)));
        if (invalid.length) throw new Error(`productIds not active on ${branchCode}: ${invalid.map((i: any) => i.srs_product_id).join(", ")}`);
        const customerItemFallback = (derivedJobNumber || order.order_number || "PITCH").toString().slice(0, 32);
        const basePricedItems = orderItems.map((i: any) => buildCatalogSubmitItem(i, productMap.get(Number(i.srs_product_id)), customerItemFallback));

        // Variant matrix
        const todayStr = new Date().toISOString().slice(0, 10);
        const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
        const baseShip = (() => { try { return srsShippingMethodLabel(order.delivery_method); } catch { return "Ground Drop"; } })();
        const baseType = srsOrderType(order.delivery_method);
        const shippingMethods = Array.from(new Set([baseShip, "Ground Drop", "Roof Load", "Will Call"]));
        const deliveryTimes = ["Anytime", "Morning", "Afternoon"];
        const deliveryDates = [order.delivery_date || todayStr, plusDays(1), plusDays(2), plusDays(7)];
        const shipToSeqs = Array.from(new Set([Number((order as any).ship_to_sequence_number ?? 1), 1, 2]));
        const poVariants = [`job:${order.order_number}`, `${order.order_number}`, `PITCH-${order.order_number}`];

        type Variant = {
          shippingMethod: string;
          orderType: "WHSE" | "WILLCALL";
          expectedDeliveryTime: string;
          expectedDeliveryDate: string;
          shipToSequenceNumber: number;
          poNumber: string;
        };
        const variants: Variant[] = [];
        const seen = new Set<string>();
        for (const sm of shippingMethods) {
          const ot: "WHSE" | "WILLCALL" = sm === "Will Call" ? "WILLCALL" : "WHSE";
          for (const dd of deliveryDates)
            for (const dt of deliveryTimes)
              for (const ss of shipToSeqs)
                for (const po of poVariants) {
                  const k = `${sm}|${ot}|${dd}|${dt}|${ss}|${po}`;
                  if (seen.has(k)) continue; seen.add(k);
                  variants.push({ shippingMethod: sm, orderType: ot, expectedDeliveryTime: dt, expectedDeliveryDate: dd, shipToSequenceNumber: ss, poNumber: po });
                }
        }
        // Prefer variants closest to current configured order first
        variants.sort((a, b) => {
          const score = (v: Variant) =>
            (v.shippingMethod === baseShip ? 0 : 1) +
            (v.orderType === baseType ? 0 : 1) +
            (v.expectedDeliveryDate === (order.delivery_date || todayStr) ? 0 : 1) +
            (v.expectedDeliveryTime === "Anytime" ? 0 : 1) +
            (v.shipToSequenceNumber === Number((order as any).ship_to_sequence_number ?? 1) ? 0 : 1) +
            (v.poNumber === `job:${order.order_number}` ? 0 : 1);
          return score(a) - score(b);
        });

        const attempts: Array<{
          variant: Variant; transactionID: string;
          queueId: string | null; orderId: string | null;
          message: string; accepted: boolean; error?: string;
        }> = [];
        let winner: any = null;

        for (const v of variants.slice(0, cap)) {
          const payload = buildSubmitOrderPayload({
            sourceSystem: SRS_SOURCE_SYSTEM,
            customerCode: String(connection.customer_code || "").trim(),
            accountNumber: String(connection.customer_code || "").trim(),
            jobAccountNumber: jan,
            shipToSequenceNumber: v.shipToSequenceNumber,
            branchCode,
            poNumber: v.poNumber,
            reference: (order as any).reference || "",
            jobNumber: derivedJobNumber,
            orderDate: todayStr,
            expectedDeliveryDate: v.expectedDeliveryDate,
            expectedDeliveryTime: v.expectedDeliveryTime,
            orderType: v.orderType,
            shippingMethod: v.shippingMethod,
            shipTo: derivedShipTo,
            customerContact: derivedContact,
            notes: order.notes,
            items: basePricedItems,
          });

          let auditId: string | null = null;
          try {
            const { data: auditRow } = await supabase.from("srs_submit_audit")
              .insert({ order_id, tenant_id, transaction_id: (payload as any).transactionID, request_json: payload, success: false })
              .select("id").single();
            auditId = (auditRow as any)?.id ?? null;
          } catch (_) {}

          let resp: any = null;
          let errMsg: string | null = null;
          try { resp = await srsApiCall("/orders/v2/submit", "POST", payload); }
          catch (e: any) { errMsg = e?.message || String(e); }
          const queueId = resp?.queueID || resp?.queueId || null;
          const orderId = resp?.orderID || resp?.orderId || null;
          const message = String(resp?.message || "");
          const accepted = !errMsg && !!orderId && (!queueId || queueId !== orderId) && !/queued/i.test(message);

          if (auditId) {
            try {
              await supabase.from("srs_submit_audit")
                .update({ response_json: resp ?? { error: errMsg }, success: accepted, error_message: errMsg, updated_at: new Date().toISOString() })
                .eq("id", auditId);
            } catch (_) {}
          }

          attempts.push({
            variant: v, transactionID: (payload as any).transactionID,
            queueId, orderId, message, accepted, error: errMsg || undefined,
          });

          if (accepted) {
            await supabase.from("srs_orders").update({
              srs_order_id: orderId,
              srs_transaction_id: resp?.transactionID || (payload as any).transactionID,
              status: "submitted",
              submitted_at: new Date().toISOString(),
              srs_response: resp,
            }).eq("id", order_id);
            await supabase.from("srs_order_status_history").insert({
              order_id, old_status: order.status || "draft", new_status: "submitted",
              status_message: `Variance sweep accepted (orderID=${orderId}, attempt ${attempts.length}/${variants.length}).`,
              raw_webhook_data: { winningVariant: v, response: resp },
            });
            winner = { variant: v, response: resp, attempt: attempts.length };
            break;
          }
        }

        result = {
          success: !!winner,
          winner,
          attempts,
          totalVariantsTried: attempts.length,
          totalVariantsAvailable: variants.length,
        };
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
        const probeBranch = String((params as any).branch_code || connection.default_branch_code || "SRFTL");
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
        const { order_id } = params as Record<string, string>;
        let { srs_order_id, transaction_id } = params as Record<string, string>;
        let order: any = null;

        if (order_id) {
          const { data } = await supabase
            .from("srs_orders")
            .select("id, status, submitted_at, srs_order_id, srs_transaction_id")
            .eq("tenant_id", tenant_id)
            .eq("id", order_id)
            .maybeSingle();
          order = data;
          srs_order_id = srs_order_id || order?.srs_order_id || "";
          transaction_id = transaction_id || order?.srs_transaction_id || "";
        }

        if (!srs_order_id && !transaction_id) {
          throw new Error("srs_order_id, transaction_id, or order_id with a saved transaction is required");
        }
        const path = srs_order_id
          ? `/orders/v2/status/${encodeURIComponent(srs_order_id)}`
          : `/orders/v2/status?transactionID=${encodeURIComponent(transaction_id)}`;

        // Mirror status into our orders table if we recognize the order
        if (!order) {
          const matchKey = srs_order_id ? "srs_order_id" : "srs_transaction_id";
          const matchVal = srs_order_id || transaction_id;
          const { data } = await supabase
            .from("srs_orders")
            .select("id, status, submitted_at")
            .eq("tenant_id", tenant_id)
            .eq(matchKey, matchVal)
            .maybeSingle();
          order = data;
        }

        let statusData: any = null;
        let notFound = false;
        try {
          statusData = await srsApiCall(path);
        } catch (e: any) {
          const msg = e?.message || String(e);
          if (/\[404\]/.test(msg) || /not found/i.test(msg)) {
            notFound = true;
          } else {
            throw e;
          }
        }

        if (notFound) {
          // SRS has no record of this order. If it was queued long enough that
          // their pipeline should have surfaced it, treat as silently rejected.
          if (order && order.status === "queued") {
            const ageMs = Date.now() - new Date(order.submitted_at).getTime();
            if (ageMs > 10 * 60 * 1000) {
              await supabase
                .from("srs_orders")
                .update({ status: "rejected_by_srs" })
                .eq("id", order.id);
              await supabase.from("srs_order_status_history").insert({
                order_id: order.id,
                old_status: "queued",
                new_status: "rejected_by_srs",
                status_message:
                  "SRS returned 404 on status check. The queue entry was dropped and no PO exists. Resubmit required.",
              });
            }
          }
          result = {
            success: true,
            status: { status: "not_found", message: "SRS has no record of this order yet." },
          };
          break;
        }

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

      case "poll_queued_orders": {
        // Called by cron. Polls all queued orders for this tenant whose submit
        // was >= 90s ago and < 24h ago. Promotes confirmed orders, marks 404s
        // older than 10min as rejected_by_srs.
        const { data: queued } = await supabase
          .from("srs_orders")
          .select("id, srs_order_id, srs_transaction_id, status, submitted_at")
          .eq("tenant_id", tenant_id)
          .eq("status", "queued")
          .lt("submitted_at", new Date(Date.now() - 90 * 1000).toISOString())
          .gt("submitted_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .limit(50);

        const polled: any[] = [];
        for (const o of queued || []) {
          const lookupPath = o.srs_order_id
            ? `/orders/v2/status/${encodeURIComponent(o.srs_order_id)}`
            : o.srs_transaction_id
            ? `/orders/v2/status?transactionID=${encodeURIComponent(o.srs_transaction_id)}`
            : null;
          if (!lookupPath) continue;

          try {
            const sd = await srsApiCall(lookupPath);
            const newStatus = sd?.status || "accepted";
            if (newStatus !== o.status) {
              await supabase.from("srs_orders").update({ status: newStatus }).eq("id", o.id);
              await supabase.from("srs_order_status_history").insert({
                order_id: o.id,
                old_status: o.status,
                new_status: newStatus,
                status_message: sd?.statusMessage || `Confirmed by SRS via poll: ${newStatus}`,
                raw_webhook_data: sd,
              });

              // Build supplier-verified vendor invoice on acceptance with verified pricing
              if (/^accepted$/i.test(newStatus)) {
                try {
                  const { data: fullOrder } = await supabase
                    .from("srs_orders")
                    .select("id, tenant_id, project_id, srs_order_id, srs_order_items(*)")
                    .eq("id", o.id)
                    .maybeSingle();
                  const remoteLines: any[] = Array.isArray(sd?.lineItems)
                    ? sd.lineItems
                    : Array.isArray(sd?.orderLineItemDetails)
                    ? sd.orderLineItemDetails
                    : [];
                  if (fullOrder?.tenant_id && remoteLines.length) {
                    const localByCode = new Map<string, any>();
                    for (const li of fullOrder.srs_order_items || []) {
                      if (li.srs_product_id != null) {
                        localByCode.set(String(li.srs_product_id), li);
                      }
                    }
                    const lines = remoteLines.map((rl: any) => {
                      const code = String(rl.productId ?? rl.srs_product_id ?? rl.itemNumber ?? "");
                      const local = localByCode.get(code);
                      const qty = Number(rl.quantity ?? local?.quantity ?? 0);
                      const unit = Number(rl.unitPrice ?? rl.price ?? rl.unit_price ?? 0);
                      return {
                        description: String(rl.productName ?? rl.description ?? local?.product_name ?? "Material"),
                        quantity: qty,
                        unit_price: unit,
                        line_total: Number(rl.lineTotal ?? rl.extendedPrice ?? qty * unit),
                        supplier_item_number: code || null,
                        unit_of_measure: rl.uom ?? local?.uom ?? null,
                        baseline_unit_price: local?.unit_price != null ? Number(local.unit_price) : null,
                      };
                    });
                    await buildSupplierVerifiedInvoice({
                      supabase,
                      tenant_id: String(fullOrder.tenant_id),
                      project_id: fullOrder.project_id ?? null,
                      supplier: "srs",
                      source_order_table: "srs_orders",
                      source_order_id: fullOrder.id,
                      supplier_order_id: fullOrder.srs_order_id,
                      vendor_name: "SRS Distribution",
                      lines,
                    });
                  }
                } catch (invErr: any) {
                  console.error("[srs-poll] verified-invoice build failed", invErr?.message || invErr);
                }
              }
            }
            polled.push({ id: o.id, outcome: "confirmed", status: newStatus });
          } catch (e: any) {
            const msg = e?.message || String(e);
            const is404 = /\[404\]/.test(msg) || /not found/i.test(msg);
            if (!is404) {
              polled.push({ id: o.id, outcome: "error", error: msg });
              continue;
            }
            const ageMs = Date.now() - new Date(o.submitted_at).getTime();
            if (ageMs > 10 * 60 * 1000) {
              await supabase
                .from("srs_orders")
                .update({ status: "rejected_by_srs" })
                .eq("id", o.id);
              await supabase.from("srs_order_status_history").insert({
                order_id: o.id,
                old_status: "queued",
                new_status: "rejected_by_srs",
                status_message:
                  "SRS returned 404 on status check (>10min after queue). Queue entry dropped — resubmit required.",
              });
              polled.push({ id: o.id, outcome: "rejected_by_srs" });
            } else {
              polled.push({ id: o.id, outcome: "still_queued_no_record_yet" });
            }
          }
        }

        result = { success: true, polled_count: polled.length, polled };
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
