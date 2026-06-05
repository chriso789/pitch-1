// srs-api — routed Edge Function.
// Wired routes:
//   POST /pricing/record-history  — pull SRS prices and persist them into
//     supplier_pricing_runs + supplier_price_history. Reference / fulfillment
//     pricing only. Never overwrites estimate cost. Never submits orders.

import {
  createRouter,
  jsonOk,
  jsonErr,
  requireAuth,
  requireTenant,
  serviceClient,
} from "../_shared/router.ts";
import {
  startPricingRun,
  recordPriceHistoryBulk,
  completePricingRun,
  type PriceHistoryLineInput,
  type PricingRunStatus,
} from "../_shared/supplier-pricing-history.ts";

const SRS_STAGING_URL = "https://services-qa.roofhub.pro";
const SRS_PRODUCTION_URL = "https://services.roofhub.pro";
const SRS_SOURCE_SYSTEM = "PITCH";

const app = createRouter("srs-api");

app.get("/__health", (c) => jsonOk(c, { fn: "srs-api", ok: true }));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/proxy", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

// ---------------------------------------------------------------------------
// POST /pricing/record-history
// ---------------------------------------------------------------------------
app.post("/pricing/record-history", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const userId = c.get("userId") as string;
  const svc = serviceClient();

  // ---- parse + validate input ----
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonErr(c, "invalid_json", "Body must be JSON", 400);
  }

  const sourceContext = body?.source_context;
  if (!["template", "estimate", "project", "order"].includes(sourceContext)) {
    return jsonErr(c, "invalid_source_context", "source_context must be template|estimate|project|order", 400);
  }
  const branchCode = String(body?.branch_code ?? body?.branchCode ?? "").trim();
  if (!branchCode) return jsonErr(c, "missing_branch_code", "branch_code required", 400);

  const rawItems: any[] = Array.isArray(body?.items) ? body.items : [];
  if (!rawItems.length) return jsonErr(c, "missing_items", "items[] required", 400);

  type InItem = {
    template_item_id?: string | null;
    estimate_line_item_id?: string | null;
    productId?: number | string;
    productNumber?: string;
    productName?: string | null;
    productDescription?: string | null;
    uom?: string | null;
    quantity?: number | null;
  };
  const items: InItem[] = rawItems;

  // ---- load SRS connection (tenant-scoped) ----
  const { data: connection, error: connErr } = await svc
    .from("srs_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (connErr) return jsonErr(c, "connection_read_failed", connErr.message, 500);
  if (!connection) return jsonErr(c, "srs_not_connected", "SRS connection not configured for this tenant", 404);

  const environment = String(body?.environment || connection.environment || "production");
  const baseUrl = environment === "production" ? SRS_PRODUCTION_URL : SRS_STAGING_URL;

  const janRaw = body?.job_account_number ?? connection.job_account_number;
  const jan = Number(janRaw);
  const hasValidJan = Number.isFinite(jan) && jan > 1;
  const customerCode = String(connection.customer_code || "").trim();

  // ---- open pricing run ----
  let runId: string;
  try {
    const r = await startPricingRun(svc, {
      tenant_id: tenantId,
      supplier: "srs",
      source_context: sourceContext,
      source_id: body?.source_id ?? null,
      environment,
      account_number: customerCode || null,
      branch_number: branchCode,
      job_account_number: hasValidJan ? String(jan) : null,
      created_by: userId,
      metadata: { route: "srs-api/pricing/record-history" },
    });
    runId = r.id;
  } catch (e: any) {
    return jsonErr(c, "pricing_run_start_failed", e?.message ?? String(e), 500);
  }

  // ---- partition items: priced vs unmapped (no validated productId) ----
  const priceable: Array<{ idx: number; item: InItem; productId: number; productNumber: string; uom: string; quantity: number }> = [];
  const unmapped: Array<{ idx: number; item: InItem; reason: string }> = [];

  items.forEach((it, idx) => {
    const pidNum = Number(it.productId);
    const productNumber = String(it.productNumber ?? "").trim();
    if (!Number.isFinite(pidNum) || pidNum <= 0) {
      unmapped.push({ idx, item: it, reason: "missing_validated_product_id" });
      return;
    }
    priceable.push({
      idx,
      item: it,
      productId: pidNum,
      productNumber: productNumber || String(pidNum),
      uom: String(it.uom || "EA").toUpperCase(),
      quantity: Number(it.quantity) || 1,
    });
  });

  // ---- pre-flight gate: JAN required for SRS price API ----
  let srsCallStatus: number | null = null;
  let srsError: string | null = null;
  let srsResponse: any = null;

  if (!hasValidJan) {
    srsError = "missing_job_account_number";
  } else if (!customerCode) {
    srsError = "missing_customer_code";
  } else if (priceable.length === 0) {
    srsError = "no_priceable_items";
  }

  // ---- get OAuth token (only if we actually plan to call SRS) ----
  async function getAccessToken(): Promise<string> {
    if (connection.access_token && connection.token_expires_at) {
      const expiresAt = new Date(connection.token_expires_at);
      if (expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
        return connection.access_token as string;
      }
    }
    const clientId = String(connection.client_id || "").trim();
    const clientSecret = String(connection.client_secret || "").trim();
    if (!clientId || !clientSecret) {
      throw new Error("Missing client_id/client_secret on SRS connection");
    }
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "ALL",
    }).toString();
    let resp = await fetch(`${baseUrl}/authentication/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "ALL" }),
    });
    if (!resp.ok) {
      resp = await fetch(`${baseUrl}/authentication/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form,
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`srs_auth_failed_${resp.status}: ${t.slice(0, 300)}`);
      }
    }
    const data = await resp.json();
    const token = data?.access_token as string;
    const expiresIn = Number(data?.expires_in) || 86400;
    const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    await svc.from("srs_connections").update({
      access_token: token, token_expires_at: newExpiresAt,
    }).eq("id", connection.id);
    return token;
  }

  // ---- call SRS price API ----
  if (!srsError) {
    try {
      const token = await getAccessToken();
      const pricingPayload = {
        sourceSystem: SRS_SOURCE_SYSTEM,
        transactionId: crypto.randomUUID(),
        customerCode,
        jobAccountNumber: jan,
        branchCode,
        productList: priceable.map((p) => ({
          productNumber: p.productNumber,
          quantity: p.quantity,
          uom: p.uom,
        })),
      };
      const resp = await fetch(`${baseUrl}/products/v2/price`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Source-System": SRS_SOURCE_SYSTEM,
          "X-Source-System": SRS_SOURCE_SYSTEM,
        },
        body: JSON.stringify(pricingPayload),
      });
      srsCallStatus = resp.status;
      const text = await resp.text();
      try { srsResponse = JSON.parse(text); } catch { srsResponse = { raw: text }; }
      if (!resp.ok) srsError = `srs_http_${resp.status}`;
    } catch (e: any) {
      srsError = e?.message ?? String(e);
    }
  }

  // ---- normalize SRS response → per-product result ----
  const respList: any[] = Array.isArray(srsResponse)
    ? srsResponse
    : Array.isArray(srsResponse?.productPriceList)
      ? srsResponse.productPriceList
      : Array.isArray(srsResponse?.products)
        ? srsResponse.products
        : Array.isArray(srsResponse?.data)
          ? srsResponse.data
          : [];

  const findFor = (productNumber: string, productId: number) => {
    const pnUp = productNumber.toUpperCase();
    return respList.find((r) => {
      const a = String(r?.productNumber ?? r?.product_number ?? "").toUpperCase();
      const b = String(r?.productId ?? r?.product_id ?? "");
      return (a && a === pnUp) || (b && Number(b) === productId);
    }) ?? null;
  };

  // ---- build history rows ----
  const buildLine = (
    it: InItem,
    pid: number | null,
    productNumber: string | null,
    uom: string,
    qty: number,
    match: any | null,
    status: PriceHistoryLineInput["status"],
    rawOverride?: unknown,
  ): PriceHistoryLineInput => {
    const unitPrice = match
      ? Number(match.unitPrice ?? match.unit_price ?? match.price ?? match.netPrice ?? match.net_price)
      : NaN;
    const extPrice = match
      ? Number(match.extendedPrice ?? match.extended_price ?? match.totalPrice ?? match.lineTotal)
      : NaN;
    const availability = match
      ? (match.availability ?? match.availabilityStatus ?? match.stockStatus ?? null)
      : null;
    return {
      tenant_id: tenantId,
      pricing_run_id: runId,
      supplier: "srs",
      template_id: sourceContext === "template" ? (body?.source_id ?? null) : null,
      template_item_id: sourceContext === "template" ? (it.template_item_id ?? null) : null,
      estimate_id: sourceContext === "estimate" ? (body?.source_id ?? null) : null,
      estimate_line_item_id: sourceContext === "estimate" ? (it.estimate_line_item_id ?? null) : null,
      supplier_item_number: productNumber ?? (pid != null ? String(pid) : null),
      supplier_item_description:
        (match?.productName ?? match?.product_name ?? it.productName ?? it.productDescription) ?? null,
      uom,
      quantity: qty,
      unit_price: Number.isFinite(unitPrice) ? unitPrice : null,
      extended_price: Number.isFinite(extPrice) ? extPrice : null,
      availability: availability ? String(availability) : null,
      account_number: customerCode || null,
      branch_number: branchCode,
      job_account_number: hasValidJan ? String(jan) : null,
      price_source: status === "ok" ? "srs_price_api" : status === "unavailable" ? "catalog_unmapped" : "srs_price_api",
      raw_response: rawOverride ?? match ?? null,
      status,
      created_by: userId,
    };
  };

  const rows: PriceHistoryLineInput[] = [];

  for (const p of priceable) {
    if (srsError) {
      rows.push(buildLine(
        p.item, p.productId, p.productNumber, p.uom, p.quantity,
        null,
        "error",
        { error: srsError, status: srsCallStatus, response: srsResponse },
      ));
      continue;
    }
    const match = findFor(p.productNumber, p.productId);
    rows.push(buildLine(
      p.item, p.productId, p.productNumber, p.uom, p.quantity,
      match,
      match ? "ok" : "unavailable",
      match ? undefined : { reason: "not_in_srs_response" },
    ));
  }

  for (const u of unmapped) {
    rows.push(buildLine(
      u.item,
      Number.isFinite(Number(u.item.productId)) ? Number(u.item.productId) : null,
      String(u.item.productNumber ?? "").trim() || null,
      String(u.item.uom || "EA").toUpperCase(),
      Number(u.item.quantity) || 1,
      null,
      "unavailable",
      { reason: u.reason },
    ));
  }

  // ---- persist history ----
  let recorded = 0;
  try {
    const ins = await recordPriceHistoryBulk(svc, rows);
    recorded = ins.inserted;
  } catch (e) {
    console.warn("[srs-api/pricing/record-history] recordPriceHistoryBulk failed", e);
  }

  // ---- finalize run ----
  const okCount = rows.filter((r) => r.status === "ok").length;
  const finalStatus: Exclude<PricingRunStatus, "running"> = srsError && okCount === 0
    ? "failed"
    : okCount === rows.length
      ? "completed"
      : okCount > 0
        ? "partial"
        : "failed";

  const errorSummary = srsError
    ? srsError
    : okCount === 0
      ? "no_lines_priced"
      : okCount < rows.length
        ? "partial_pricing"
        : null;

  try {
    await completePricingRun(svc, runId, {
      status: finalStatus,
      error_summary: errorSummary,
      metadata_patch: {
        srs_status: srsCallStatus,
        requested_count: rows.length,
        priced_count: okCount,
        unmapped_count: unmapped.length,
        recorded_count: recorded,
      },
    });
  } catch (e) {
    console.warn("[srs-api/pricing/record-history] completePricingRun failed", e);
  }

  return jsonOk(c, {
    run_id: runId,
    run_status: finalStatus,
    environment,
    branch_code: branchCode,
    customer_code: customerCode,
    job_account_number: hasValidJan ? jan : null,
    requested_count: rows.length,
    priced_count: okCount,
    unmapped_count: unmapped.length,
    recorded_count: recorded,
    srs_status: srsCallStatus,
    error_summary: errorSummary,
    lines: rows.map((r) => ({
      template_item_id: r.template_item_id,
      estimate_line_item_id: r.estimate_line_item_id,
      supplier_item_number: r.supplier_item_number,
      supplier_item_description: r.supplier_item_description,
      uom: r.uom,
      quantity: r.quantity,
      unit_price: r.unit_price,
      extended_price: r.extended_price,
      availability: r.availability,
      status: r.status,
    })),
  });
});

// Supabase edge runtime delivers the URL with the function name prefix
// (e.g. /srs-api/pricing/record-history). Strip it so Hono matches routes
// declared as /pricing/record-history.
Deno.serve((req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/srs-api/")) {
    url.pathname = url.pathname.slice("/srs-api".length) || "/";
    return app.fetch(new Request(url.toString(), req));
  }
  if (url.pathname === "/srs-api") {
    url.pathname = "/";
    return app.fetch(new Request(url.toString(), req));
  }
  return app.fetch(req);
});
