# ABC Webhooks

Sandbox-first, O'Brien-enabled, tenant-ready.

## Registration flow

1. Frontend (Advanced/Developer panel) calls `abc-api-proxy` with `action: "register_webhook"`.
2. Proxy resolves tenant from JWT (NOT body), inserts a pending row in `abc_webhooks`, then calls:
   `POST {apiBase}/notification/v2/webhooks` with
   `{ type: "ORDER", events: ["ORDER_UPDATE", "ORDER_INVOICED"], url: <callback> }`
3. Callback URL pattern:
   `https://<project>.functions.supabase.co/supplier-webhook/abc/events/{local_abc_webhooks_id}`
4. ABC returns a per-registration `secret` **once**. Stored immediately into `abc_webhooks.secret`. Never returned to the frontend, never logged.
5. Audit row written to `abc_api_audit` (response body redacted — `secret_stored: true` only).

## Receiver flow

`POST /supplier-webhook/abc/events/:webhook_id`

1. Lookup `abc_webhooks` by `id = :webhook_id`. Unknown id → 404 + quarantine row with `tenant_id=null`.
2. Resolve tenant from the registration row.
3. Determine event:
   - `ORDER_UPDATE` — secret in `Authorization` header (raw or `Bearer <secret>`).
   - `ORDER_INVOICED` — secret in body `webhookDetails[].apiKey`.
4. **Constant-time** compare against stored secret. **No HMAC.**
5. Invalid → insert event with `signature_valid=false`, `quarantine_reason="invalid_signature"`, return 401.
6. Valid → insert with `signature_valid=true` + `payload_hash = sha256(raw body)`.

## Idempotency

Duplicate detection does NOT rely solely on `order_id`. Two unique indexes:

- `(webhook_id, event_type, payload_hash)` — primary dedupe.
- `(provider, provider_event_id)` partial where `provider_event_id IS NOT NULL` — used when ABC supplies an event id.

On unique-violation the receiver returns **`200 { ok: true, duplicate: true }`** so ABC stops retrying. (Never 409.)

## Order matching

Tenant-scoped lookup against `abc_orders` by `order_number`, `confirmation_number`, `purchase_order`, then `request_id`. No match → `quarantine_reason="unresolved_order"`, return **202** `{ ok: true, quarantined: true }`.

## Side effects

- `ORDER_UPDATE` → updates `abc_orders.order_status` (uses payload status if provided: `shipped`/`delivered`/`cancelled`/etc., else `"updated"`), patches `raw_payload.webhook_latest`, bumps `updated_at`. Timestamp columns (`shipped_at`, etc.) updated only if present — schema currently has none, so they're skipped safely.
- `ORDER_INVOICED` → sets `order_status='invoiced'` + upserts `abc_invoices` by `(tenant_id, invoice_number)`.

## Security gates

- Tenant resolved server-side from `abc_webhooks.id`. Payload tenant fields ignored.
- All writes use service role with explicit `.eq('tenant_id', resolvedTenantId)`.
- Webhook secret never returned to frontend, never logged, never appears in `abc_api_audit`.
- Verification is constant-time.

## Known unknowns (ABC confirmation pending)

- Sandbox callback delivery behavior (is sandbox actually firing events?).
- Required HTTP response code on success — we return 200; partner docs unconfirmed.
- Retry/backoff schedule.
- Inbound IP allowlist (none documented; HTTPS only).

## O'Brien gate

Registration UI hidden behind the existing `useSupplierDeveloperMode` / `isObrienSandboxTenant` gate until ABC confirms production behavior. Backend route is tenant-ready — gate is UI-only.
