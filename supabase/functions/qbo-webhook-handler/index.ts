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
import { reconcileInvoiceFromQbo, reconcilePaymentFromQbo, appendReconciliationEvent } from "../_shared/qbo/reconciler.ts";

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
        // Dedup key: same realm + entity + operation + lastUpdated always maps to the
        // same row. The unique index on qbo_webhook_events.dedup_key rejects retries.
        const dedupKey = [
          connection.id,
          entity.name,
          entity.id,
          entity.operation,
          entity.lastUpdated ?? "",
        ].join(":");

        const { data: dedupInsert, error: dedupErr } = await supabase
          .from("qbo_webhook_events")
          .insert({
            tenant_id: connection.tenant_id,
            realm_id: realmId,
            oauth_app_env: connMode,
            signature_valid: true,
            event_count: 1,
            dedup_key: dedupKey,
          })
          .select("id")
          .maybeSingle();

        if (dedupErr) {
          const code = (dedupErr as { code?: string }).code;
          if (code === "23505") {
            // Duplicate delivery — never re-run reconciliation.
            console.log("qbo_webhook_dedup_skipped", { dedup_key: dedupKey });
            await appendReconciliationEvent(supabase, {
              tenant_id: connection.tenant_id,
              qbo_connection_id: connection.id,
              realm_id: realmId,
              qbo_invoice_id: entity.name === "Invoice" ? entity.id : null,
              qbo_payment_id: entity.name === "Payment" ? entity.id : null,
              event_type: "webhook_dedup_skipped",
              authoritative_source: "webhook_payload",
              details: { entity: entity.name, operation: entity.operation, dedup_key: dedupKey },
            });
            continue;
          }
          console.error("qbo_webhook_dedup_insert_failed", dedupErr);
          entityError = { code: "dedup_insert_failed", message: dedupErr.message };
        }

        // Best-effort journal row for backward compatibility with existing dashboards.
        await supabase.from("qbo_webhook_journal").insert({
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
          idempotency_key: dedupKey,
          request_correlation_id: correlationId,
          processing_status: "pending",
        }).then(() => {}, () => {});

        const webhookEventId = dedupInsert?.id ?? null;

        try {
          if (entity.name === "Invoice") {
            // Never trust the webhook payload's balance — re-read the authoritative invoice.
            await reconcileInvoiceFromQbo({
              service: supabase,
              tenantId: connection.tenant_id,
              connection: {
                id: connection.id,
                tenant_id: connection.tenant_id,
                realm_id: realmId,
                is_sandbox: connection.is_sandbox ?? null,
                oauth_app_env: connMode,
              },
              qboInvoiceId: entity.id,
              trigger: "webhook_invoice",
              webhookEventId,
              logAction: "qbo_webhook_handler",
            });
          } else if (entity.name === "Payment") {
            // LinkedTxn drives which invoices to re-reconcile.
            await reconcilePaymentFromQbo({
              service: supabase,
              tenantId: connection.tenant_id,
              connection: {
                id: connection.id,
                tenant_id: connection.tenant_id,
                realm_id: realmId,
                is_sandbox: connection.is_sandbox ?? null,
                oauth_app_env: connMode,
              },
              qboPaymentId: entity.id,
              operation: entity.operation,
              webhookEventId,
            });
          }
        } catch (e) {
          entityError = {
            code: `${entity.name.toLowerCase()}_reconcile_failed`,
            message: e instanceof Error ? e.message : String(e),
          };
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

// NOTE: Legacy processPaymentEvent/updateInvoiceBalance helpers were removed
// in Phase 1B. Payment and Invoice notifications now flow exclusively through
// reconcileInvoiceFromQbo / reconcilePaymentFromQbo in _shared/qbo/reconciler.ts,
// which:
//   - Re-fetches the authoritative QBO record (never trusts webhook balances).
//   - Traverses Payment.Line[].LinkedTxn to identify every affected invoice.
//   - Validates hosted InvoiceLink via _shared/qbo/invoiceLinkValidator.ts.
//   - Emits invoice_reconciliation_events rows for every material transition.
//   - Preserves paid_at across reversal, appending payment_reversed/invoice_reopened.
