
# ABC Supply API Integration — Full Plan (Per-Tenant)

Modeled after the existing `SRS Distribution Integration` (per-tenant credentials, edge functions, webhook ingestion). Adapts the research doc to Pitch CRM conventions: `tenant_id` (not `organization_id`), `useEffectiveTenantId()`, `npm:` specifiers + `Deno.serve(handler)`, and `pitch-crm.ai` for callback/webhook URLs.

---

## Phase 1 — Database schema & RLS

New tables (all with `tenant_id uuid not null`, RLS scoped via existing tenant helpers — same pattern as `srs_*` tables):

- `abc_integrations` — one row per tenant per environment (sandbox/production). Fields: `abc_mode` (individual_business | third_party_aggregator), `environment`, `token_strategy` (auth_code_pkce | client_credentials), `client_id`, `redirect_uri`, `status`, `webhook_id`, `webhook_secret`, audit cols. Unique `(tenant_id, environment)`.
- `abc_tokens` — encrypted via pgcrypto (`access_token_enc`, `refresh_token_enc` bytea), `token_type`, `scope`, `access_token_expires_at`, `refresh_token_last_used_at`, `raw_token_response jsonb`. PK = `integration_id`.
- `abc_accounts` — sold_to / bill_to / ship_to with `account_kind`, `account_number`, parent links, `raw_payload`.
- `abc_branches` — branch number, geo, hours, `raw_payload`.
- `abc_items`, `abc_item_availability` — product catalog snapshot per branch.
- `abc_price_requests` — request/response JSONB log (pricing requires user token).
- `abc_orders` + `abc_order_lines` — order header/lines with `raw_payload` for full ABC body.
- `abc_invoices` + `abc_invoice_lines` — invoice mirror; `pdf_storage_path` reference.
- `abc_webhooks` — registered webhook config (id, type, events, secret).
- `abc_webhook_events` — every received event payload, with `accepted`, `authorization_header`, indexed by `order_number`/`invoice_number`.
- Optional link table `abc_order_job_links (order_id, job_id, tenant_id)` so an ABC order is bound to a Pitch job/estimate.

RLS: read for tenant members, mutate for tenant admins/owners only. Token row never readable client-side; all access goes through edge functions using service role.

Storage buckets (private, RLS keyed on `tenant_id` as first folder per project standard):
- `abc-invoices/{tenant_id}/{invoice_number}.pdf`
- `abc-item-images/{tenant_id}/{item_number}/{asset_id}.jpg`

---

## Phase 2 — Secrets & app registration

User must register a Pitch CRM app with ABC Supply (sandbox + production) and provide:
- `ABC_SUPPLY_CLIENT_ID_SANDBOX`, `ABC_SUPPLY_CLIENT_SECRET_SANDBOX`
- `ABC_SUPPLY_CLIENT_ID_PROD`, `ABC_SUPPLY_CLIENT_SECRET_PROD`
- `ABC_SUPPLY_TOKEN_ENCRYPTION_KEY` (for pgcrypto symmetric encryption of stored refresh tokens)

Auth servers (per docs):
- Sandbox: `https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8`
- Prod: `https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357`

API bases: `partners-sb.abcsupply.com` / `partners.abcsupply.com` (per page-level Resource URLs — treated as authoritative over example Host headers, per research doc).

OAuth callback URL: `https://pitch-crm.ai/integrations/abc-supply/oauth-callback`
Webhook receiver URL: `https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-webhook-receiver`

---

## Phase 3 — Edge functions

All use `npm:` specifiers and `Deno.serve(handler)`. Tenant identity from JWT via `getClaims()` then resolved to `tenant_id`. Service-role client used for token/secret reads.

1. **`abc-oauth-start`** — generates PKCE pair, stores `code_verifier` + `state` in short-lived `abc_oauth_states` table, returns ABC `/v1/authorize` URL with scopes (`location.read product.read account.read pricing.read order.read order.write notification.read notification.write offline_access`).
2. **`abc-oauth-callback`** — exchanges code for token via `/v1/token` (HTTP Basic auth header per docs), encrypts refresh token, writes `abc_integrations` + `abc_tokens`, marks status `connected`.
3. **`abc-token-refresh`** — refreshes access token (30-min lifetime) using stored refresh token; if 30+ days idle → mark `status='error'`, surface re-auth prompt. Called by every other function via shared `getValidAbcToken(integrationId)` helper.
4. **`abc-client-credentials-token`** — for app-only flows (location/product/notification when ABC permits).
5. **`abc-account-sync`** — pulls Sold-To / Bill-To / Ship-To and contacts; upserts `abc_accounts`.
6. **`abc-branch-sync`** — `/api/location/v1/branches` (lat/long/distance or zip queries); upserts `abc_branches`.
7. **`abc-item-search`** — search/favorite items, fetch images to storage; upserts `abc_items` + `abc_item_availability`.
8. **`abc-pricing`** — already exists; rewire to ABC-pricing v1 endpoint with `purpose=estimating|quoting|ordering`, ship_to + branch params; persist request/response in `abc_price_requests`. Pricing must use user token (third-party client_credentials cannot get pricing — surface clear error if integration is in that mode).
9. **`abc-order-create`** — `POST /api/order/v2/orders`. Validates payload, links to `job_id`/`estimate_id` from caller, persists raw response, writes order + lines.
10. **`abc-order-history`** + **`abc-order-detail`** — read-side syncing with date-range pagination; idempotent upsert by `confirmation_number`.
11. **`abc-webhook-register`** — `POST /api/notification/v2/webhooks`. Registers ONE webhook per tenant per docs guidance (5-app cap, 1 recommended) targeting the receiver URL with a per-tenant secret; persists `webhook_id` + `secret`.
12. **`abc-webhook-receiver`** (PUBLIC, no JWT, like `srs-webhook`) — verifies `Authorization` header equals stored `webhook_secret` for the matched webhook; logs every event raw to `abc_webhook_events`; routes by `eventType`:
    - `ORDER_UPDATE` → upsert `abc_orders` + `abc_order_lines`, broadcast tenant channel.
    - `ORDER_INVOICED` → upsert `abc_invoices` + lines, kick off `abc-invoice-pdf-fetch`.
    - Treat `ORDER_STATUS` as alias of `ORDER_UPDATE`. Unknown event types stored, not dropped.
    - Always returns 200 once persisted (ABC retry behavior is unspecified — never throw).
13. **`abc-invoice-pdf-fetch`** — downloads invoice PDF (when third-party aggregator can; otherwise mark unavailable per docs gap), stores to `abc-invoices` bucket, persists `pdf_storage_path`.
14. **`abc-token-refresh-scheduler`** — pg_cron-invoked every 15 min; refreshes any token expiring in <10 min.

Every function: input validated with Zod, returns clear 4xx with actionable messages, includes CORS headers from `npm:@supabase/supabase-js@2/cors`.

---

## Phase 4 — Frontend (React + Tanstack Query)

New feature module `src/features/abc-supply/`:

- `pages/AbcSupplyIntegrationPage.tsx` (route `/settings/integrations/abc-supply`):
  - Connection card: env toggle (Sandbox/Production), mode toggle (Individual-Business / Third-party Aggregator), "Connect with ABC Supply" button (kicks off `abc-oauth-start`), status pill, token expiry, "Disconnect" action.
  - Sub-tabs: **Accounts**, **Branches**, **Catalog**, **Pricing log**, **Orders**, **Invoices**, **Webhooks/Events**.
- `components/AbcAccountsList.tsx`, `AbcBranchesList.tsx`, `AbcItemSearch.tsx`, `AbcPricingDrawer.tsx`, `AbcOrderBuilder.tsx`, `AbcOrderDetail.tsx`, `AbcInvoiceList.tsx`, `AbcWebhookEventsTable.tsx`.
- Estimate integration: in the existing Estimate builder, add an "Order from ABC Supply" action that maps line items → ABC items (using saved item mappings) and calls `abc-order-create`, persisting the link in `abc_order_job_links`.
- All queries strictly filter `.eq('tenant_id', effectiveTenantId)` per project memory.
- Realtime: subscribe to `abc_orders`, `abc_invoices`, `abc_webhook_events` filtered by tenant_id.

OAuth callback handler at `/integrations/abc-supply/oauth-callback` simply forwards `code` + `state` to `abc-oauth-callback` then redirects to settings page.

---

## Phase 5 — Documentation, tests, observability

- `docs/abc-supply-integration.md` — environments, scopes, mode matrix, doc-inconsistency notes (resource URL vs Host header, `account/v1` vs `accounts/v1`, `order.read` vs `allOrder.read`, ORDER_UPDATE vs ORDER_INVOICED vs ORDER_STATUS), retry behavior caveats.
- Deno tests for: OAuth callback (PKCE happy path + replay rejection), token refresh (expiry math, 30-day idle handling), webhook receiver (secret mismatch returns 200 + `accepted=false`, ORDER_INVOICED upserts invoice), order create (validation errors).
- Memory entry once shipped: `mem://features/abc-supply-integration` — per-tenant pattern, scope matrix, webhook secret verification, Resource-URL-as-canonical rule.

---

## Technical notes & guardrails

- **Inconsistencies handled by treating page-level "Resource" URL as canonical** (`partners-sb`/`partners`); never trust example Host headers.
- **Pricing requires user token**: if a tenant connects via third-party client_credentials, pricing UI is disabled with explanatory tooltip.
- **Invoice endpoints** flagged "not yet available" for third-party aggregators per docs — surface as gated feature.
- **Webhook retries unspecified** → receiver is idempotent (upsert by `confirmation_number`/`invoice_number`) and always responds 200 after persist.
- **Rate limits**: sandbox 10 tps; production varies by API family. Add a lightweight token-bucket per tenant in `abc-` shared helper before large bulk syncs.
- **Token storage**: refresh tokens encrypted with pgcrypto using `ABC_SUPPLY_TOKEN_ENCRYPTION_KEY`; never returned to client.
- **Result-state parity with existing SRS module** so admin tooling looks consistent.

## Open question (will confirm before coding)

Default environment for first connection: launch in **Sandbox-only** for the first tenant, then enable Production gating behind an admin feature toggle? (Recommended.) If you want both available immediately, say so and I'll skip the toggle.
