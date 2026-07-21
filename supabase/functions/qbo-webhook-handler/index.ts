// QBO webhook handler — v2: per-connection environment routing.
//
// 1. Signature verified against BOTH dev and prod verifiers (whichever matches wins
//    and tags the request with webhook_mode).
// 2. Each notification's realm is looked up in qbo_connections; the connection's
//    oauth_app_env MUST match the webhook_mode or the notification is skipped.
// 3. Downstream fetches use the connection-specific host + credentials.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { qboHost } from "../_shared/qbo-host.ts";
import { qboWebhookVerifiers, type QboMode } from "../_shared/qbo-context.ts";
import { getIntuitTid } from "../_shared/qbo-intuit-tid.ts";
import { writeQboApiLog } from "../_shared/qbo-api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, intuit-signature",
};

interface WebhookEvent {
  realmId: string;
  name: string;
  id: string;
  operation: string;
  lastUpdated: string;
}

interface WebhookPayload {
  eventNotifications: Array<{
    realmId: string;
    dataChangeEvent: { entities: WebhookEvent[] };
  }>;
}

function verifyAgainstVerifiers(
  payload: string,
  signature: string,
): { mode: QboMode } | null {
  for (const { mode, verifier } of qboWebhookVerifiers()) {
    const hash = createHmac("sha256", verifier).update(payload).digest("base64");
    if (hash === signature) return { mode };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Always write one qbo_webhook_events row per inbound delivery (verified or not).
  const auditEvent = async (row: {
    tenant_id?: string | null;
    realm_id?: string | null;
    oauth_app_env?: string | null;
    signature_valid: boolean;
    event_count?: number;
    error_code?: string | null;
    error_message?: string | null;
    processed?: boolean;
  }) => {
    try {
      await supabase.from("qbo_webhook_events").insert({
        tenant_id: row.tenant_id ?? null,
        realm_id: row.realm_id ?? null,
        oauth_app_env: row.oauth_app_env ?? null,
        signature_valid: row.signature_valid,
        event_count: row.event_count ?? 0,
        error_code: row.error_code ?? null,
        error_message: row.error_message ?? null,
        processed_at: row.processed ? new Date().toISOString() : null,
      });
    } catch (e) {
      console.error("qbo_webhook_events_insert_failed", e);
    }
  };

  try {
    const signature = req.headers.get("intuit-signature");
    const rawPayload = await req.text();

    if (!signature) {
      console.error("qbo_webhook_signature_missing");
      await auditEvent({ signature_valid: false, error_code: "signature_missing" });
      return new Response("Unauthorized", { status: 401 });
    }

    const verifyResult = verifyAgainstVerifiers(rawPayload, signature);
    if (!verifyResult) {
      console.error("qbo_webhook_signature_invalid");
      await auditEvent({ signature_valid: false, error_code: "signature_invalid" });
      return new Response("Unauthorized", { status: 401 });
    }
    const webhookMode = verifyResult.mode;

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      await auditEvent({
        signature_valid: true,
        oauth_app_env: webhookMode,
        error_code: "payload_parse_failed",
        error_message: e instanceof Error ? e.message : String(e),
      });
      return new Response("Bad payload", { status: 400 });
    }
    console.log("qbo_webhook_received", { webhook_mode: webhookMode, notifications: payload.eventNotifications?.length ?? 0 });

    for (const notification of payload.eventNotifications) {
      const realmId = notification.realmId;
      const entityCount = notification.dataChangeEvent?.entities?.length ?? 0;

      // Scope connection lookup by BOTH realm_id AND verified environment.
      // Never resolve by realm_id alone — sandbox and production realms can collide.
      const { data: connMatches, error: connErr } = await supabase
        .from("qbo_connections")
        .select("id, tenant_id, is_sandbox, oauth_app_env")
        .eq("realm_id", realmId)
        .eq("oauth_app_env", webhookMode)
        .eq("is_active", true);

      if (connErr) {
        console.error("qbo_webhook_connection_lookup_failed", connErr);
        await auditEvent({
          realm_id: realmId,
          oauth_app_env: webhookMode,
          signature_valid: true,
          event_count: entityCount,
          error_code: "connection_lookup_failed",
          error_message: connErr.message,
        });
        continue;
      }

      if (!connMatches || connMatches.length === 0) {
        console.warn("qbo_webhook_unmatched_realm_environment", {
          realm_id: realmId,
          webhook_mode: webhookMode,
        });
        await auditEvent({
          realm_id: realmId,
          oauth_app_env: webhookMode,
          signature_valid: true,
          event_count: entityCount,
          error_code: "unmatched_realm_environment",
        });
        // Quarantine: journal the whole notification without applying any tenant mutation.
        for (const entity of notification.dataChangeEvent?.entities ?? []) {
          await supabase.from("qbo_webhook_journal").insert({
            tenant_id: "00000000-0000-0000-0000-000000000000",
            realm_id: realmId,
            oauth_app_env: null,
            signature_environment: webhookMode,
            event_name: entity.name,
            event_time: entity.lastUpdated ? new Date(entity.lastUpdated).toISOString() : new Date().toISOString(),
            event_id: entity.id,
            entity_id: entity.id,
            operation: entity.operation,
            entities: [entity],
            payload: entity,
            processing_status: "quarantined_unmatched_realm_environment",
          });
        }
        continue;
      }

      if (connMatches.length > 1) {
        console.error("qbo_webhook_ambiguous_connection", {
          realm_id: realmId,
          webhook_mode: webhookMode,
          match_count: connMatches.length,
        });
        await auditEvent({
          realm_id: realmId,
          oauth_app_env: webhookMode,
          signature_valid: true,
          event_count: entityCount,
          error_code: "ambiguous_connection",
          error_message: `matched ${connMatches.length} active connections`,
        });
        for (const entity of notification.dataChangeEvent?.entities ?? []) {
          await supabase.from("qbo_webhook_journal").insert({
            tenant_id: "00000000-0000-0000-0000-000000000000",
            realm_id: realmId,
            oauth_app_env: null,
            signature_environment: webhookMode,
            event_name: entity.name,
            event_time: entity.lastUpdated ? new Date(entity.lastUpdated).toISOString() : new Date().toISOString(),
            event_id: entity.id,
            entity_id: entity.id,
            operation: entity.operation,
            entities: [entity],
            payload: entity,
            processing_status: "quarantined_ambiguous_connection",
          });
        }
        continue;
      }

      const connection = connMatches[0];
      const connMode: QboMode = (connection.oauth_app_env as QboMode);

      // Correlation id per notification for observability.
      const correlationId = crypto.randomUUID();

      let entityError: { code: string; message: string } | null = null;
      for (const entity of notification.dataChangeEvent.entities) {
        // Idempotency key from stable event fields.
        const idempotencyKey = [
          connection.id,
          entity.name,
          entity.id,
          entity.operation,
          entity.lastUpdated ?? "",
        ].join(":");

        const { error: logError } = await supabase
          .from("qbo_webhook_journal")
          .insert({
            tenant_id: connection.tenant_id,
            qbo_connection_id: connection.id,
            realm_id: realmId,
            oauth_app_env: connMode,
            signature_environment: webhookMode,
            event_name: entity.name,
            event_time: entity.lastUpdated ? new Date(entity.lastUpdated).toISOString() : new Date().toISOString(),
            event_id: entity.id,
            entity_id: entity.id,
            operation: entity.operation,
            entities: [entity],
            payload: entity,
            idempotency_key: idempotencyKey,
            request_correlation_id: correlationId,
            processing_status: "pending",
          });
        if (logError) {
          // Duplicate delivery (unique_violation on idempotency_key) is expected — skip mutation.
          const code = (logError as { code?: string }).code;
          if (code === "23505") {
            console.log("qbo_webhook_duplicate_skipped", { idempotency_key: idempotencyKey });
            continue;
          }
          console.error("qbo_webhook_journal_insert_failed", logError);
          entityError = { code: "journal_insert_failed", message: logError.message };
        }

        if (entity.name === "Payment" && (entity.operation === "Create" || entity.operation === "Update")) {
          try {
            await processPaymentEvent(supabase, connection.tenant_id, realmId, entity.id);
          } catch (e) {
            entityError = {
              code: "payment_processing_failed",
              message: e instanceof Error ? e.message : String(e),
            };
          }
        }
      }

      await auditEvent({
        tenant_id: connection.tenant_id,
        realm_id: realmId,
        oauth_app_env: connMode,
        signature_valid: true,
        event_count: entityCount,
        processed: !entityError,
        error_code: entityError?.code ?? null,
        error_message: entityError?.message ?? null,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in qbo-webhook-handler:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function processPaymentEvent(
  supabase: any,
  tenantId: string,
  realmId: string,
  paymentId: string,
) {
  try {
    const { data: connection } = await supabase
      .from("qbo_connections")
      .select("access_token, realm_id, is_sandbox, oauth_app_env")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .single();

    if (!connection) throw new Error("No active QBO connection");

    const paymentResponse = await fetch(
      `${qboHost(connection)}/v3/company/${realmId}/payment/${paymentId}?minorversion=75`,
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
          Accept: "application/json",
        },
      },
    );

    const paymentTid = getIntuitTid(paymentResponse);
    console.log("[qbo-webhook-handler] fetch payment", {
      status: paymentResponse.status,
      intuit_tid: paymentTid,
      realm_id: realmId,
      tenant_id: tenantId,
      qbo_payment_id: paymentId,
    });
    void writeQboApiLog(supabase, {
      action: "qbo_webhook_handler",
      tenant_id: tenantId,
      connection_id: (connection as { id?: string }).id ?? null,
      realm_id: realmId,
      oauth_app_env: connection.oauth_app_env,
      endpoint: `/v3/company/${realmId}/payment/${paymentId}`,
      method: "GET",
      http_status: paymentResponse.status,
      intuit_tid: paymentTid,
      success: paymentResponse.ok,
      request_metadata: { op: "fetch_payment", qbo_entity: "Payment", qbo_entity_id: paymentId },
    });

    if (!paymentResponse.ok) {
      const errBody = await paymentResponse.text();
      throw new Error(
        `qbo_webhook_handler:fetch_payment failed [status=${paymentResponse.status} intuit_tid=${paymentTid ?? "none"}]: ${errBody.slice(0, 300)}`,
      );
    }

    const paymentData = await paymentResponse.json();
    const payment = paymentData.Payment;

    if (payment.Line) {
      for (const line of payment.Line) {
        if (line.LinkedTxn && line.LinkedTxn.some((txn: any) => txn.TxnType === "Invoice")) {
          for (const linkedTxn of line.LinkedTxn) {
            if (linkedTxn.TxnType === "Invoice") {
              await updateInvoiceBalance(
                supabase,
                tenantId,
                realmId,
                linkedTxn.TxnId,
                connection.access_token,
                connection,
              );
            }
          }
        }
      }
    }

    await supabase
      .from("qbo_webhook_journal")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("entity_id", paymentId)
      .eq("event_type", "Payment");
  } catch (error) {
    console.error("Error processing payment event:", error);
    throw error;
  }
}

async function updateInvoiceBalance(
  supabase: any,
  tenantId: string,
  realmId: string,
  invoiceId: string,
  accessToken: string,
  connection: { is_sandbox?: boolean | null; oauth_app_env?: string | null },
) {
  try {
    const invoiceResponse = await fetch(
      `${qboHost(connection)}/v3/company/${realmId}/invoice/${invoiceId}?minorversion=75`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
    );
    const invoiceTid = getIntuitTid(invoiceResponse);
    console.log("[qbo-webhook-handler] fetch invoice", {
      status: invoiceResponse.status,
      intuit_tid: invoiceTid,
      realm_id: realmId,
      tenant_id: tenantId,
      qbo_invoice_id: invoiceId,
    });
    void writeQboApiLog(supabase, {
      action: "qbo_webhook_handler",
      tenant_id: tenantId,
      realm_id: realmId,
      oauth_app_env: connection.oauth_app_env,
      endpoint: `/v3/company/${realmId}/invoice/${invoiceId}`,
      method: "GET",
      http_status: invoiceResponse.status,
      intuit_tid: invoiceTid,
      success: invoiceResponse.ok,
      request_metadata: { op: "fetch_invoice", qbo_entity: "Invoice", qbo_entity_id: invoiceId },
    });
    if (!invoiceResponse.ok) {
      const errBody = await invoiceResponse.text();
      // Record the sync failure on the mirror row so operators can see it.
      await supabase
        .from("invoice_ar_mirror")
        .update({
          last_sync_error: `fetch_invoice status=${invoiceResponse.status}: ${errBody.slice(0, 240)}`,
          last_synced_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("qbo_invoice_id", invoiceId);
      throw new Error(
        `qbo_webhook_handler:fetch_invoice failed [status=${invoiceResponse.status} intuit_tid=${invoiceTid ?? "none"}]: ${errBody.slice(0, 300)}`,
      );
    }

    const invoiceData = await invoiceResponse.json();
    const invoice = invoiceData.Invoice;
    const balance = parseFloat(invoice.Balance);
    const total = parseFloat(invoice.TotalAmt);
    const nowIso = new Date().toISOString();
    const isPaid = balance === 0 && total > 0;

    // Preserve any existing paid_at — only stamp it on the first zero-balance event.
    const { data: existing } = await supabase
      .from("invoice_ar_mirror")
      .select("paid_at")
      .eq("tenant_id", tenantId)
      .eq("qbo_invoice_id", invoiceId)
      .maybeSingle();

    await supabase
      .from("invoice_ar_mirror")
      .update({
        balance,
        total_amount: total,
        qbo_status: invoice.EmailStatus || "Draft",
        sync_token: invoice.SyncToken ?? null,
        last_qbo_pull_at: nowIso,
        last_synced_at: nowIso,
        last_sync_error: null,
        paid_at: isPaid ? (existing?.paid_at ?? nowIso) : null,
      })
      .eq("tenant_id", tenantId)
      .eq("qbo_invoice_id", invoiceId);
  } catch (error) {
    console.error("Error updating invoice balance:", error);
    throw error;
  }
}
