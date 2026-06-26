// centz-webhook — public Centz invoice webhook receiver.
//
// Approved standalone function (provider callback URL). Centz POSTs here for:
//   - SMS/email delivery failures
//   - customer link clicks
//   - customer payments on the invoice
//
// All payloads are stored in centz_webhook_events (idempotent by event_id).
// We then defensively map the event onto centz_invoices.status.

import { createClient } from "npm:@supabase/supabase-js@2";
import { mapCentzPaymentStatus } from "../_shared/centzClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function svc() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pickString(obj: unknown, paths: string[][]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const path of paths) {
    let v: unknown = obj;
    for (const k of path) {
      if (v && typeof v === "object" && k in (v as Record<string, unknown>)) {
        v = (v as Record<string, unknown>)[k];
      } else { v = undefined; break; }
    }
    if (typeof v === "string" && v.length) return v;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(rawBody); } catch { /* keep empty; raw saved */ }

  // Defensive event_id derivation
  const idFromPayload = pickString(payload, [
    ["id"], ["event_id"], ["notification_id"],
    ["payment", "id"], ["data", "payment", "id"],
  ]);
  const invoiceExternalId = pickString(payload, [
    ["external_id"], ["invoice_external_id"],
    ["invoice", "external_id"],
    ["data", "external_id"], ["data", "invoice", "external_id"],
  ]);
  const eventType = pickString(payload, [
    ["type"], ["event"], ["action"], ["description"],
    ["notification", "description"],
  ]) ?? "unknown";
  const eventId = idFromPayload ??
    (invoiceExternalId ? `${invoiceExternalId}:${eventType}:${Date.now()}` : await sha256(rawBody));

  // Pull any payment statuses present in payload
  const candidates: Array<{ status?: string }> = [];
  const collect = (arr: unknown) => Array.isArray(arr) ? candidates.push(...(arr as Array<{ status?: string }>)) : void 0;
  collect((payload as any)?.payments);
  collect((payload as any)?.invoice?.payments);
  collect((payload as any)?.data?.payments);
  const primaryPaymentStatus =
    candidates.map((p) => p?.status).find(Boolean) as string | undefined;

  const sb = svc();

  // 1. Idempotent persist of raw event
  const eventInsert = await sb.from("centz_webhook_events").upsert(
    {
      event_id: eventId,
      event_type: eventType,
      invoice_external_id: invoiceExternalId,
      payment_status: primaryPaymentStatus ?? null,
      payload: payload as object,
    },
    { onConflict: "event_id" },
  );
  if (eventInsert.error) {
    console.error("[centz-webhook] event upsert error", eventInsert.error);
  }

  // 2. If we can match a local invoice, update status defensively
  let matchedInvoiceId: string | null = null;
  let unmatchedReason: string | null = null;

  if (!invoiceExternalId) {
    unmatchedReason = "no_invoice_external_id_in_payload";
  } else {
    const { data: invRow, error: lookupErr } = await sb
      .from("centz_invoices")
      .select("id, tenant_id, status, paid_at, viewed_at")
      .eq("external_id", invoiceExternalId)
      .maybeSingle();

    if (lookupErr) {
      unmatchedReason = `lookup_error:${lookupErr.message}`;
      console.error("[centz-webhook] invoice lookup error", {
        invoiceExternalId,
        eventId,
        eventType,
        error: lookupErr,
      });
    } else if (!invRow) {
      unmatchedReason = "invoice_external_id_not_found";
      console.warn("[centz-webhook] unmatched event — no invoice row", {
        invoiceExternalId,
        eventId,
        eventType,
        primaryPaymentStatus,
      });
    } else {
      matchedInvoiceId = invRow.id;
      const update: Record<string, unknown> = {
        notifications: (payload as any)?.notifications ?? undefined,
        payments: (payload as any)?.payments ?? (payload as any)?.invoice?.payments ?? undefined,
        last_sync_response: payload,
        last_synced_at: new Date().toISOString(),
      };
      const mapped = mapCentzPaymentStatus(primaryPaymentStatus);
      const lowerType = eventType.toLowerCase();

      if (mapped === "paid") {
        update.status = "paid";
        if (!invRow.paid_at) update.paid_at = new Date().toISOString();
      } else if (mapped === "failed") {
        update.status = "failed";
        update.failed_at = new Date().toISOString();
      } else if (mapped === "refunded") {
        update.status = "refunded";
      } else if (mapped === "chargeback" || lowerType.includes("chargeback") || lowerType.includes("dispute")) {
        update.status = "chargeback";
      } else if (lowerType.includes("click") || lowerType.includes("view")) {
        if (invRow.status === "link_created" || invRow.status === "sent") {
          update.status = "viewed";
          if (!invRow.viewed_at) update.viewed_at = new Date().toISOString();
        }
      }

      for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];

      const { error: updErr } = await sb
        .from("centz_invoices")
        .update(update)
        .eq("id", invRow.id);
      if (updErr) console.error("[centz-webhook] invoice update error", updErr);

      await sb.from("centz_webhook_events")
        .update({
          processed_at: new Date().toISOString(),
          invoice_id: invRow.id,
          tenant_id: invRow.tenant_id,
        })
        .eq("event_id", eventId);
    }
  }

  if (unmatchedReason) {
    // Persist the unmatched reason so it's queryable from the DB, not just logs.
    await sb.from("centz_webhook_events")
      .update({
        processed_at: new Date().toISOString(),
        // payload already stored; tag in payment_status field if currently null
      })
      .eq("event_id", eventId);
    console.warn("[centz-webhook] unmatched_event", {
      eventId,
      eventType,
      invoiceExternalId,
      reason: unmatchedReason,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
