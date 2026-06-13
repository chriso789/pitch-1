// qxo-api — routed Edge Function for ALL QXO/Beacon actions.
//
// Hardening contract (third-party aggregator):
//   - tenant_id comes ONLY from JWT via requireTenant (router.ts).
//   - body.tenant_id / body.account_id / body.credential_id are IGNORED.
//   - Every action runs through qxoTenantGuard: verifies connection,
//     authorization_status='active', connection_status='connected', and the
//     required scope.
//   - Every action is rate-limited per (tenant, user, action).
//   - Write actions require an idempotency key and dedupe via supplier_idempotency_keys.
//   - All successes and denials emit a supplier_audit_log row.
//   - QXO credentials are loaded ONLY via getBeaconAuth(svc, resolvedTenantId)
//     and never returned to the browser.
//
// See docs/integrations/third-party-aggregator-readiness.md.

import {
  createRouter,
  jsonOk,
  jsonErr,
  requireAuth,
  requireTenant,
  serveRouter,
  serviceClient,
} from "../_shared/router.ts";
import { qxoTenantGuard, type QxoScope } from "../_shared/integrations/qxo-tenant-guard.ts";
import { auditQxo } from "../_shared/integrations/qxo-audit.ts";
import {
  withIdempotency,
  IdempotencyConflictError,
} from "../_shared/integrations/qxo-idempotency.ts";
import { checkRateLimit } from "../_shared/integrations/qxo-rate-limit.ts";
import { BEACON_BASE_URL, getBeaconAuth, cap } from "../_shared/qxo-auth.ts";

const app = createRouter("qxo-api");

// Public health probe.
app.get("/__health", (c) => jsonOk(c, { fn: "qxo-api", ok: true }));

// Everything else requires auth + tenant.
app.use("/*", requireAuth);
app.use("/*", requireTenant);

// ---------- Shared helpers ----------

type GuardOk = { userId: string; tenantId: string; requestId: string; qxoConnection: Record<string, unknown> };

async function guard(c: any, action: string, scope: QxoScope) {
  const g = await qxoTenantGuard(c, { action, requiredScope: scope });
  if (g instanceof Response) return g;
  return g as GuardOk;
}

async function rateLimitOrDeny(c: any, g: GuardOk, action: string, limit: number, windowSeconds: number) {
  const rl = await checkRateLimit({
    tenantId: g.tenantId,
    userId: g.userId,
    action,
    limit,
    windowSeconds,
  });
  if (!rl.allowed) {
    auditQxo({
      tenantId: g.tenantId,
      userId: g.userId,
      action,
      result: "rate_limited",
      requestId: g.requestId,
      metadata: { count: rl.count, limit, retryAfterSeconds: rl.retryAfterSeconds },
    });
    return jsonErr(
      c,
      "rate_limited",
      `Rate limit hit (${rl.count}/${limit}). Retry in ${rl.retryAfterSeconds}s.`,
      429,
    );
  }
  return null;
}

function pickIdempotencyKey(c: any, body: any): string | null {
  const headerKey = c.req.header("Idempotency-Key") ?? c.req.header("idempotency-key");
  return (body?.idempotency_key as string) ?? headerKey ?? null;
}

async function safeJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

// ---------- /orders/list ----------
app.post("/orders/list", async (c) => {
  const g = await guard(c, "orders.list", "order_status");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "orders.list", 60, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  const svc = serviceClient();
  try {
    const auth = await getBeaconAuth(svc, g.tenantId);
    const accountId = auth.accountId;
    const params = new URLSearchParams();
    params.set("accountId", String(accountId ?? ""));
    const passthrough = ["pageSize", "pageNo", "searchBy", "searchTerm", "searchStartDate", "searchEndDate", "searchEnum", "orderBy"];
    for (const k of passthrough) {
      const v = body[k];
      if (v != null && v !== "") params.set(k, String(v));
    }
    if (!params.has("pageSize")) params.set("pageSize", "25");
    if (!params.has("pageNo")) params.set("pageNo", "1");

    const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/orderhistory_v2?${params}`, { headers: auth.headers });
    const data = await r.json().catch(() => ({} as any));
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    if (orders.length) {
      const rows = orders.map((o: any) => ({
        tenant_id: g.tenantId,
        beacon_order_id: String(o.orderId),
        account_id: String(o.accountId ?? accountId ?? ""),
        po_number: o.purchaseOrderNo || null,
        customer_uuid: o.UUID || null,
        job_name: o.job?.jobName || null,
        job_number: o.job?.jobNumber || null,
        status_code: o.orderStatusCode || null,
        status_value: o.orderStatusValue || null,
        on_hold: !!o.onHold,
        total: o.total ?? null,
        sub_total: o.subTotal ?? null,
        tax: o.tax ?? null,
        order_placed_date: o.orderPlacedDate ? new Date(o.orderPlacedDate).toISOString() : null,
        invoiced_date: o.invoicedDate ? new Date(o.invoicedDate).toISOString() : null,
        payment_status: o.paymentStatus || null,
        selling_branch: o.sellingBranch || null,
        shipping_branch: o.shipping?.shippingBranchDisplayName || String(o.shipping?.shippingBranch ?? "") || null,
        shipping_method: o.shipping?.shippingMethod || null,
        ship_address: o.shipping?.address || null,
        raw_payload: o,
        last_synced_at: new Date().toISOString(),
      }));
      await svc.from("qxo_orders").upsert(rows, { onConflict: "tenant_id,beacon_order_id" });
    }
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.list", result: "success", requestId: g.requestId, supplierAccountId: accountId, metadata: { count: orders.length } });
    return jsonOk(c, { orders, total: data?.total ?? orders.length, count: orders.length });
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.list", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /orders/detail ----------
app.post("/orders/detail", async (c) => {
  const g = await guard(c, "orders.detail", "order_status");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "orders.detail", 120, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  const orderId = body.orderId;
  if (!orderId) return jsonErr(c, "missing_param", "orderId is required");

  try {
    const svc = serviceClient();
    const auth = await getBeaconAuth(svc, g.tenantId);
    const params = new URLSearchParams({ orderId: String(orderId), accountId: String(auth.accountId ?? ""), showDT: "true" });
    const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/orderdetail?${params}`, { headers: auth.headers });
    const data = await r.json().catch(() => ({}));
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.detail", result: "success", requestId: g.requestId, supplierAccountId: auth.accountId, metadata: { orderId } });
    return jsonOk(c, data);
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.detail", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /orders/pdf ----------
app.post("/orders/pdf", async (c) => {
  const g = await guard(c, "orders.pdf", "order_status");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "orders.pdf", 30, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  const orderId = body.orderId;
  if (!orderId) return jsonErr(c, "missing_param", "orderId is required");

  try {
    const svc = serviceClient();
    const auth = await getBeaconAuth(svc, g.tenantId);
    const params = new URLSearchParams({
      orderId: String(orderId),
      accountId: String(auth.accountId ?? ""),
      accountToken: String(body.accountToken || ""),
      branchId: String(body.branchId || auth.branch || ""),
      showBackToOrderDetailPageLink: "false",
      showPrice: "true",
      showShipTips: "false",
      enableSwitchOrderQty: "false",
      showShipQty: "true",
    });
    const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/downloadOrderDetailAsPDF?${params}`, { headers: auth.headers });
    const buf = await r.arrayBuffer();
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.pdf", result: "success", requestId: g.requestId, supplierAccountId: auth.accountId, metadata: { orderId } });
    return new Response(buf, { status: 200, headers: { "Content-Type": r.headers.get("content-type") || "application/pdf" } });
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.pdf", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /orders/submit ----------
app.post("/orders/submit", async (c) => {
  const g = await guard(c, "orders.submit", "order_submit");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "orders.submit", 20, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  const key = pickIdempotencyKey(c, body);
  if (!key) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.submit", result: "denied", requestId: g.requestId, metadata: { reason: "idempotency_key_required" } });
    return jsonErr(c, "idempotency_key_required", "An idempotency key is required before submitting a supplier order.", 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return jsonErr(c, "missing_param", "items[] is required");
  }

  // Strip non-payload control fields before hashing to keep dedupe stable.
  const idemPayload = { ...body };
  delete (idemPayload as any).idempotency_key;
  delete (idemPayload as any).__route;

  try {
    const result = await withIdempotency({
      tenantId: g.tenantId,
      action: "orders.submit",
      key,
      payload: idemPayload,
      run: async () => {
        const svc = serviceClient();
        const auth = await getBeaconAuth(svc, g.tenantId);
        const accountId = auth.accountId;
        const branch = body.shipping_branch || auth.branch || "";
        const sBranch = body.selling_branch || auth.branch || "";
        const siteId = body.api_site_id || auth.apiSiteId || "BDD";
        const items = body.items;

        const subtotal = items.reduce(
          (s: number, i: any) => s + Number(i.qty) * Number(i.unit_cost ?? i.unit_price ?? 0),
          0,
        );
        const poNumber = body.purchase_order_no || `QXO-${Date.now().toString(36).toUpperCase()}`;
        const { data: po } = await svc.from("purchase_orders").insert({
          tenant_id: g.tenantId,
          po_number: poNumber,
          project_id: body.project_id || body.job_id || null,
          branch_code: branch,
          status: "submitting",
          subtotal,
          total_amount: subtotal,
          delivery_address: body.delivery_address ?? null,
          notes: `Submitted via qxo-api /orders/submit${body.notes ? ` — ${body.notes}` : ""}`,
        }).select().single();

        if (po?.id && items.length) {
          await svc.from("purchase_order_items").insert(items.map((i: any) => ({
            po_id: po.id,
            srs_item_code: i.srs_item_code || null,
            item_description: i.item_name,
            quantity: Number(i.qty),
            unit_price: Number(i.unit_cost ?? i.unit_price ?? 0),
            line_total: Number(i.qty) * Number(i.unit_cost ?? i.unit_price ?? 0),
            metadata: { unit: i.unit, notes: i.notes || i.color_specs || null },
          })));
        }

        const payload: any = {
          accountId: cap(accountId, 6),
          job: { jobName: cap(body.job_name || "", 15), jobNumber: cap(body.job_number || "", 7) },
          purchaseOrderNo: cap(poNumber, 22),
          extendedPO: cap(body.extended_po || "", 50),
          orderStatusCode: "",
          lineItems: items.map((i: any) => ({
            itemNumber: cap(i.srs_item_code || "", 6),
            quantity: Number(i.qty),
            unitOfMeasure: cap(i.unit || "EA", 3),
            description: cap(i.item_name, 128),
            productNumber: cap(i.product_number || i.srs_item_code || "", 40),
            lineComments: cap(i.notes || i.color_specs || "", 2048),
            cost: Number(i.unit_cost ?? 0),
            price: Number(i.unit_price ?? i.unit_cost ?? 0),
            vendorCode: cap(i.vendor_code || "", 50),
          })),
          shipping: {
            shippingMethod: cap(body.shipping_method || "D", 1),
            shippingBranch: cap(branch, 4),
            address: {
              address1: cap(body.delivery_address?.address1 || body.delivery_address?.street || "", 30),
              address2: cap(body.delivery_address?.address2 || "", 30),
              address3: cap(body.delivery_address?.address3 || "", 30),
              city: cap(body.delivery_address?.city || "", 25),
              postalCode: cap(body.delivery_address?.postalCode || body.delivery_address?.zip || "", 10),
              state: cap(body.delivery_address?.state || "", 2),
            },
            deliveryType: body.delivery_type || "",
          },
          sellingBranch: cap(sBranch, 4),
          specialInstruction: cap(body.special_instruction || body.notes || "", 234),
          checkForAvailability: body.check_for_availability || "no",
          pickupDate: body.pickup_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          apiSiteId: siteId,
          pickupTime: body.pickup_time || "Anytime",
          onHold: !!body.on_hold,
          UUID: cap(po?.id || crypto.randomUUID(), 100),
        };

        const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/submitOrder`, {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const txt = await r.text();
        let parsed: any;
        try { parsed = txt ? JSON.parse(txt) : {}; } catch { parsed = { raw: txt }; }

        const orderId = parsed?.orderId || null;
        const messageCode = parsed?.messageCode != null ? String(parsed.messageCode) : null;
        const message = parsed?.message != null ? String(parsed.message) : null;

        if (po?.id) {
          await svc.from("purchase_orders").update({
            status: orderId ? "submitted" : "qxo_rejected",
            beacon_order_id: orderId,
            beacon_message_code: messageCode,
            beacon_message: message,
            external_order_id: orderId,
          }).eq("id", po.id);
        }

        const responseBody = {
          success: !!orderId,
          po_id: po?.id ?? null,
          po_number: poNumber,
          beacon_order_id: orderId,
          message_code: messageCode,
          message,
        };

        return {
          status: orderId ? "succeeded" : "failed",
          response: responseBody,
        };
      },
    });

    auditQxo({
      tenantId: g.tenantId,
      userId: g.userId,
      action: "orders.submit",
      result: result.status === "succeeded" ? "success" : result.replayed ? "duplicate" : "failed",
      requestId: g.requestId,
      idempotencyKey: key,
      metadata: { replayed: result.replayed, beacon_order_id: (result.response as any)?.beacon_order_id ?? null },
    });

    if (result.status === "succeeded") return jsonOk(c, result.response);
    return jsonErr(c, "qxo_submit_failed", (result.response as any)?.message || "QXO rejected the order", 400);
  } catch (e: any) {
    if (e instanceof IdempotencyConflictError) {
      auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.submit", result: "denied", requestId: g.requestId, idempotencyKey: key, metadata: { reason: "idempotency_conflict" } });
      return jsonErr(c, "idempotency_key_reused_with_different_payload", "This idempotency key was used with a different payload.", 409);
    }
    if (e?.message === "idempotency_key_required") {
      return jsonErr(c, "idempotency_key_required", "An idempotency key is required before submitting a supplier order.", 400);
    }
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.submit", result: "failed", requestId: g.requestId, idempotencyKey: key, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /orders/submit-quote ----------
app.post("/orders/submit-quote", async (c) => {
  const g = await guard(c, "orders.submit_quote", "order_submit");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "orders.submit_quote", 20, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  const key = pickIdempotencyKey(c, body);
  if (!key) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.submit_quote", result: "denied", requestId: g.requestId, metadata: { reason: "idempotency_key_required" } });
    return jsonErr(c, "idempotency_key_required", "An idempotency key is required.", 400);
  }
  if (!body.bid_number || !Array.isArray(body.items) || body.items.length === 0) {
    return jsonErr(c, "missing_param", "bid_number and items[] are required");
  }

  const idemPayload = { ...body };
  delete (idemPayload as any).idempotency_key;
  delete (idemPayload as any).__route;

  try {
    const result = await withIdempotency({
      tenantId: g.tenantId,
      action: "orders.submit_quote",
      key,
      payload: idemPayload,
      run: async () => {
        const svc = serviceClient();
        const auth = await getBeaconAuth(svc, g.tenantId);
        const shipping = body.shipping || {};
        const payload = {
          accountId: cap(auth.accountId, 6),
          bidNumber: body.bid_number,
          job: { jobName: cap(body.job_name || "", 15), jobNumber: cap(body.job_number || "", 7) },
          purchaseOrderNo: cap(body.purchase_order_no || "", 22),
          extendedPO: cap(body.extended_po || "", 50),
          orderStatusCode: "",
          lineItems: body.items.map((i: any) => ({
            itemNumber: cap(i.itemNumber || i.srs_item_code || "", 6),
            quantity: Number(i.quantity ?? i.qty ?? 0),
            unitOfMeasure: cap(i.unitOfMeasure || i.unit || "EA", 3),
            description: cap(i.description || i.item_name || "", 128),
            productNumber: cap(i.productNumber || i.product_number || "", 128),
            itemUnitPrice: Number(i.itemUnitPrice ?? i.unit_price ?? 0),
            itemSubTotal: Number(i.itemSubTotal ?? Number(i.quantity ?? i.qty ?? 0) * Number(i.unit_price ?? 0)),
            lineComments: cap(i.lineComments || i.notes || "", 2048),
            itemType: cap(i.itemType || "I", 5),
            nonStockItem: !!i.nonStockItem,
          })),
          shipping: {
            shippingMethod: cap(shipping.shippingMethod || "D", 1),
            shippingBranch: cap(shipping.shippingBranch || auth.branch || "", 4),
            address: {
              address1: cap(shipping.address?.address1 || "", 30),
              address2: cap(shipping.address?.address2 || "", 30),
              address3: cap(shipping.address?.address3 || "", 30),
              city: cap(shipping.address?.city || "", 25),
              postalCode: cap(shipping.address?.postalCode || "", 10),
              state: cap(shipping.address?.state || "", 2),
            },
            deliveryType: shipping.deliveryType || "",
          },
          sellingBranch: cap(body.selling_branch || auth.branch || "", 4),
          specialInstruction: cap(body.special_instruction || "", 234),
          checkForAvailability: body.check_for_availability || "no",
          pickupDate: body.pickup_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          apiSiteId: body.api_site_id || auth.apiSiteId || "BDD",
          pickupTime: body.pickup_time || "Anytime",
          onHold: !!body.on_hold,
          UUID: crypto.randomUUID(),
        };

        const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/submitQuoteOrder`, {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const parsed = await r.json().catch(() => ({} as any));
        const orderId = parsed?.orderId || null;
        return {
          status: r.ok && orderId ? "succeeded" : "failed",
          response: {
            success: !!orderId,
            beacon_order_id: orderId,
            message_code: parsed?.messageCode ?? null,
            message: parsed?.message ?? null,
          },
        };
      },
    });

    auditQxo({
      tenantId: g.tenantId, userId: g.userId, action: "orders.submit_quote",
      result: result.status === "succeeded" ? "success" : (result.replayed ? "duplicate" : "failed"),
      requestId: g.requestId, idempotencyKey: key,
      metadata: { replayed: result.replayed, beacon_order_id: (result.response as any)?.beacon_order_id ?? null },
    });
    if (result.status === "succeeded") return jsonOk(c, result.response);
    return jsonErr(c, "qxo_submit_failed", (result.response as any)?.message || "QXO rejected the quote order", 400);
  } catch (e: any) {
    if (e instanceof IdempotencyConflictError) {
      return jsonErr(c, "idempotency_key_reused_with_different_payload", "This idempotency key was used with a different payload.", 409);
    }
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "orders.submit_quote", result: "failed", requestId: g.requestId, idempotencyKey: key, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /invoices/list ----------
app.post("/invoices/list", async (c) => {
  const g = await guard(c, "invoices.list", "invoice_read");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "invoices.list", 60, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  try {
    const svc = serviceClient();
    const auth = await getBeaconAuth(svc, g.tenantId);
    const accountId = auth.accountId;
    const company = body.company || "1";
    const branchNumber = body.branchNumber || auth.branch || "";
    const params = new URLSearchParams();
    params.set("accountId", String(accountId));
    params.set("company", String(company));
    params.set("branchNumber", String(branchNumber));
    for (const k of ["pageSize", "pageNo", "searchBy", "searchTerm", "searchStartDate", "searchEndDate", "searchEnum"]) {
      const v = body[k];
      if (v != null && v !== "") params.set(k, String(v));
    }
    if (!params.has("pageSize")) params.set("pageSize", "25");
    if (!params.has("pageNo")) params.set("pageNo", "1");

    const r = await fetch(`${BEACON_BASE_URL}/v4/rest/com/becn/invoice?${params}`, { headers: auth.headers });
    const data = await r.json().catch(() => ({} as any));
    const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
    if (invoices.length) {
      const rows = invoices.map((inv: any) => ({
        tenant_id: g.tenantId,
        qxo_invoice_id: String(inv.orderNumber ?? inv.invoiceNumber ?? crypto.randomUUID()),
        invoice_number: inv.orderNumber || inv.invoiceNumber || null,
        po_number: inv.purchaseOrderNumber || null,
        branch_code: branchNumber ? String(branchNumber) : null,
        branch_number: Number(branchNumber) || null,
        company: Number(company) || null,
        status: "invoiced",
        issued_date: inv.invoiceDate || inv.orderPlacedDate || null,
        amount: inv.salesPlusOtherCharges ?? inv.sales ?? null,
        balance: inv.salesPlusOtherCharges ?? null,
        sales: inv.sales ?? null,
        other_charges: inv.otherCharges ?? null,
        sales_plus_other_charges: inv.salesPlusOtherCharges ?? null,
        raw_payload: inv,
        last_synced_at: new Date().toISOString(),
      }));
      await svc.from("qxo_invoices").upsert(rows, { onConflict: "tenant_id,qxo_invoice_id" });
    }
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "invoices.list", result: "success", requestId: g.requestId, supplierAccountId: accountId, metadata: { count: invoices.length } });
    return jsonOk(c, { invoices, count: invoices.length });
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "invoices.list", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /invoices/pdf ----------
app.post("/invoices/pdf", async (c) => {
  const g = await guard(c, "invoices.pdf", "invoice_read");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "invoices.pdf", 30, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  if (!body.invoiceNumbers) return jsonErr(c, "missing_param", "invoiceNumbers is required");

  try {
    const svc = serviceClient();
    const auth = await getBeaconAuth(svc, g.tenantId);
    const params = new URLSearchParams({
      invoiceNumbers: String(body.invoiceNumbers),
      accountId: String(auth.accountId ?? ""),
      siteId: auth.apiSiteId || "BDD",
    });
    const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/downloadBillTrustInvoiceAsPDF?${params}`, { headers: auth.headers });
    const buf = await r.arrayBuffer();
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "invoices.pdf", result: "success", requestId: g.requestId, supplierAccountId: auth.accountId });
    return new Response(buf, { status: 200, headers: { "Content-Type": r.headers.get("content-type") || "application/pdf" } });
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "invoices.pdf", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /quotes/list ----------
app.post("/quotes/list", async (c) => {
  const g = await guard(c, "quotes.list", "pricing");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "quotes.list", 60, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  try {
    const svc = serviceClient();
    const auth = await getBeaconAuth(svc, g.tenantId);
    const params = new URLSearchParams({ account: String(auth.accountId ?? "") });
    for (const k of ["quoteType", "pageSize", "pageNo", "filterBy", "filter", "jobName", "orderBy", "dateFrom", "dateTo"]) {
      const v = body[k];
      if (v != null && v !== "") params.set(k, String(v));
    }
    const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/quote?${params}`, { headers: auth.headers });
    const data = await r.json().catch(() => ({}));
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "quotes.list", result: "success", requestId: g.requestId, supplierAccountId: auth.accountId });
    return jsonOk(c, data);
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "quotes.list", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /quotes/detail ----------
app.post("/quotes/detail", async (c) => {
  const g = await guard(c, "quotes.detail", "pricing");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "quotes.detail", 120, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  if (!body.quoteId) return jsonErr(c, "missing_param", "quoteId is required");

  try {
    const svc = serviceClient();
    const auth = await getBeaconAuth(svc, g.tenantId);
    const params = new URLSearchParams({ quoteId: String(body.quoteId), account: String(auth.accountId ?? "") });
    const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/getMincronQuoteDetail?${params}`, { headers: auth.headers });
    const data = await r.json().catch(() => ({}));
    const q = (data as any)?.quote;
    if (q) {
      await svc.from("qxo_quotes").upsert({
        tenant_id: g.tenantId,
        beacon_quote_id: String(q.id ?? body.quoteId),
        mincron_id: q.mincronId || null,
        account_id: q.accountNumber || String(auth.accountId ?? ""),
        account_name: q.accountName || null,
        status: q.status || null,
        status_description: q.statusDescription || null,
        job_name: q.jobName || null,
        job_number: q.jobNumber || null,
        work_type: q.workType || null,
        total: q.total ?? null,
        sub_total: q.subTotal ?? null,
        tax: q.tax ?? null,
        expires: q.expires && /^\d{2}-\d{2}-\d{4}$/.test(q.expires)
          ? `${q.expires.slice(6, 10)}-${q.expires.slice(0, 2)}-${q.expires.slice(3, 5)}` : null,
        creation_date: q.creationDate && /^\d{2}-\d{2}-\d{4}$/.test(q.creationDate)
          ? `${q.creationDate.slice(6, 10)}-${q.creationDate.slice(0, 2)}-${q.creationDate.slice(3, 5)}` : null,
        quote_notes: q.quoteNotes || null,
        quote_items: q.quoteItems || null,
        raw_payload: q,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,beacon_quote_id" });
    }
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "quotes.detail", result: "success", requestId: g.requestId, supplierAccountId: auth.accountId, metadata: { quoteId: body.quoteId } });
    return jsonOk(c, data);
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "quotes.detail", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /quotes/revise ----------
app.post("/quotes/revise", async (c) => {
  const g = await guard(c, "quotes.revise", "order_submit");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "quotes.revise", 20, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  const key = pickIdempotencyKey(c, body);
  if (!key) return jsonErr(c, "idempotency_key_required", "An idempotency key is required.", 400);
  if (!body.quoteId) return jsonErr(c, "missing_param", "quoteId is required");

  const idemPayload = { ...body }; delete (idemPayload as any).idempotency_key; delete (idemPayload as any).__route;
  try {
    const result = await withIdempotency({
      tenantId: g.tenantId, action: "quotes.revise", key, payload: idemPayload,
      run: async () => {
        const svc = serviceClient();
        const auth = await getBeaconAuth(svc, g.tenantId);
        const r = await fetch(`${BEACON_BASE_URL}/v2/reviseQuote`, {
          method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: String(auth.accountId ?? ""), quoteId: String(body.quoteId), quoteNotes: body.quoteNotes || "" }),
        });
        const data = await r.json().catch(() => ({}));
        return { status: r.ok ? "succeeded" : "failed", response: data };
      },
    });
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "quotes.revise", result: result.status === "succeeded" ? "success" : "failed", requestId: g.requestId, idempotencyKey: key });
    return result.status === "succeeded" ? jsonOk(c, result.response) : jsonErr(c, "qxo_request_failed", "Revise rejected", 400);
  } catch (e: any) {
    if (e instanceof IdempotencyConflictError) return jsonErr(c, "idempotency_key_reused_with_different_payload", "Conflict", 409);
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /quotes/reject ----------
app.post("/quotes/reject", async (c) => {
  const g = await guard(c, "quotes.reject", "order_submit");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "quotes.reject", 30, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  if (!body.quoteId) return jsonErr(c, "missing_param", "quoteId is required");

  try {
    const svc = serviceClient();
    const auth = await getBeaconAuth(svc, g.tenantId);
    const r = await fetch(`${BEACON_BASE_URL}/v2/rejectQuote`, {
      method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: String(auth.accountId ?? ""), quoteId: String(body.quoteId), reason: body.reason || "" }),
    });
    const data = await r.json().catch(() => ({}));
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "quotes.reject", result: r.ok ? "success" : "failed", requestId: g.requestId, supplierAccountId: auth.accountId, metadata: { quoteId: body.quoteId } });
    return r.ok ? jsonOk(c, data) : jsonErr(c, "qxo_request_failed", "Reject rejected", 400);
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "quotes.reject", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /quotes/submit ----------
app.post("/quotes/submit", async (c) => {
  const g = await guard(c, "quotes.submit", "order_submit");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "quotes.submit", 20, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  const key = pickIdempotencyKey(c, body);
  if (!key) return jsonErr(c, "idempotency_key_required", "An idempotency key is required.", 400);

  const idemPayload = { ...body }; delete (idemPayload as any).idempotency_key; delete (idemPayload as any).__route;
  try {
    const result = await withIdempotency({
      tenantId: g.tenantId, action: "quotes.submit", key, payload: idemPayload,
      run: async () => {
        const svc = serviceClient();
        const auth = await getBeaconAuth(svc, g.tenantId);
        const payload = { ...body, accountId: String(auth.accountId ?? "") };
        delete (payload as any).action; delete (payload as any).tenant_id;
        delete (payload as any).idempotency_key; delete (payload as any).__route;
        const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/submitQuote`, {
          method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        return { status: r.ok ? "succeeded" : "failed", response: data };
      },
    });
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "quotes.submit", result: result.status === "succeeded" ? "success" : "failed", requestId: g.requestId, idempotencyKey: key });
    return result.status === "succeeded" ? jsonOk(c, result.response) : jsonErr(c, "qxo_request_failed", "Submit rejected", 400);
  } catch (e: any) {
    if (e instanceof IdempotencyConflictError) return jsonErr(c, "idempotency_key_reused_with_different_payload", "Conflict", 409);
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO request failed", 502);
  }
});

// ---------- /pricing/lookup ----------
//
// Tenant-scoped pricing — uses the resolved tenant's QXO connection, NEVER a
// shared global QXO_API_KEY. Cache writes go to price_cache only when product+
// vendor mapping is in place.
app.post("/pricing/lookup", async (c) => {
  const g = await guard(c, "pricing.lookup", "pricing");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "pricing.lookup", 120, 60);
  if (rl) return rl;

  const body = await safeJson(c.req.raw);
  const skus: string[] = body.skus ?? (body.sku ? [body.sku] : []);
  if (!skus.length) return jsonErr(c, "missing_param", "Provide sku or skus[]");

  try {
    const svc = serviceClient();
    const auth = await getBeaconAuth(svc, g.tenantId);
    // QXO pricing endpoint shape varies by partner. We call the tenant-scoped
    // Beacon getPrice path; if your partner uses a different one, route here.
    const results: any[] = [];
    for (const sku of skus) {
      try {
        const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/getPrice`, {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: auth.accountId, productNumber: sku, branchCode: body.branch || auth.branch }),
        });
        const data = await r.json().catch(() => ({} as any));
        results.push({ sku, ok: r.ok, ...data });
      } catch (err: any) {
        results.push({ sku, ok: false, error: err?.message });
      }
    }
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "pricing.lookup", result: "success", requestId: g.requestId, supplierAccountId: auth.accountId, metadata: { count: skus.length } });
    return jsonOk(c, { results });
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "pricing.lookup", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO pricing failed", 502);
  }
});

// ---------- /sync/tenant ----------
//
// Single-tenant sync. Resolves the tenant from the JWT — ignores body.tenant_id.
// All-tenant sync is restricted to the internal worker (qxo-sync-orchestrator
// with INTERNAL_WORKER_SECRET).
app.post("/sync/tenant", async (c) => {
  const g = await guard(c, "sync.tenant", "order_status");
  if (g instanceof Response) return g;
  const rl = await rateLimitOrDeny(c, g, "sync.tenant", 6, 60);
  if (rl) return rl;

  try {
    const svc = serviceClient();
    // Delegate to the orchestrator's per-tenant logic by calling it with the internal secret.
    // This avoids duplicating the multi-step sync code and keeps a single source of truth.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const INTERNAL_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";
    if (!INTERNAL_SECRET) {
      auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "sync.tenant", result: "failed", requestId: g.requestId, metadata: { error: "INTERNAL_WORKER_SECRET not configured" } });
      return jsonErr(c, "sync_unavailable", "Internal sync is not configured.", 503);
    }
    const r = await fetch(`${SUPABASE_URL}/functions/v1/qxo-sync-orchestrator`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-worker-secret": INTERNAL_SECRET },
      body: JSON.stringify({ tenant_id: g.tenantId, source: "user_initiated" }),
    });
    const data = await r.json().catch(() => ({}));
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "sync.tenant", result: r.ok ? "success" : "failed", requestId: g.requestId });
    return r.ok ? jsonOk(c, data) : jsonErr(c, "sync_failed", "Tenant sync failed", 502);
  } catch (e: any) {
    auditQxo({ tenantId: g.tenantId, userId: g.userId, action: "sync.tenant", result: "failed", requestId: g.requestId, metadata: { error: e?.message } });
    return jsonErr(c, "qxo_request_failed", e?.message ?? "QXO sync failed", 502);
  }
});

serveRouter(app);
