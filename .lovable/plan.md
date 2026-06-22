
# PR #2 — Referral Attribution + Stripe Subscription Webhook

## Scope discovery (already done)

Existing pieces in repo:
- `provision-tenant-owner` — creates the auth user, profile, role, and `user_company_access` row. **Has no referral hook today.**
- `attach-crm-referral-to-new-company` — exists, but its code references columns that **don't exist** on the live `crm_referral_company_signups` table (`referred_company_id`, `referred_owner_user_id`, `partner_code`, `subscription_id`, `payment_customer_id`, etc.). Real table uses `company_id`, `partner_id`, `signup_status`, `first_invoice_amount`, `paid_at`, `subscription_plan`. This function is stale and must be corrected, not just called.
- `sync-crm-referral-subscription-status` — same staleness. Writes to non-existent fields (`active_paid_at`, `qualifying_revenue`, `cancelled_at`) and calls `crm_referral_status_history` with `reason` / `referral_company_signup_id` (real columns are `change_reason` / `signup_id` / `entity_type`).
- `stripe-webhook` — production webhook. Already signature-verified, dedups via `stripe_webhook_events.event_id` UNIQUE, only handles `checkout.session.completed` + `payment_intent.succeeded` (for `project_payments`, not subscriptions). Subscription/invoice events are unhandled.
- `tenants` table — already has `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `subscription_tier`, `subscription_expires_at`.
- `stripe_webhook_events` — already has `event_id` (UNIQUE), `event_type`, `signature_valid`, `accepted`, `payload`, `processing_error`, `processed_at`, `tenant_id`.

Net effect: most of the surface exists, but the referral helpers are broken against the live schema and the webhook is silent on subscription lifecycle. PR #2 fixes both.

## Migrations

### 1. Subscription history audit table
```
crm_referral_subscription_history (
  id uuid pk,
  signup_id uuid -> crm_referral_company_signups(id),
  tenant_id uuid,
  company_id uuid,
  previous_status text,
  next_status text,
  stripe_event_id text,
  stripe_event_type text,
  source text,                      -- 'stripe_webhook' | 'manual' | 'sync_fn'
  paid_amount numeric,
  notes text,
  created_at timestamptz default now()
)
```
GRANT to `service_role`; SELECT to `authenticated` filtered by `tenant_id` via RLS using existing `has_role` / `user_company_access` pattern. Index on `(stripe_event_id)`, `(signup_id)`, `(tenant_id, created_at desc)`.

### 2. Extra columns on `stripe_webhook_events`
Add `related_company_id uuid`, `related_subscription_id text`, `related_signup_id uuid`. These are nullable and only filled when the webhook resolves them.

### 3. Index on `tenants(stripe_customer_id)` and `tenants(stripe_subscription_id)`
Partial indexes (`WHERE NOT NULL`) for the webhook-side lookup chain.

### 4. No schema change to `crm_referral_company_signups`
We use the existing columns. Mapping in §"Status mapping" below.

## Edge function changes

### A. Rewrite `attach-crm-referral-to-new-company` against the real schema
- Input: `{ company_id, owner_user_id, owner_email, partner_code?, visitor_id?, session_id?, subscription_plan? }`.
- Match order (unchanged conceptually): partner_code → visitor/session cookie → owner_email.
- Idempotency: if a signup row already has `company_id = <input>`, return `{ attributed: true, idempotent: true }` without re-writing. Otherwise claim the first signup row in the matched partner where `company_id is null`.
- Update fields that actually exist: `company_id`, `admin_user_id` (= owner_user_id), `subscription_plan`, `signup_status='account_created'`, `updated_at`.
- Append `crm_referral_status_history` using correct columns: `signup_id`, `entity_type='signup'`, `old_status`, `new_status`, `change_reason`, `changed_by`.
- No-match path returns `{ attributed: false, reason: 'no_match' }` and is **non-fatal** for the caller.

### B. Hook into `provision-tenant-owner`
After Step 5 (`user_company_access` upsert) and before email send, call the corrected `attach-crm-referral-to-new-company` over the service role with `{ company_id: tenant_id, owner_user_id: userId, owner_email: ownerEmail }`. Wrap in try/catch — referral failures must never block owner provisioning. Log result into `company_activity_log` (`action_type: 'referral_attached' | 'referral_skipped'`).

### C. Extend `stripe-webhook` for subscription lifecycle
Add cases:
- `checkout.session.completed` — already handled for invoices; add a second branch for sessions whose `mode === 'subscription'`: persist `stripe_customer_id` + `stripe_subscription_id` on `tenants` (resolve via `metadata.tenant_id`/`metadata.company_id`), then dispatch to sync.
- `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted` — update `tenants.subscription_status`, `subscription_tier` (from price metadata or plan id), `subscription_expires_at` (= `current_period_end`), `stripe_subscription_id`, then dispatch to sync.
- `invoice.paid` — strongest paid signal. Dispatch to sync with `status='active_paid'` and `paid_amount = invoice.amount_paid/100`.
- `invoice.payment_failed` — dispatch to sync with `status='payment_failed'`.
- `checkout.session.async_payment_succeeded` / `checkout.session.async_payment_failed` — same as invoice paid / failed but scoped to the session.

Resolution order for `company_id` (server-side, never trust body): `metadata.company_id` → `metadata.tenant_id` → lookup `tenants` by `stripe_customer_id` → lookup `tenants` by `stripe_subscription_id` → log unresolved into `stripe_webhook_events.processing_error='unresolved_company'` and return 200 (no Stripe retry storm). Resolved IDs are written into the new `related_*` columns.

All sync dispatches stamp `stripe_event_id` so the new history table records causality.

### D. Rewrite `sync-crm-referral-subscription-status` against real schema
- Accepts `{ company_id, subscription_id?, customer_id?, status, paid_amount?, stripe_event_id?, stripe_event_type?, source? }`.
- Resolves signup row by `company_id` (preferred) or via `tenants.stripe_customer_id`/`stripe_subscription_id` → `tenants.id` → `company_id`.
- Status mapping (using existing `crm_referral_company_signups` columns):
  - `active_paid` → `signup_status='active_paid'`, set `paid_at` if null, accumulate `first_invoice_amount` if first payment, recompute `payout_eligible`.
  - `trialing` → `signup_status='trialing'`, no payout.
  - `payment_failed` / `past_due` → `signup_status='payment_failed'`.
  - `canceled` → `signup_status='churned'`, set `churned_at`.
- Insert into `crm_referral_subscription_history` with `stripe_event_id`, previous/next status, source.
- Insert into `crm_referral_status_history` for backwards-compat.
- Payout creation guard: only on transition into `active_paid`, only if no existing payout for that signup. Logic preserved from current function but reads from the real `crm_referral_program_settings` columns already in use.

### Auth modes (declared)
- `provision-tenant-owner` — internal/service caller (unchanged).
- `attach-crm-referral-to-new-company` — service-role internal endpoint (rewrite removes `requireUser`; protect with `INTERNAL_WORKER_SECRET` header check OR keep `requireUser` but allow service role).
- `stripe-webhook` — **public webhook**, signature-verified (unchanged).
- `sync-crm-referral-subscription-status` — internal-only, service-role required.

## Frontend
No UI changes for this PR. The existing "Mark Active Paid" admin action stays as a fallback and writes `source='manual'` into the new history table (single-line edit).

## Tests (`tests/integration/referral-stripe-pr2.test.ts`)
- Referral attribution: valid partner → row claimed; duplicate call → idempotent; no match → onboarding succeeds, no row; attribution row cannot be reclaimed by an unrelated partner code.
- Stripe webhook: bad signature → 400; `checkout.session.completed` (subscription mode) → tenant linked; `invoice.paid` → `signup_status='active_paid'` + history row + payout created once; `invoice.payment_failed` → `payment_failed`; `customer.subscription.deleted` → `churned`; duplicate event_id → ignored; unresolved company → logged with `processing_error='unresolved_company'`, returns 200; manual path still works and stamps `source='manual'`.

## Secrets required (already present per .env conventions)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — confirm with `fetch_secrets` before deploy; request via `add_secret` if missing.
- `INTERNAL_WORKER_SECRET` — used to protect `attach-crm-referral-to-new-company` and `sync-crm-referral-subscription-status` when called server-to-server.

## Out of scope (deferred to PR #3+)
- Address validation
- Weather auto-pause
- Unified comms timeline UI
- Stripe Checkout session creation flow (assumed already in place via `stripe-create-payment-link` / Connect onboarding)
- Telemetry dashboards for referral funnel

## Definition of done
- New owner provisioning attempts referral attribution exactly once and never blocks on failure.
- Stripe subscription/invoice events update `tenants.subscription_status` and the referral signup state automatically.
- `crm_referral_subscription_history` shows each transition with the causing `stripe_event_id`.
- Duplicate Stripe deliveries are no-ops.
- Manual "Mark Active Paid" still functions, tagged `source='manual'`.
