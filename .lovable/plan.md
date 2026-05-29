## Goal

Add Square as a tenant-facing payment provider the right way:
- OAuth Connect (no token paste)
- Square-hosted checkout links per invoice (no custom card form)
- Signed `payment.updated` webhook reconciling into `project_payments`
- Idempotent so one webhook never double-records a payment

Pre-requisite: normalize the invoice payment-link server contract so Stripe, Zelle, and Square all flow through the same `create-invoice-payment-link` route. Server resolves tenant, invoice, balance, contact, and project — never trusts client-posted amounts.

Square UI gated to master / O'Brien only at launch (per tenant-security policy and your direction). Open to all tenants after live validation.

---

## Phase 0 — Payment-contract cleanup (do FIRST, before Square)

Routed through existing `payments-api` grouped function per architecture guard.

1. **New canonical route**: `POST /create-invoice-payment-link`
   - Body: `{ invoice_id: uuid, provider: 'stripe' | 'square' | 'zelle' }`
   - Server resolves: tenant_id from JWT → invoice → outstanding balance → contact → project → tenant provider connection.
   - Rejects if balance ≤ 0, invoice belongs to another tenant, or provider not connected for that tenant.
   - Writes `payment_links` row with `provider`, `invoice_id`, `amount`, `status='pending'`, `provider_*` IDs.
   - Returns `{ url, payment_link_id }`.

2. **Fix Stripe contract drift**
   - `stripe-create-payment-link` becomes a thin internal helper called by the new route — no longer called directly from the AR UI.
   - Repair `stripe-webhook` (currently 501) to verify signature, ack 2xx fast, and write `project_payments` idempotently keyed on `stripe_event_id`.

3. **Zelle alignment**
   - "Send Zelle Info" → calls canonical route with `provider='zelle'`, which generates the tokenized Zelle page URL via existing `zelle-payment-page` GET handler. No behavior change for users.

4. **AR page (`AccountsReceivablePage`) refactor**
   - Replace direct `stripe-create-payment-link` / `zelle-payment-page` calls with a single `createInvoicePaymentLink(invoice_id, provider)` hook.
   - No more client-posted amounts.

---

## Phase 1 — Square OAuth Connect

### Database
New migration: `tenant_square_accounts`
- `id`, `tenant_id` (unique), `environment` ('sandbox'|'production'), `access_token_encrypted`, `refresh_token_encrypted`, `access_token_expires_at`, `merchant_id`, `merchant_name`, `selected_location_id`, `selected_location_name`, `scopes text[]`, `status` ('connected'|'needs_reauth'|'disconnected'), `connected_by uuid`, `connected_at`, `disconnected_at`, `last_webhook_at`, timestamps.
- RLS: SELECT/UPDATE/DELETE only for users with access to `tenant_id`; INSERT only via edge function (service role).
- GRANTs for `authenticated` + `service_role`.
- Tokens encrypted via pgsodium or stored in vault-style helper (matching how `tenant_stripe_accounts` handles secrets — verify pattern in repo and mirror it).

### Edge function routes (in `payments-api` group)
- `GET  /square/oauth/authorize-url` → returns Square OAuth URL with state token tied to tenant_id + user_id (signed JWT, short TTL).
- `GET  /square/oauth/callback` (public, no JWT required, validates state) → exchanges code, stores tokens, fetches merchant + locations, stores first location as default.
- `POST /square/locations` → list locations from Square for the connected tenant.
- `POST /square/set-location` → update `selected_location_id`.
- `POST /square/disconnect` → revoke tokens with Square, mark status disconnected.

### Webhook routes (in `payments-webhook` group)
- `POST /square/oauth-revoked` → handles `oauth.authorization.revoked`, marks tenant disconnected.

### Settings UI (Settings → Payments)
New `SquareConnectionCard.tsx`:
- Status badge: Connected / Needs Reconnect / Disconnected
- Connect Square button (launches OAuth popup → callback closes it → invalidate query)
- Merchant name, default location selector, sandbox/production indicator
- Last webhook sync, Disconnect button
- **Gated behind `isMasterUser` for now** (per visibility decision); other tenants see "Coming soon" or nothing.

---

## Phase 2 — Square hosted checkout + reconciliation

### Edge function additions
- `payments-api`: when `create-invoice-payment-link` is called with `provider='square'`:
  - Pull tenant's Square access token + selected location.
  - Call Square Checkout API `POST /v2/online-checkout/payment-links` (quick_pay mode: name, price_money, location_id, redirect_url back to portal).
  - Persist `payment_links.provider='square'`, `provider_payment_link_id`, `provider_order_id`, `provider_location_id`, `provider_status='pending'`.
  - Return hosted URL.

### Webhook routes (in `payments-webhook` group)
- `POST /square/payment-updated` → verifies `x-square-hmacsha256-signature` against `SQUARE_WEBHOOK_SIGNATURE_KEY`, acks 2xx fast.
  - Idempotency: dedupe on `square_event_id` (new `processed_webhook_events` table OR existing equivalent — audit first).
  - Look up `payment_links` by `provider_order_id` / `provider_payment_id`.
  - On `COMPLETED`: insert `project_payments` row (idempotent on `provider_payment_id`), update `payment_links.status='paid'`, update invoice balance.
  - Update `tenant_square_accounts.last_webhook_at`.

### Provider extension on `payment_links`
- Migration: add `provider`, `provider_order_id`, `provider_payment_id`, `provider_location_id`, `provider_status`, `square_event_id` (if not present). Backfill `provider='stripe'` for existing rows.

---

## Phase 3 — Secrets & deploy

Secrets needed (will request via `add_secret`):
- `SQUARE_APP_ID`
- `SQUARE_APP_SECRET`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_ENVIRONMENT` (sandbox initially)
- `SQUARE_OAUTH_STATE_SECRET` (signing key for state JWT)

Square dashboard configuration (user-facing):
- OAuth redirect URL: `https://<project-ref>.functions.supabase.co/payments-api/square/oauth/callback`
- Webhook subscription URL: `https://<project-ref>.functions.supabase.co/payments-webhook/square/payment-updated`
- Subscribe events: `payment.updated`, `oauth.authorization.revoked`

---

## Out of scope (deferred)

- Square Invoices API (revisit only if we want Square to own installment schedules)
- Square Web Payments SDK (embedded card form)
- Opening Square to all tenants — happens after live validation
- Refunds / partial-payment UI

---

## Files touched (estimate)

Backend:
- `supabase/migrations/*` — `tenant_square_accounts`, `payment_links` extension, `processed_webhook_events` if needed
- `supabase/functions/payments-api/` — new routes (Square OAuth + canonical link creator)
- `supabase/functions/payments-webhook/` — new Square webhook routes; repair stripe-webhook
- `supabase/functions/_shared/square.ts` — Square SDK wrapper + signature verifier + token encryption helpers

Frontend:
- `src/components/settings/SquareConnectionCard.tsx` (new)
- `src/components/settings/SupplierIntegrationsPanel.tsx` or payments equivalent — mount Square card
- `src/hooks/useCreateInvoicePaymentLink.ts` (new) — single hook for AR
- `src/pages/AccountsReceivablePage.tsx` — swap to canonical hook
- `src/lib/edgeApi.ts` — confirm routing helper exists; reuse

---

## Risk / dependencies

- Token encryption: must mirror whatever `tenant_stripe_accounts` does today — I'll audit before the migration so we don't invent a new pattern.
- `stripe-webhook` is currently 501; repairing it is in scope (Phase 0 step 2) but will surface any historic missed events. We'll log but not retro-process.
- `payment_links` shape today may already differ from this plan — I'll read the live schema before writing the migration.

---

## Sequencing

1. Plan approval (this).
2. Audit: live schema of `payment_links`, `project_invoices`, `project_payments`, `tenant_stripe_accounts`; existing `payments-api` / `payments-webhook` routers; Square dashboard credentials available?
3. Phase 0 migrations + canonical route + AR refactor + Stripe webhook repair. Ship & verify.
4. Request Square secrets, run Phase 1 migration, build OAuth routes + Settings card. Ship & verify connect flow in sandbox.
5. Phase 2 link creation + webhook. Sandbox end-to-end payment test.
6. Open Square card to all tenants once green.