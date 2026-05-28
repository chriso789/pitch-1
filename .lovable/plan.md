# ABC Webhook — Deploy, Wire UI, Validate

End-to-end deploy + validation of the receiver/registration system already built. Sandbox-first, O'Brien-enabled, tenant-ready. No HMAC. Duplicates return 200.

## Priority 1 — Deploy

1. Apply pending migration `20260528232317_63424b94-e5cd-4e35-94f3-70cd3f6deb94.sql` (adds `abc_webhooks.environment` + `last_event_received_at`, `abc_webhook_events.provider/provider_event_id/payload_hash/signature_valid/abc_order_id/quarantine_reason`, unique indexes for idempotency, FK on `abc_order_id`).
2. Deploy edge functions: `supplier-webhook`, `supplier-api`. Skip `abc-api-proxy` (unchanged).
3. Pull recent edge function logs for both and confirm clean cold start (no import errors, no `Deno.serve` issues, npm: specifiers resolve).

## Priority 2 — Wire Developer UI

In `src/components/settings/ABCConnectionSettings.tsx`, **inside the existing Developer / Advanced section only**, gated by `useSupplierDeveloperMode().allowSandboxDefaults`:

- New `<AbcWebhookPanel />` component (new file `src/components/settings/abc/AbcWebhookPanel.tsx`).
- Buttons:
  - **Register ABC Webhook** → calls `supplier-api` action `register_webhook` (env = sandbox).
  - **List ABC Webhooks** → calls `list_webhooks`, refreshes panel.
- Webhook status card per row:
  - environment (sandbox/prod), callback URL, subscribed events (`ORDER_UPDATE`, `ORDER_INVOICED`), status (active/inactive/error), `secret_stored: yes/no`, `last_event_received_at`, last event type, last `quarantine_reason`.
- Redacted fields: never render `secret`, raw registration response secret, or Authorization values. Show `secret_stored` boolean only.

## Priority 3 — Synthetic Receiver Tests

Run via `supabase--curl_edge_functions` against deployed `supplier-webhook`. Use a sandbox `abc_webhooks` row created in test 1; use its `id` and stored `secret` for tests 2–6.

| # | Test | POST shape | Expected |
|---|------|-----------|----------|
| 1 | `register_webhook` | `supplier-api` action | local row created, secret stored, callback `…/supplier-webhook/abc/events/{webhook_id}` |
| 2 | Valid `ORDER_UPDATE` | Authorization: stored secret | event row, `signature_valid=true`, `abc_order_id` resolved, `abc_orders.raw_payload.webhook_latest` updated, 200 |
| 3 | Invalid `ORDER_UPDATE` | Authorization: bogus | event row `signature_valid=false`, orders untouched, **401** |
| 4 | Duplicate `ORDER_UPDATE` | replay #2 verbatim | **200 `{duplicate:true}`**, no second row, no double-mutation |
| 5 | Unresolved order | unknown order/PO id | event row, `quarantine_reason='unresolved_order'`, **202 `{quarantined:true}`**, orders untouched |
| 6 | `ORDER_INVOICED` | `webhookDetails[].apiKey` = stored secret | event row, `abc_orders.order_status='invoiced'`, `abc_invoices` upserted |

Verify via `supabase--read_query` against `abc_webhooks`, `abc_webhook_events`, `abc_orders`, `abc_invoices`.

## Priority 4 — Project Diagnostics Proof

Open a project Materials tab in preview and confirm:
- SRS diagnostics still renders
- ABC Submit Diagnostics renders
- Webhook event timeline appears in Inspect (driven by `abc_webhook_events`)
- Refresh Status still works

If a webhook timeline component does not yet exist in `AbcDiagnosticsPanel`, add a small read-only "Webhook Events" sub-list (latest 10 events for the order: timestamp, event type, signature_valid, quarantine_reason). No new tables.

## Priority 5 — Report

Single report containing:
- Migration name applied
- Deploy status per function + log tail summary
- UI files changed
- `register_webhook` response summary (secret masked as `********`)
- Callback URL
- Tests 1–6 pass/fail with row counts and HTTP codes
- Diagnostics panel proof (text or screenshot)
- Any failure with exact error

Secrets never printed — always `********`.

## Files (expected)

- New: `src/components/settings/abc/AbcWebhookPanel.tsx`
- Edit: `src/components/settings/ABCConnectionSettings.tsx` (mount panel inside dev section)
- Edit (only if missing): `src/components/projects/AbcDiagnosticsPanel.tsx` — add Webhook Events sub-list
- No new migrations
- No edge function code changes (deploy as-is)

## Out of scope

- HMAC, timestamp verification, IP allowlist — pending ABC confirmation
- Production env registration — sandbox only
- Tenant-wide rollout — remains O'Brien + developers via existing gate
