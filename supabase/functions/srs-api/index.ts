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
  loadSupplierMappingsForTemplateItems,
  evaluateMappingGate,
  priceSourceForSkip,
  type PriceHistoryLineInput,
  type PricingRunStatus,
  type SupplierMappingRow,
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

  // ---- load approved mappings for any template_item_ids on the request ----
  const tplIds = items
    .map((it) => (typeof it.template_item_id === "string" ? it.template_item_id : null))
    .filter((x): x is string => !!x);
  let mappings = new Map<string, SupplierMappingRow>();
  try {
    if (tplIds.length) {
      mappings = await loadSupplierMappingsForTemplateItems(svc, {
        tenant_id: tenantId,
        supplier: "srs",
        template_item_ids: tplIds,
      });
    }
  } catch (e) {
    console.warn("[srs-api/pricing/record-history] mapping load failed", e);
  }

  // ---- partition items via mapping gate ----
  // Items WITH template_item_id are gated by template_item_supplier_mappings.
  // Items WITHOUT template_item_id (debug / ad-hoc) fall back to the legacy
  // "needs a validated productId" path so the debug page keeps working.
  const priceable: Array<{
    idx: number;
    item: InItem;
    productId: number | null;
    productNumber: string;
    uom: string;
    quantity: number;
    mapping?: SupplierMappingRow;
  }> = [];
  const skipped: Array<{
    idx: number;
    item: InItem;
    reason: string;
    price_source: string;
    mapping?: SupplierMappingRow | null;
  }> = [];

  items.forEach((it, idx) => {
    const requestedUom = String(it.uom || "EA").toUpperCase();
    const qty = Number(it.quantity) || 1;
    const tplId = typeof it.template_item_id === "string" ? it.template_item_id : null;

    if (tplId) {
      const mapping = mappings.get(tplId) ?? null;
      const decision = evaluateMappingGate({
        mapping,
        requested_uom: requestedUom,
        branch_number: branchCode,
      });
      if (decision.kind === "approved") {
        priceable.push({
          idx,
          item: it,
          productId: decision.mapping.supplier_product_id
            ? Number(decision.mapping.supplier_product_id) || null
            : null,
          productNumber: decision.sku,
          uom: decision.uom,
          quantity: qty,
          mapping: decision.mapping,
        });
      } else {
        skipped.push({
          idx,
          item: it,
          reason: decision.reason,
          price_source: priceSourceForSkip(decision.reason),
          mapping: decision.mapping,
        });
      }
      return;
    }

    // Legacy debug path — no template_item_id, require a validated productId.
    const pidNum = Number(it.productId);
    const productNumber = String(it.productNumber ?? "").trim();
    if (!Number.isFinite(pidNum) || pidNum <= 0) {
      skipped.push({
        idx,
        item: it,
        reason: "missing_validated_product_id",
        price_source: "catalog_unmapped",
      });
      return;
    }
    priceable.push({
      idx,
      item: it,
      productId: pidNum,
      productNumber: productNumber || String(pidNum),
      uom: requestedUom,
      quantity: qty,
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

  const findFor = (productNumber: string, productId: number | null) => {
    const pnUp = productNumber.toUpperCase();
    return respList.find((r) => {
      const a = String(r?.productNumber ?? r?.product_number ?? "").toUpperCase();
      const b = String(r?.productId ?? r?.product_id ?? "");
      return (a && a === pnUp) || (productId != null && b && Number(b) === productId);
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
    priceSourceOverride?: string,
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
    const defaultSource = status === "ok"
      ? "srs_price_api"
      : status === "unavailable"
        ? "catalog_unmapped"
        : "srs_price_api";
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
      price_source: priceSourceOverride ?? defaultSource,
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

  for (const u of skipped) {
    const m = u.mapping ?? null;
    const productNumber = (m?.supplier_item_number ?? String(u.item.productNumber ?? "").trim()) || null;
    const pid = m?.supplier_product_id
      ? Number(m.supplier_product_id) || null
      : Number.isFinite(Number(u.item.productId)) ? Number(u.item.productId) : null;
    rows.push(buildLine(
      u.item,
      pid,
      productNumber,
      String(m?.default_uom || u.item.uom || "EA").toUpperCase(),
      Number(u.item.quantity) || 1,
      null,
      "unavailable",
      { reason: u.reason, mapping_id: m?.id ?? null, mapping_status: m?.mapping_status ?? null },
      u.price_source,
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
        unmapped_count: skipped.length,
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
    unmapped_count: skipped.length,
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

// ---------------------------------------------------------------------------
// POST /pricing/catalog-search
// Search activeBranchProducts for SKUs the user can approve as a mapping.
// Only returns rows where productNumber is non-null (real, pricing-API-safe).
// ---------------------------------------------------------------------------
app.post("/pricing/catalog-search", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const svc = serviceClient();
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }

  const branchCode = String(body?.branch_code ?? "").trim();
  const query = String(body?.q ?? body?.query ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);

  const { data: connection } = await svc
    .from("srs_connections")
    .select("default_branch_code, environment")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const effectiveBranch = branchCode || String(connection?.default_branch_code || "").trim();
  if (!effectiveBranch) return jsonErr(c, "missing_branch_code", "branch_code or default_branch_code required", 400);

  // Reuse the existing get_products edge function via a direct invoke pattern
  // would couple us; instead, query the cached supplier_products table when
  // present. Fall back to empty list.
  let rows: any[] = [];
  try {
    const q = svc
      .from("srs_active_branch_products")
      .select("product_id, product_number, product_name, manufacturer, category, uom, default_uom, branch_code, last_seen_at")
      .eq("tenant_id", tenantId)
      .eq("branch_code", effectiveBranch)
      .not("product_number", "is", null)
      .limit(limit);
    const { data, error } = await q;
    if (error) {
      // Table may not exist for this tenant yet — return empty + hint.
      return jsonOk(c, { branch_code: effectiveBranch, results: [], note: `catalog_unavailable:${error.message}` });
    }
    rows = (data ?? []) as any[];
  } catch (e: any) {
    return jsonOk(c, { branch_code: effectiveBranch, results: [], note: `catalog_error:${e?.message ?? String(e)}` });
  }

  const filtered = query
    ? rows.filter((r) => {
        const hay = [
          r.product_number, r.product_name, r.manufacturer, r.category,
        ].map((x) => String(x ?? "").toLowerCase()).join(" ");
        return hay.includes(query);
      })
    : rows;

  return jsonOk(c, {
    branch_code: effectiveBranch,
    count: filtered.length,
    results: filtered.slice(0, limit),
  });
});

// ---------------------------------------------------------------------------
// GET /mapping/list?template_item_ids=a,b,c
// ---------------------------------------------------------------------------
app.get("/mapping/list", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const svc = serviceClient();
  const idsParam = c.req.query("template_item_ids") || "";
  const ids = idsParam.split(",").map((x) => x.trim()).filter(Boolean);
  let q = svc.from("template_item_supplier_mappings").select("*").eq("tenant_id", tenantId).eq("supplier", "srs");
  if (ids.length) q = q.in("template_item_id", ids);
  const { data, error } = await q;
  if (error) return jsonErr(c, "mapping_list_failed", error.message, 500);
  return jsonOk(c, { mappings: data ?? [] });
});

// ---------------------------------------------------------------------------
// POST /mapping/approve
// Persist an SRS mapping as `approved`. Stores BOTH productNumber and productId.
// Rejects when productNumber is null — caller must select a catalog row with
// a real SKU before approving.
// ---------------------------------------------------------------------------
app.post("/mapping/approve", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const userId = c.get("userId") as string;
  const svc = serviceClient();
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }

  const templateItemId = String(body?.template_item_id ?? "").trim();
  if (!templateItemId) return jsonErr(c, "missing_template_item_id", "template_item_id required", 400);

  const productNumber = body?.product_number == null ? null : String(body.product_number).trim();
  if (!productNumber) {
    return jsonErr(c, "missing_product_number",
      "SRS approve requires a real productNumber (catalog rows with productNumber=null are needs_review only)",
      400);
  }
  const productId = body?.product_id == null ? null : String(body.product_id).trim();
  const productName = body?.product_name == null ? null : String(body.product_name);
  const uomsIn = Array.isArray(body?.valid_uoms) ? body.valid_uoms.map((u: any) => String(u).toUpperCase()) : [];
  const defaultUom = body?.default_uom ? String(body.default_uom).toUpperCase() : (uomsIn[0] ?? null);
  const branchScope = Array.isArray(body?.branch_scope) ? body.branch_scope.map((b: any) => String(b)) : [];

  const upsert = {
    tenant_id: tenantId,
    template_item_id: templateItemId,
    supplier: "srs" as const,
    supplier_item_number: productNumber,
    supplier_product_id: productId,
    supplier_item_description: productName,
    valid_uoms: uomsIn,
    default_uom: defaultUom,
    branch_scope: branchScope,
    mapping_status: "approved" as const,
    match_confidence: body?.match_confidence ?? null,
    match_reason: body?.match_reason ?? "manual_approve",
    raw_catalog_payload: body?.raw_catalog_payload ?? null,
    last_checked_at: new Date().toISOString(),
    approved_by: userId,
    approved_at: new Date().toISOString(),
    // legacy mirror so older code paths keep working
    supplier_item_code: productNumber,
    review_state: "approved",
    uom: defaultUom,
  };

  const { data, error } = await svc
    .from("template_item_supplier_mappings")
    .upsert(upsert, { onConflict: "tenant_id,template_item_id,supplier" })
    .select("*")
    .single();
  if (error) return jsonErr(c, "mapping_approve_failed", error.message, 500);
  return jsonOk(c, { mapping: data });
});

// ---------------------------------------------------------------------------
// POST /mapping/reject  — mark mapping_status=rejected (or remove if not exists)
// ---------------------------------------------------------------------------
app.post("/mapping/reject", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const userId = c.get("userId") as string;
  const svc = serviceClient();
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }
  const templateItemId = String(body?.template_item_id ?? "").trim();
  if (!templateItemId) return jsonErr(c, "missing_template_item_id", "template_item_id required", 400);

  const { data, error } = await svc
    .from("template_item_supplier_mappings")
    .upsert({
      tenant_id: tenantId,
      template_item_id: templateItemId,
      supplier: "srs",
      mapping_status: "rejected",
      match_reason: body?.reason ?? "manual_reject",
      approved_by: userId,
      approved_at: new Date().toISOString(),
      review_state: "rejected",
    }, { onConflict: "tenant_id,template_item_id,supplier" })
    .select("*")
    .single();
  if (error) return jsonErr(c, "mapping_reject_failed", error.message, 500);
  return jsonOk(c, { mapping: data });
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
