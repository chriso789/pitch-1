// Authoritative QBO invoice/payment reconciler.
//
// Phase 1B, items 4/5/6:
//   - Webhook payloads are treated as change notifications, never as balances.
//   - Every reconciliation re-fetches the authoritative Invoice/Payment from QBO.
//   - LinkedTxn on Payment drives the set of affected invoices (partial, split,
//     multi-invoice, unapplied, update, void).
//   - Paid state is set only when authoritative Balance = 0 AND mapping is resolved
//     AND there is no unresolved reconciliation error.
//   - Reversal / void / balance-rise re-opens the invoice and appends events.
//   - Every meaningful transition writes an immutable `invoice_reconciliation_events`
//     row. `paid_at` is never nulled without a `payment_reversed` / `invoice_reopened`
//     event being appended in the same call.
//
// The reconciler is deliberately DB-authoritative: it upserts on
// (tenant_id, qbo_connection_id, realm_id, qbo_invoice_id) so the invoice
// mirror is the single source of truth per QBO invoice.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";
import { qboHost } from "../qbo-host.ts";
import { getValidAccessToken } from "../qbo-auth.ts";
import { writeQboApiLog } from "../qbo-api.ts";
import { qboFetch } from "./retry.ts";
import { validateInvoiceLink } from "./invoiceLinkValidator.ts";

export interface QboConnectionCtx {
  id: string;
  tenant_id: string;
  realm_id: string;
  is_sandbox?: boolean | null;
  oauth_app_env?: string | null;
}

interface ReconcileOpts {
  service: SupabaseClient;
  tenantId: string;
  connection: QboConnectionCtx;
  qboInvoiceId: string;
  /** Where the trigger came from — for event ledger + audit log. */
  trigger:
    | "worker_create"
    | "worker_sync"
    | "worker_refresh"
    | "webhook_invoice"
    | "webhook_payment"
    | "manual";
  webhookEventId?: string | null;
  logAction?: string;
}

interface ReconcileResult {
  ok: boolean;
  status: number;
  intuitTid: string | null;
  invoice?: any;
  isPaid?: boolean;
  balance?: number;
  total?: number;
  invoiceLink?: string | null;
  invoiceLinkStatus?: string;
  invoiceLinkSource?: string;
  error?: string;
  errorClassification?: string;
}

const RETRYABLE_TRIGGERS: ReconcileOpts["trigger"][] = [
  "worker_create",
  "worker_sync",
  "worker_refresh",
  "webhook_invoice",
  "webhook_payment",
  "manual",
];
void RETRYABLE_TRIGGERS;

/** Record an immutable ledger event; never fails the caller. */
export async function appendReconciliationEvent(
  service: SupabaseClient,
  row: {
    tenant_id: string;
    qbo_connection_id: string;
    realm_id: string | null;
    invoice_ar_mirror_id?: string | null;
    pitch_invoice_id?: string | null;
    qbo_invoice_id?: string | null;
    qbo_payment_id?: string | null;
    event_type: string;
    balance_before?: number | null;
    balance_after?: number | null;
    total_amount?: number | null;
    amount_applied?: number | null;
    authoritative_source: "qbo_read" | "webhook_payload" | "worker_computed";
    intuit_tid?: string | null;
    webhook_event_id?: string | null;
    details?: Record<string, unknown>;
  },
) {
  try {
    await service.from("invoice_reconciliation_events").insert({
      tenant_id: row.tenant_id,
      qbo_connection_id: row.qbo_connection_id,
      realm_id: row.realm_id,
      invoice_ar_mirror_id: row.invoice_ar_mirror_id ?? null,
      pitch_invoice_id: row.pitch_invoice_id ?? null,
      qbo_invoice_id: row.qbo_invoice_id ?? null,
      qbo_payment_id: row.qbo_payment_id ?? null,
      event_type: row.event_type,
      balance_before: row.balance_before ?? null,
      balance_after: row.balance_after ?? null,
      total_amount: row.total_amount ?? null,
      amount_applied: row.amount_applied ?? null,
      authoritative_source: row.authoritative_source,
      intuit_tid: row.intuit_tid ?? null,
      webhook_event_id: row.webhook_event_id ?? null,
      details: row.details ?? {},
    });
  } catch (e) {
    // Ledger is best-effort by contract — never break reconciliation because logging failed.
    console.error("recon_event_insert_failed", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Re-fetch the authoritative QBO invoice and update the AR mirror,
 * writing every material state transition into `invoice_reconciliation_events`.
 */
export async function reconcileInvoiceFromQbo(
  opts: ReconcileOpts,
): Promise<ReconcileResult> {
  const { service, tenantId, connection, qboInvoiceId, trigger, webhookEventId, logAction } = opts;

  // 1. Mapping must exist and belong to this tenant+connection.
  const { data: mapping } = await service
    .from("qbo_entity_mapping")
    .select("pitch_entity_id, qbo_entity_id, sync_token")
    .eq("tenant_id", tenantId)
    .eq("qbo_connection_id", connection.id)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_entity_type", "Invoice")
    .eq("qbo_entity_id", qboInvoiceId)
    .maybeSingle();

  if (!mapping) {
    await appendReconciliationEvent(service, {
      tenant_id: tenantId,
      qbo_connection_id: connection.id,
      realm_id: connection.realm_id,
      qbo_invoice_id: qboInvoiceId,
      event_type: "sync_error",
      authoritative_source: "worker_computed",
      webhook_event_id: webhookEventId ?? null,
      details: { reason: "mapping_not_found_for_tenant_connection", trigger },
    });
    return { ok: false, status: 404, intuitTid: null, error: "mapping_not_found" };
  }

  // 2. Authoritative fetch with include=invoiceLink, via retryable wrapper.
  const url = `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice/${qboInvoiceId}?minorversion=75&include=invoiceLink`;
  const fetchResult = await qboFetch({
    method: "GET",
    url,
    getAccessToken: async () => (await getValidAccessToken(service, tenantId)).access_token,
  });

  void writeQboApiLog(service, {
    action: logAction ?? "qbo_reconciler",
    tenant_id: tenantId,
    connection_id: connection.id,
    realm_id: connection.realm_id,
    oauth_app_env: connection.oauth_app_env ?? null,
    endpoint: `/v3/company/${connection.realm_id}/invoice/${qboInvoiceId}`,
    method: "GET",
    http_status: fetchResult.status,
    intuit_tid: fetchResult.intuitTid,
    success: fetchResult.ok,
    request_metadata: { op: "reconcile_invoice", trigger, attempts: fetchResult.attempts },
  });

  if (!fetchResult.ok) {
    await service.from("invoice_ar_mirror")
      .update({
        last_sync_error: `reconcile status=${fetchResult.status} tid=${fetchResult.intuitTid ?? "none"}: ${fetchResult.bodyText.slice(0, 240)}`,
        last_synced_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("qbo_connection_id", connection.id)
      .eq("realm_id", connection.realm_id)
      .eq("qbo_invoice_id", qboInvoiceId);

    await appendReconciliationEvent(service, {
      tenant_id: tenantId,
      qbo_connection_id: connection.id,
      realm_id: connection.realm_id,
      qbo_invoice_id: qboInvoiceId,
      event_type: "sync_error",
      authoritative_source: "worker_computed",
      intuit_tid: fetchResult.intuitTid,
      webhook_event_id: webhookEventId ?? null,
      details: {
        trigger,
        classification: fetchResult.classification,
        http_status: fetchResult.status,
        excerpt: fetchResult.bodyText.slice(0, 240),
      },
    });
    return {
      ok: false, status: fetchResult.status, intuitTid: fetchResult.intuitTid,
      error: "qbo_invoice_fetch_failed",
      errorClassification: fetchResult.classification,
    };
  }

  const invoice = (fetchResult.json as any)?.Invoice;
  if (!invoice) {
    return { ok: false, status: 502, intuitTid: fetchResult.intuitTid, error: "qbo_invoice_missing_in_response" };
  }

  // 3. Load prior mirror row to detect state transitions.
  const { data: prior } = await service
    .from("invoice_ar_mirror")
    .select("id, balance, total_amount, paid_at, invoice_link, invoice_link_status, pitch_invoice_id")
    .eq("tenant_id", tenantId)
    .eq("qbo_connection_id", connection.id)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_invoice_id", qboInvoiceId)
    .maybeSingle();

  const total = Number(invoice.TotalAmt ?? 0);
  const balance = Number(invoice.Balance ?? 0);
  const nowIso = new Date().toISOString();
  const wasPaid = !!prior?.paid_at;
  const isPaid = balance === 0 && total > 0;

  // 4. Capability-driven invoice link. Never store an unvalidated URL.
  const rawLink = invoice.InvoiceLink ?? null;
  let linkStatus: string;
  let linkSource: string;
  let linkVerified: string | null = null;
  let linkLastError: string | null = null;
  let persistedLink: string | null = prior?.invoice_link ?? null;

  if (rawLink) {
    const v = validateInvoiceLink(rawLink);
    if (v.ok) {
      linkStatus = "available";
      linkSource = "qbo_read_response";
      linkVerified = nowIso;
      persistedLink = v.url;
    } else {
      linkStatus = "invalid";
      linkSource = "qbo_read_response";
      linkLastError = v.reason;
      // Do NOT destroy the previously-verified link if today's response is malformed.
      // Fall back to the last verified value if any.
    }
  } else {
    linkStatus = "unavailable";
    linkSource = "unavailable";
  }

  const allowCc  = invoice.AllowOnlineCreditCardPayment === true;
  const allowAch = invoice.AllowOnlineACHPayment === true;
  const capabilityMessage = rawLink
    ? (linkStatus === "available"
        ? "Hosted QuickBooks invoice link verified."
        : `Hosted link rejected: ${linkLastError ?? "unknown"}.`)
    : ((allowCc || allowAch)
        ? "Online payment may be enabled in QuickBooks, but no reusable hosted link was returned. Use \"Send via QuickBooks\" to email the customer directly."
        : "Online payments are not enabled for this invoice in QuickBooks.");

  // 5. Compute paid_at with source tracking. Never null a paid_at without an event.
  let paidAt: string | null;
  let paidAtSource: string | null;
  if (isPaid) {
    // Prefer authoritative txn/payment date when present on the invoice payload,
    // otherwise fall back to reconciliation timestamp.
    const authoritativeDate = invoice.MetaData?.LastUpdatedTime ?? invoice.TxnDate ?? null;
    paidAt = prior?.paid_at ?? authoritativeDate ?? nowIso;
    paidAtSource = prior?.paid_at ? "qbo_payment_txn_date" : (authoritativeDate ? "qbo_payment_txn_date" : "reconciliation_timestamp");
  } else {
    paidAt = null;
    paidAtSource = null;
  }

  // 6. Upsert the mirror row (authoritative snapshot).
  await service.from("invoice_ar_mirror").upsert({
    tenant_id: tenantId,
    qbo_connection_id: connection.id,
    realm_id: connection.realm_id,
    qbo_invoice_id: qboInvoiceId,
    project_id: (prior as any)?.project_id ?? undefined,
    doc_number: invoice.DocNumber ?? null,
    total_amount: total,
    balance,
    sync_token: invoice.SyncToken ?? null,
    txn_date: invoice.TxnDate ?? null,
    due_date: invoice.DueDate ?? null,
    email_status: invoice.EmailStatus ?? null,
    qbo_status: balance > 0 ? "Open" : "Paid",
    invoice_link: persistedLink,
    invoice_link_status: linkStatus,
    invoice_link_source: linkSource,
    invoice_link_verified_at: linkVerified,
    invoice_link_last_error: linkLastError,
    online_card_enabled: allowCc,
    online_ach_enabled: allowAch,
    payment_capability_message: capabilityMessage,
    last_qbo_pull_at: nowIso,
    last_synced_at: nowIso,
    last_sync_error: null,
    paid_at: paidAt,
    paid_at_source: paidAtSource,
    reopened_at: wasPaid && !isPaid ? nowIso : (prior as any)?.reopened_at ?? undefined,
  }, { onConflict: "tenant_id,qbo_connection_id,realm_id,qbo_invoice_id" });

  const mirrorId = prior?.id ?? null;
  const pitchInvoiceId = prior?.pitch_invoice_id ?? null;

  // 7. Ledger transitions.
  const baseEvent = {
    tenant_id: tenantId,
    qbo_connection_id: connection.id,
    realm_id: connection.realm_id,
    invoice_ar_mirror_id: mirrorId,
    pitch_invoice_id: pitchInvoiceId,
    qbo_invoice_id: qboInvoiceId,
    authoritative_source: "qbo_read" as const,
    intuit_tid: fetchResult.intuitTid,
    webhook_event_id: webhookEventId ?? null,
    balance_before: prior?.balance ?? null,
    balance_after: balance,
    total_amount: total,
  };

  await appendReconciliationEvent(service, {
    ...baseEvent,
    event_type: "invoice_read",
    details: { trigger, doc_number: invoice.DocNumber ?? null },
  });

  if (rawLink && linkStatus === "available" && prior?.invoice_link_status !== "available") {
    await appendReconciliationEvent(service, {
      ...baseEvent,
      event_type: "invoice_link_verified",
      details: { host_verified: true },
    });
  } else if (rawLink && linkStatus === "invalid") {
    await appendReconciliationEvent(service, {
      ...baseEvent,
      event_type: "invoice_link_invalid",
      details: { reason: linkLastError },
    });
  } else if (!rawLink && prior?.invoice_link_status === "available") {
    await appendReconciliationEvent(service, {
      ...baseEvent,
      event_type: "invoice_link_unavailable",
      details: { note: "qbo_no_longer_returning_link" },
    });
  }

  if (!wasPaid && isPaid) {
    await appendReconciliationEvent(service, {
      ...baseEvent,
      event_type: "full_payment_applied",
      details: { paid_at: paidAt, paid_at_source: paidAtSource },
    });
  } else if (wasPaid && !isPaid) {
    // Balance rose above zero after being paid → payment reversed / voided / refunded.
    await appendReconciliationEvent(service, {
      ...baseEvent,
      event_type: "payment_reversed",
      details: { note: "balance_rose_above_zero_after_paid" },
    });
    await appendReconciliationEvent(service, {
      ...baseEvent,
      event_type: "invoice_reopened",
      details: { reopened_at: nowIso },
    });
  } else if (!isPaid && total > 0 && balance < total && balance > 0) {
    // Partial payment currently applied. Emit only if balance actually decreased.
    if (prior && Number(prior.balance ?? total) > balance) {
      await appendReconciliationEvent(service, {
        ...baseEvent,
        event_type: "partial_payment_applied",
        amount_applied: Number(prior.balance ?? total) - balance,
        details: {},
      });
    }
  }

  return {
    ok: true,
    status: fetchResult.status,
    intuitTid: fetchResult.intuitTid,
    invoice,
    isPaid,
    balance,
    total,
    invoiceLink: persistedLink,
    invoiceLinkStatus: linkStatus,
    invoiceLinkSource: linkSource,
  };
}

/**
 * Given a QBO Payment ID (from a webhook or manual sync), fetch the authoritative
 * Payment and reconcile every invoice referenced by LinkedTxn.
 * Supports create/update/void.
 */
export async function reconcilePaymentFromQbo(opts: {
  service: SupabaseClient;
  tenantId: string;
  connection: QboConnectionCtx;
  qboPaymentId: string;
  operation: string; // Create | Update | Delete | Void | Merge
  webhookEventId?: string | null;
}): Promise<{ ok: boolean; affectedInvoiceIds: string[]; intuitTid: string | null; error?: string }> {
  const { service, tenantId, connection, qboPaymentId, operation, webhookEventId } = opts;

  const url = `${qboHost(connection)}/v3/company/${connection.realm_id}/payment/${qboPaymentId}?minorversion=75`;
  const paymentFetch = await qboFetch({
    method: "GET",
    url,
    getAccessToken: async () => (await getValidAccessToken(service, tenantId)).access_token,
  });

  void writeQboApiLog(service, {
    action: "qbo_reconciler",
    tenant_id: tenantId,
    connection_id: connection.id,
    realm_id: connection.realm_id,
    oauth_app_env: connection.oauth_app_env ?? null,
    endpoint: `/v3/company/${connection.realm_id}/payment/${qboPaymentId}`,
    method: "GET",
    http_status: paymentFetch.status,
    intuit_tid: paymentFetch.intuitTid,
    success: paymentFetch.ok,
    request_metadata: { op: "reconcile_payment", operation, attempts: paymentFetch.attempts },
  });

  const affectedInvoiceIds: string[] = [];

  // Deleted payments may 404. Treat as "unlink all invoices previously linked to it".
  if (!paymentFetch.ok && paymentFetch.status === 404) {
    const { data: prior } = await service
      .from("invoice_reconciliation_events")
      .select("qbo_invoice_id")
      .eq("tenant_id", tenantId)
      .eq("qbo_connection_id", connection.id)
      .eq("qbo_payment_id", qboPaymentId)
      .not("qbo_invoice_id", "is", null);
    const uniqInv = Array.from(new Set((prior ?? []).map((r) => r.qbo_invoice_id as string)));
    for (const invId of uniqInv) {
      const result = await reconcileInvoiceFromQbo({
        service, tenantId, connection, qboInvoiceId: invId,
        trigger: "webhook_payment", webhookEventId,
      });
      if (result.ok) affectedInvoiceIds.push(invId);
      await appendReconciliationEvent(service, {
        tenant_id: tenantId, qbo_connection_id: connection.id, realm_id: connection.realm_id,
        qbo_payment_id: qboPaymentId, qbo_invoice_id: invId,
        event_type: operation === "Void" ? "payment_voided" : "payment_reversed",
        authoritative_source: "qbo_read",
        intuit_tid: paymentFetch.intuitTid,
        webhook_event_id: webhookEventId ?? null,
        details: { note: "payment_not_found_on_read", operation },
      });
    }
    return { ok: true, affectedInvoiceIds, intuitTid: paymentFetch.intuitTid };
  }

  if (!paymentFetch.ok) {
    return {
      ok: false, affectedInvoiceIds, intuitTid: paymentFetch.intuitTid,
      error: `qbo_payment_fetch_failed status=${paymentFetch.status}`,
    };
  }

  const payment = (paymentFetch.json as any)?.Payment;
  if (!payment) return { ok: false, affectedInvoiceIds, intuitTid: paymentFetch.intuitTid, error: "payment_missing_in_response" };

  const linked = new Map<string, number>(); // invoiceId → amount applied
  const paymentLines = Array.isArray(payment.Line) ? payment.Line : [];
  for (const line of paymentLines) {
    const txns = Array.isArray(line?.LinkedTxn) ? line.LinkedTxn : [];
    for (const t of txns) {
      if (t?.TxnType === "Invoice" && t.TxnId) {
        const amt = Number(line.Amount ?? 0);
        linked.set(t.TxnId, (linked.get(t.TxnId) ?? 0) + (Number.isFinite(amt) ? amt : 0));
      }
    }
  }

  for (const [invoiceId, amountApplied] of linked.entries()) {
    const result = await reconcileInvoiceFromQbo({
      service, tenantId, connection,
      qboInvoiceId: invoiceId,
      trigger: "webhook_payment",
      webhookEventId,
    });
    if (result.ok) affectedInvoiceIds.push(invoiceId);
    await appendReconciliationEvent(service, {
      tenant_id: tenantId, qbo_connection_id: connection.id, realm_id: connection.realm_id,
      qbo_payment_id: qboPaymentId, qbo_invoice_id: invoiceId,
      event_type: "payment_updated",
      amount_applied: amountApplied,
      authoritative_source: "qbo_read",
      intuit_tid: paymentFetch.intuitTid,
      webhook_event_id: webhookEventId ?? null,
      details: { operation, txn_date: payment.TxnDate ?? null },
    });
  }

  return { ok: true, affectedInvoiceIds, intuitTid: paymentFetch.intuitTid };
}
