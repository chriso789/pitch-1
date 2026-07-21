# QBO Phase 1B — Sandbox Acceptance Runbook

This is the exact flow that must pass end-to-end against a live QuickBooks Online
sandbox company before Phase 1B is called release-complete. Run it with the
Intuit developer on the call. Every step captures the evidence they will need.

**Do NOT proceed to the customer portal / branded invoice page / email / SMS
slice until every checkbox in Section 4 is green.**

---

## 0. Preconditions

- [ ] Tenant is connected to a **sandbox** QBO company (`qbo_connections.is_sandbox = true`, `oauth_app_env = 'sandbox'`).
- [ ] `QBO_INVOICE_LINK_ALLOWED_HOSTS` env var is either unset (defaults are correct) or explicitly set to include the sandbox hosted domain the company returns.
- [ ] `qbo-webhook-handler` public URL is registered in the Intuit developer dashboard for this app's sandbox webhooks.
- [ ] Deno tests pass:
  ```
  bunx deno test supabase/functions/_shared/qbo/invoiceLinkValidator_test.ts
  ```

---

## 1. Create the acceptance invoice

1. In Pitch, create a project with a single-line estimate totalling **$1.00**.
2. In the project's **Invoices** tab, click **Create Invoice** (type: `progress`).
3. On success the toast reads *"Invoice created in QuickBooks — Invoice #<DocNumber>"*.

Verify in `invoice_ar_mirror`:

```sql
select qbo_invoice_id, doc_number, sync_token, total_amount, balance,
       invoice_link, invoice_link_status, invoice_link_source,
       invoice_link_verified_at, online_card_enabled, online_ach_enabled,
       last_qbo_pull_at, last_sync_error
from invoice_ar_mirror
where project_id = '<PROJECT_UUID>'
order by created_at desc
limit 1;
```

- [ ] `qbo_invoice_id` is set.
- [ ] `doc_number` is the human-facing QBO invoice number (NOT the UUID).
- [ ] `sync_token` is set.
- [ ] `total_amount = 1.00`, `balance = 1.00`.
- [ ] `last_sync_error` is `NULL`.
- [ ] `invoice_link_status` is one of `available` / `unavailable` / `pending`.

## 2. Prove the hosted link

1. Confirm `invoice_link_status = 'available'` for this row.
   - If it is `unavailable`, enable QuickBooks Payments on this sandbox invoice, then click **Sync** in the UI.
   - If it is `pending`, click **Sync** — the reconciler re-fetches with `?include=invoiceLink&minorversion=75`.
2. Copy the persisted `invoice_link` value out of the DB (not the UI).
3. Open that URL in a **private / incognito** browser window that is NOT logged into QuickBooks.

- [ ] The hosted Intuit payment page loads without requiring a QBO login.
- [ ] The Pay Invoice button appears in the Pitch UI (only when `invoice_link_status = 'available'`).

Confirm the immutable ledger recorded the verification:

```sql
select event_type, authoritative_source, occurred_at
from invoice_reconciliation_events
where qbo_invoice_id = '<QBO_INVOICE_ID>'
order by occurred_at;
```

- [ ] `invoice_pushed` present.
- [ ] `invoice_read` present.
- [ ] `invoice_link_verified` present with `authoritative_source = 'qbo_invoice_read'`.

## 3. Payment lifecycle

### 3a. Partial payment ($0.40)

1. In QBO sandbox, receive a $0.40 payment against the invoice.
2. Wait for the webhook OR click **Sync** in Pitch.

- [ ] Mirror: `balance = 0.60`, `paid_at IS NULL`.
- [ ] Ledger contains a `partial_payment_applied` row.
- [ ] Pitch UI header still shows the invoice as **Open** with balance **$0.60**.
- [ ] "Ready for Accounting Review" banner is **NOT** green.

### 3b. Final payment ($0.60)

1. In QBO sandbox, receive a $0.60 payment against the invoice.

- [ ] Mirror: `balance = 0.00`, `paid_at` is set to the QBO payment timestamp.
- [ ] Ledger contains a `full_payment_applied` row.
- [ ] Pitch UI shows the invoice as **Paid**.
- [ ] "Ready for Accounting Review" banner turns green **only if** the checklist (invoice exists, balance zero, paid-on date, no sync errors, freshly re-read) all pass.

### 3c. Duplicate webhook delivery

In the Intuit developer dashboard, resend the same Payment notification.

- [ ] `qbo_webhook_events` inserts silently rejected on `dedup_key` conflict.
- [ ] Ledger contains **exactly one** `full_payment_applied`; a new `webhook_dedup_skipped` row appears.
- [ ] Mirror row is unchanged (same `sync_token`, same `paid_at`).

### 3d. Reversal

Void or delete the second QBO payment.

- [ ] Mirror: `balance > 0`, `paid_at IS NULL`.
- [ ] Ledger contains `payment_reversed` **AND** `invoice_reopened` rows.
- [ ] Pitch UI drops back to Open with the correct balance.
- [ ] The Pay Invoice button reappears when `invoice_link_status = 'available'`.

### 3e. Idempotency on retries

Manually trigger `qbo-worker` op `createInvoiceFromEstimates` for the SAME project a second time (simulate a lost response).

- [ ] Only ONE invoice row exists in `qbo_entity_mapping` for this project.
- [ ] Only ONE row exists in `invoice_ar_mirror` for this project+realm.
- [ ] QBO shows only one invoice with matching `DocNumber` (the `?requestid=` stable key held).

---

## 4. Release gate

Phase 1B is release-complete only when all of these are checked:

- [ ] Section 1 — invoice created, mapping persisted with `qbo_invoice_id`, `doc_number`, `sync_token`.
- [ ] Section 2 — hosted link opens without QBO login; ledger shows `invoice_link_verified`.
- [ ] Section 3a — partial payment applied, balance and event correct.
- [ ] Section 3b — final payment marks paid, banner gate respected.
- [ ] Section 3c — duplicate webhook produces zero side effects.
- [ ] Section 3d — reversal reopens the invoice; project stays in pending review.
- [ ] Section 3e — retried create does NOT create a duplicate QBO invoice.
- [ ] Closeout, warranty generation, and Accounting Complete remain manual actions (verified by inspecting the project header — no automation triggered by paid status alone).

Only after every box above is checked, begin the next slice:

1. Customer portal Invoices / Payments (reuses the same verified link).
2. Branded invoice page.
3. Email delivery.
4. SMS delivery (adds consent, STOP/HELP, sender registration — separate PR).
