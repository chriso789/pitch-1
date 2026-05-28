// supplier-webhook — grouped routed Edge Function for inbound supplier callbacks.
// Public surface (no JWT). Each route resolves its own tenant from a per-registration
// lookup table — NEVER from the request payload.
//
// Routes:
//   POST /abc/events/:webhook_id     — ABC notification webhook (ORDER_UPDATE, ORDER_INVOICED)
//   POST /srs/orders                 — (scaffolded)
//   POST /qxo/orders                 — (scaffolded)
//
// ABC auth model (per partner docs):
//   - No HMAC. ABC issues a per-registration opaque base64 `secret` once at registration.
//   - ORDER_UPDATE   → secret in `Authorization` header (raw or `Bearer <secret>`)
//   - ORDER_INVOICED → secret in body `webhookDetails[].apiKey`
//   - Verification = constant-time string compare.
//   - Duplicate deliveries MUST return 200 (not 409) so ABC stops retrying.

import { createRouter, jsonOk, jsonErr, serviceClient } from "../_shared/router.ts";

const app = createRouter("supplier-webhook");

app.get("/__health", (c) => jsonOk(c, { fn: "supplier-webhook", ok: true }));

// ---------- helpers ----------

function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^bearer\s+/i.test(trimmed)) return trimmed.replace(/^bearer\s+/i, "").trim();
  return trimmed;
}

function pickOrderId(payload: any): {
  order_number?: string;
  confirmation_number?: string;
  purchase_order?: string;
  request_id?: string;
  invoice_number?: string;
  provider_event_id?: string;
} {
  const p = payload || {};
  // ABC payloads vary by event; pull the common identifiers wherever they live.
  const order = p.order || p.orderDetails || p.data || p;
  return {
    order_number: order?.orderNumber || order?.order_number || p.orderNumber || undefined,
    confirmation_number:
      order?.confirmationNumber || order?.confirmation_number || p.confirmationNumber || undefined,
    purchase_order:
      order?.purchaseOrder || order?.purchase_order || p.purchaseOrder || undefined,
    request_id: order?.requestId || order?.request_id || p.requestId || undefined,
    invoice_number:
      order?.invoiceNumber || p.invoiceNumber || (Array.isArray(p.webhookDetails) && p.webhookDetails[0]?.invoiceNumber) || undefined,
    provider_event_id: p.eventId || p.notificationId || p.id || undefined,
  };
}

function pickAbcStatus(payload: any): string | null {
  const p = payload || {};
  const raw =
    p.status ||
    p.orderStatus ||
    p.order?.status ||
    p.order?.orderStatus ||
    p.data?.status ||
    null;
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (["shipped", "delivered", "cancelled", "canceled", "invoiced"].includes(s)) {
    return s === "canceled" ? "cancelled" : s;
  }
  return s;
}

// ---------- ABC webhook receiver ----------

async function handleAbcEvent(c: any) {
  const webhookId = c.req.param("webhook_id");
  if (!webhookId) return jsonErr(c, "missing_webhook_id", "webhook_id missing in path", 400);

  const rawBody = await c.req.text();
  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonErr(c, "invalid_json", "Body is not valid JSON", 400);
  }

  const svc = serviceClient();

  // 1. Resolve tenant from local registration row (NEVER from payload)
  const { data: registration, error: regErr } = await svc
    .from("abc_webhooks")
    .select("id, tenant_id, secret, events, environment, status")
    .eq("id", webhookId)
    .maybeSingle();

  if (regErr) {
    console.error("[supplier-webhook] abc registration lookup failed", regErr.message);
  }

  if (!registration) {
    // Quarantine with tenant_id=null so we can still see the attempt
    try {
      const hash = await sha256Hex(rawBody);
      await svc.from("abc_webhook_events").insert({
        tenant_id: null,
        webhook_id: webhookId,
        provider: "abc",
        event_type: "UNKNOWN",
        payload,
        payload_hash: hash,
        accepted: false,
        signature_match: false,
        signature_valid: false,
        quarantine_reason: "unknown_webhook_id",
      });
    } catch (e) {
      console.warn("[supplier-webhook] quarantine insert failed", (e as Error).message);
    }
    return jsonErr(c, "webhook_not_found", "Unknown webhook registration", 404);
  }

  const tenantId = registration.tenant_id as string;
  const storedSecret = (registration.secret as string | null) || "";

  // 2. Determine event type
  const eventType: string =
    payload?.eventType || payload?.event || payload?.type || (Array.isArray(payload?.webhookDetails) ? "ORDER_INVOICED" : "ORDER_UPDATE");

  const normalizedEvent = String(eventType).toUpperCase().includes("INVOIC") ? "ORDER_INVOICED" : "ORDER_UPDATE";

  // 3. Verify secret (constant-time)
  let signatureValid = false;
  let authHeaderPresent = false;

  if (normalizedEvent === "ORDER_UPDATE") {
    const authHeader = c.req.header("authorization") || c.req.header("Authorization") || "";
    authHeaderPresent = !!authHeader;
    const provided = extractBearer(authHeader);
    if (provided && storedSecret) signatureValid = constantTimeEqual(provided, storedSecret);
  } else {
    // ORDER_INVOICED — secret in body webhookDetails[].apiKey
    const details = Array.isArray(payload?.webhookDetails) ? payload.webhookDetails : [];
    for (const d of details) {
      const apiKey = d?.apiKey;
      if (typeof apiKey === "string" && storedSecret && constantTimeEqual(apiKey, storedSecret)) {
        signatureValid = true;
        break;
      }
    }
  }

  const payloadHash = await sha256Hex(rawBody);
  const ids = pickOrderId(payload);

  // 4. Reject invalid signatures (still record the attempt, no mutation)
  if (!signatureValid) {
    try {
      await svc.from("abc_webhook_events").insert({
        tenant_id: tenantId,
        webhook_id: webhookId,
        provider: "abc",
        provider_event_id: ids.provider_event_id ?? null,
        event_type: normalizedEvent,
        order_number: ids.order_number ?? null,
        confirmation_number: ids.confirmation_number ?? null,
        purchase_order: ids.purchase_order ?? null,
        invoice_number: ids.invoice_number ?? null,
        payload,
        payload_hash: payloadHash,
        authorization_header_present: authHeaderPresent,
        signature_match: false,
        signature_valid: false,
        accepted: false,
        quarantine_reason: "invalid_signature",
      });
    } catch (e) {
      console.warn("[supplier-webhook] invalid-signature insert failed", (e as Error).message);
    }
    return jsonErr(c, "invalid_signature", "Webhook signature did not match", 401);
  }

  // 5. Idempotency — try insert, swallow unique-violation as duplicate
  const insertRow: Record<string, unknown> = {
    tenant_id: tenantId,
    webhook_id: webhookId,
    provider: "abc",
    provider_event_id: ids.provider_event_id ?? null,
    event_type: normalizedEvent,
    order_number: ids.order_number ?? null,
    confirmation_number: ids.confirmation_number ?? null,
    purchase_order: ids.purchase_order ?? null,
    invoice_number: ids.invoice_number ?? null,
    payload,
    payload_hash: payloadHash,
    authorization_header_present: authHeaderPresent,
    signature_match: true,
    signature_valid: true,
    accepted: true,
  };

  const { data: eventRow, error: insertErr } = await svc
    .from("abc_webhook_events")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    const msg = (insertErr.message || "").toLowerCase();
    const isDup = msg.includes("duplicate key") || msg.includes("unique constraint") || (insertErr as any).code === "23505";
    if (isDup) {
      // ABC retried — acknowledge so they stop.
      return jsonOk(c, { duplicate: true });
    }
    console.error("[supplier-webhook] event insert failed", insertErr);
    return jsonErr(c, "event_insert_failed", insertErr.message, 500);
  }

  // 6. Match order. Try several keys, tenant-scoped.
  let matchedOrder: { id: string; raw_payload: any } | null = null;
  const orderQuery = svc.from("abc_orders").select("id, raw_payload").eq("tenant_id", tenantId).limit(1);

  for (const [col, val] of [
    ["order_number", ids.order_number],
    ["confirmation_number", ids.confirmation_number],
    ["purchase_order", ids.purchase_order],
    ["request_id", ids.request_id],
  ] as const) {
    if (!val) continue;
    const { data } = await svc
      .from("abc_orders")
      .select("id, raw_payload")
      .eq("tenant_id", tenantId)
      .eq(col, val)
      .maybeSingle();
    if (data) {
      matchedOrder = data as any;
      break;
    }
  }
  void orderQuery; // silence unused

  if (!matchedOrder) {
    await svc
      .from("abc_webhook_events")
      .update({ quarantine_reason: "unresolved_order" })
      .eq("id", (eventRow as any).id);
    // Touch registration last-activity
    await svc
      .from("abc_webhooks")
      .update({ last_event_received_at: new Date().toISOString() })
      .eq("id", webhookId);
    return c.json({ ok: true, quarantined: true, requestId: c.get("requestId") }, 202);
  }

  // 7. Apply event side-effects (tenant-scoped service-role writes)
  const nowIso = new Date().toISOString();
  const rawPayload = (matchedOrder.raw_payload as any) || {};
  rawPayload.webhook_latest = { event_type: normalizedEvent, received_at: nowIso, payload };

  const update: Record<string, unknown> = { raw_payload: rawPayload, updated_at: nowIso };

  if (normalizedEvent === "ORDER_INVOICED") {
    update.order_status = "invoiced";
  } else {
    const abcStatus = pickAbcStatus(payload);
    update.order_status = abcStatus || "updated";
  }

  await svc.from("abc_orders").update(update).eq("id", matchedOrder.id).eq("tenant_id", tenantId);

  // ORDER_INVOICED → upsert abc_invoices / lines (best-effort)
  if (normalizedEvent === "ORDER_INVOICED") {
    try {
      const inv = payload?.invoice || (Array.isArray(payload?.invoices) ? payload.invoices[0] : null) || payload;
      const invoiceNumber = ids.invoice_number || inv?.invoiceNumber;
      if (invoiceNumber) {
        await svc.from("abc_invoices").upsert(
          {
            tenant_id: tenantId,
            invoice_number: invoiceNumber,
            order_number: ids.order_number ?? null,
            bill_to_number: inv?.billToNumber ?? null,
            ship_to_number: inv?.shipToNumber ?? null,
            branch_number: inv?.branchNumber ?? null,
            invoice_date: inv?.invoiceDate ?? null,
            order_date: inv?.orderDate ?? null,
            sub_total: inv?.subTotal ?? null,
            tax_amount: inv?.taxAmount ?? null,
            total_amount: inv?.totalAmount ?? null,
            raw_payload: inv,
          },
          { onConflict: "tenant_id,invoice_number" } as any,
        );
      }
    } catch (e) {
      console.warn("[supplier-webhook] invoice upsert failed", (e as Error).message);
    }
  }

  // Link event back to the order + touch registration
  await svc
    .from("abc_webhook_events")
    .update({ abc_order_id: matchedOrder.id })
    .eq("id", (eventRow as any).id);
  await svc
    .from("abc_webhooks")
    .update({ last_event_received_at: nowIso })
    .eq("id", webhookId);

  return jsonOk(c, { processed: true, event_id: (eventRow as any).id, abc_order_id: matchedOrder.id });
}

// Register on both with and without function-name prefix — Supabase Edge Runtime
// delivers the full URL pathname for direct HTTP webhook calls.
app.post("/abc/events/:webhook_id", handleAbcEvent);
app.post("/supplier-webhook/abc/events/:webhook_id", handleAbcEvent);

// Scaffolded supplier routes (untouched)
app.post("/srs/orders", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/orders", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(app.fetch);
