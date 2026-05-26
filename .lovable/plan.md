## Goal

Bring the existing QBO integration (already partly built: `qbo-oauth-connect`, `qbo-customer-sync`, `qbo-fetch-items`, `qbo-invoice-create`, `qbo-invoice-send`, `qbo-sync-payment`, `qbo-webhook(-handler)`, `qbo-worker`, plus `qbo_connections`, `qbo_entity_mapping`, `qbo_webhook_journal`, `qbo_sync_errors`, `qbo_payment_history`, `qbo_location_map`, `qbo_expenses`) up to the architecture described in the uploaded blueprint.

Pitch‑1 stays the source of truth for projects / crews / workflow; QBO is the source of truth for posted invoices, payments and A/R.

## Scope (phased)

### Phase 1 — Auth + token hygiene (foundation)
- Add `_shared/qbo-auth.ts` with: encrypted token read/write, automatic refresh ≥5 min before expiry, refresh‑token rollover (always persist latest), 100‑day reauth tracking, OAuth `state` + PKCE, and `realmId` capture on callback.
- Migrate `qbo_connections` to ensure columns: `tenant_id`, `realm_id`, `access_token_encrypted`, `refresh_token_encrypted`, `access_token_expires_at`, `refresh_token_expires_at`, `scopes`, `last_refreshed_at`, `disconnected_at`. Encrypt at rest via pgsodium/Vault.
- Rework `qbo-oauth-connect` to use the new shared module.

### Phase 2 — Shared client + shadow tables
- Add `_shared/qbo-client.ts`: per‑realm rate‑limited fetch wrapper, 429/5xx retry with exponential backoff, `SyncToken` handling, structured error → `qbo_sync_errors`.
- New migrations for shadow + ledger tables:
  - `qbo_invoices_shadow`, `qbo_payments_shadow`, `qbo_customers_shadow`, `qbo_items_shadow` (mirror of QBO objects + `last_pulled_at`).
  - `qbo_payment_allocations` (LinkedTxn breakdown).
  - `ar_ledger_entries` (append‑only AR events: invoice_posted / payment_applied / credit_applied / void).
  - `qbo_idempotency` (fingerprint = `realmId|entity|id|LastUpdatedTime`).
- GRANT + RLS for `authenticated` (tenant‑scoped via `tenant_id`) and full access for `service_role`.

### Phase 3 — Webhooks (durable + idempotent)
- `qbo-webhook-handler` (public, no JWT): verify HMAC‑SHA256 with `INTUIT_WEBHOOK_VERIFIER_TOKEN`, write raw payload + fingerprint into `qbo_webhook_journal` (status=`queued`), return 200 fast.
- `qbo-worker` becomes the per‑realm serial processor: pulls queued journal rows, dedups via `qbo_idempotency`, fetches the entity by id, upserts the shadow row, then runs reconciler.
- Collapse `qbo-webhook` and `qbo-webhook-handler` into one canonical handler (delete the duplicate).

### Phase 4 — Outbound invoice sync
- Refactor `qbo-invoice-create` / `qbo-invoice-send` through `qbo-client`.
- On Pitch project invoice submission: create QBO `Invoice` with `CustomerRef`, line items from controlled `Item` catalog, custom field **`Project Number`** = Pitch `project_id` (custom-field-first design, as recommended over native Projects API for v1).
- Persist mapping in `qbo_entity_mapping` (`entity_type=invoice`) and shadow row.

### Phase 5 — Inbound payment + AR reconciliation
- On QBO `Payment` webhook: upsert shadow, parse `LinkedTxn` into `qbo_payment_allocations`, resolve each linked invoice → internal project via `qbo_entity_mapping` → `project_id` custom field fallback, append to `ar_ledger_entries`.
- Update existing `invoice_ar_mirror` flow used by `QuickBooksInvoiceCard` to read from the new shadow/ledger.

### Phase 6 — CDC backfill (drift correction)
- New scheduled function `qbo-cdc-poll` (every 15 min per connected realm): `GET /cdc?entities=invoice,payment,customer,item&changedSince=…`, feed results through the same shadow upsert + reconciler path. Track `last_cdc_cursor` on `qbo_connections`.

### Phase 7 — Observability + tests
- Structured logs (realm_id, entity, id, fingerprint).
- Vitest/Deno tests for: token refresh + rollover, webhook HMAC verify, idempotency dedup, invoice create round‑trip, payment allocation against multi‑invoice payment, CDC replay.

## Out of scope (this plan)
- Native QBO Projects API integration (custom field is enough for v1; deferred to a follow‑up).
- QuickBooks Payments API (`com.intuit.quickbooks.payment` scope) — only accounting `Payment` entities are synced.
- JournalEntry postings for crew payouts — design only, no implementation yet.
- Any UI changes beyond the existing `QuickBooksInvoiceCard` reading from new tables.

## Secrets required
- `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, `INTUIT_REDIRECT_URI`, `INTUIT_WEBHOOK_VERIFIER_TOKEN`, `INTUIT_ENVIRONMENT` (`sandbox`|`production`). I'll prompt to add any missing ones before Phase 1 ships.

## Suggested order to ship
Phase 1 → 2 → 3 (these unlock everything) → 4 → 5 → 6 → 7. Each phase is independently deployable behind a feature flag on `qbo_connections.is_active`.

Want me to start with Phase 1 (auth + token hygiene + shared module), or a different slice?
