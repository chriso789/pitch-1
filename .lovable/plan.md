# Phase 2 Slice B — Invoice Email Delivery + Staff Actions

## Scope
Enable authorized staff to send Pitch-branded invoice emails via Resend, pointing to the secure Slice A portal (never raw QBO URLs). Full delivery lifecycle, webhook status sync, idempotency, bounce/complaint safety, RLS-hardened.

## Out of scope (do NOT build)
SMS, auto-reminders, auto-closeout, warranty gen, native card/ACH, financing, marketing email.

---

## 1. Database migrations

### 1a. `tenant_email_settings` (create or extend)
Columns: `tenant_id` (PK), `provider` ('resend' default), `from_name`, `from_email`, `reply_to`, `sending_enabled` bool, `verified_domain_status` ('unverified'|'pending'|'verified'), `invoice_template_version` int default 1, `platform_sender_fallback_enabled` bool default true, timestamps.
- RLS: tenant admins can read/write own row; service_role full.
- **No** provider API key column — API key lives only in edge function env (`RESEND_API_KEY` secret).

### 1b. `invoice_email_deliveries`
Full spec column set from prompt §7. Status enum: `queued|accepted|sent|delivered|delayed|bounced|complained|failed`.
- Unique index on `(tenant_id, idempotency_key)` for dedupe.
- Index on `provider_message_id` (nullable, unique per provider).
- RLS: tenant-scoped read for authorized roles; **no** direct client insert/update — writes only via edge functions with service role + explicit `tenant_id` filter.

### 1c. `customer_invoice_events` (create if missing, else reuse)
Append-only event log: `id, tenant_id, project_id, pitch_invoice_id, portal_access_grant_id, delivery_id, event_type, event_data jsonb, actor_user_id, created_at`.
- Event types from prompt §12.
- RLS: read for tenant authorized staff; insert only via service role.

### 1d. `provider_webhook_events` (dedupe table)
`provider, provider_event_id (unique), received_at, processed_at, payload_hash`.
Used to reject duplicate Resend webhook deliveries.

---

## 2. Provider abstraction

`supabase/functions/_shared/email/types.ts` — interfaces:
- `TransactionalEmailProvider` with `sendInvoiceEmail`, `normalizeWebhookEvent`, `classifyProviderFailure`, `verifyWebhook`, `getProviderMessageId`.
- `NormalizedEmailEvent`, `SendInvoiceEmailInput`, `SendResult`.

`supabase/functions/_shared/email/resend-adapter.ts` — Resend implementation. Uses `RESEND_API_KEY` from env. Invoice/portal code imports only the interface.

`supabase/functions/_shared/email/index.ts` — `getEmailProvider(providerName)` factory.

---

## 3. Edge functions

### 3a. `invoice-email-send` (POST)
1. Auth: verify JWT, resolve user + tenant server-side.
2. Load Pitch invoice by ID; verify `tenant_id` matches.
3. Verify caller role (accounting/owner/admin/permitted).
4. Load recipient contact; verify belongs to project & tenant.
5. Resolve or create portal grant (Slice A helper).
6. Compute idempotency key = `hash(tenant_id | invoice_id | recipient_email | template_version | send_request_id)`.
7. Insert delivery row `status=queued` with `ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`. If existing row within N seconds and not explicit resend → return existing.
8. Resolve sender: verified tenant domain OR platform fallback with tenant display name.
9. Render HTML + text template (default from §6). CTA = Pitch portal URL (`/invoice/<token>`). **Never** QBO URL.
10. Call `provider.sendInvoiceEmail`. On success: update delivery `status=accepted`, store `provider_message_id`. On classified transient failure: schedule retry (bounded backoff). On hard failure: `status=failed`.
11. Append `invoice_email_queued`, `invoice_email_accepted` events.
12. Return safe result (no provider raw).

### 3b. `invoice-email-resend` (POST)
Explicit resend: generates new `send_request_id`, new idempotency key, new delivery row. Blocks if recipient is on bounce/complaint suppression unless caller has override permission.

### 3c. `invoice-portal-revoke` (POST)
Revokes portal grant, appends `portal_link_revoked` event.

### 3d. `resend-webhook` (POST, public but signature-verified)
1. `provider.verifyWebhook(headers, rawBody)` — HMAC via `RESEND_WEBHOOK_SECRET`. Reject 401 if invalid.
2. Insert into `provider_webhook_events` (unique on `provider_event_id`); if conflict → 200 no-op (idempotent).
3. `provider.normalizeWebhookEvent(payload)` → normalized event.
4. Look up delivery by `provider_message_id`; if unknown → log to quarantine table row (still 200 so provider stops retrying).
5. Update delivery: `delivered_at` only on `email.delivered`, not `email.sent` (accepted). Bounce/complaint set suppression flag.
6. Append matching `customer_invoice_event`.
7. Never modify QBO/accounting state.

### 3e. `invoice-portal-events` (POST)
Called by Slice A portal on view/link-click to log `customer_view_previewed`, `payment_link_clicked` etc. Already partially exists — extend.

---

## 4. Secrets required
- `RESEND_API_KEY` — request via `add_secret`.
- `RESEND_WEBHOOK_SECRET` — request via `add_secret` (user creates in Resend dashboard, pastes back).
- `PLATFORM_FALLBACK_FROM_EMAIL` — set via `set_secret` to `invoices@pitch-crm.ai`.

---

## 5. Frontend

### 5a. `src/components/invoices/InvoiceEmailActions.tsx`
Card added to Project → Invoice detail page. Buttons:
- Preview Customer View (opens Slice A portal in new tab)
- Copy Secure Invoice Link
- Send Invoice Email (opens confirm dialog with recipient shown, warns if ≠ QBO billing email)
- Resend Invoice (only if a prior sent delivery exists)
- Revoke Portal Link
- View Delivery Status (drawer showing timeline)
- View Customer Activity (drawer with events)

Permission-gated via existing role hooks (`useHasRole('accounting'|'owner'|'admin')` or explicit `invoice.send_email` permission).

### 5b. `src/components/invoices/InvoiceDeliveryTimeline.tsx`
Reads `invoice_email_deliveries` + `customer_invoice_events` for the invoice; renders status chips, timestamps, recipient. Safe reasons only — no raw payload.

### 5c. `src/hooks/useInvoiceDeliveries.ts`
Tenant-scoped query hook.

---

## 6. Recipient safety
- Zod validation for email syntax.
- Server confirms contact ↔ project ↔ tenant chain.
- If chosen recipient ≠ QBO customer billing email → return `{ requires_confirmation: true, qbo_email, chosen_email }`. UI prompts staff for explicit override.
- Suppression list check: if recipient in bounced/complained set for this tenant → block unless override permission + explicit `override_suppression: true` flag.

---

## 7. Idempotency + retries
- DB unique constraint enforces one delivery per idempotency key.
- Retry classification in `resend-adapter.classifyProviderFailure`: `transient` (429, 5xx, timeout) vs `permanent` (4xx not-429, invalid_recipient, unverified_sender).
- Retry loop: max 3 attempts, backoff 2s/8s/30s, all within same delivery row (`retry_count++`). No new delivery row for retries. Explicit resend = new row.

---

## 8. Tests
`supabase/functions/invoice-email-send/index.test.ts` — Deno tests covering:
- provider abstraction chosen correctly
- idempotent double-send
- tenant isolation (cross-tenant contact rejected, cross-tenant invoice rejected)
- recipient not on project rejected
- unverified sender rejected → falls back to platform sender
- portal URL present, QBO URL absent
- unauthorized role blocked

`supabase/functions/resend-webhook/index.test.ts`:
- valid delivered event updates status
- duplicate event no-ops
- bounce sets suppression
- unknown message_id quarantined
- invalid signature 401
- cross-tenant collision impossible

---

## 9. Acceptance evidence
Manual Playwright script hitting staging tenant, running §16 checklist end-to-end. Screenshots saved to `/mnt/documents/phase2-sliceb-evidence/`.

---

## 10. File inventory
**New:**
- `supabase/migrations/<ts>_phase2_sliceb_email.sql`
- `supabase/functions/_shared/email/{types,resend-adapter,index}.ts`
- `supabase/functions/invoice-email-send/index.ts` (+ test)
- `supabase/functions/invoice-email-resend/index.ts`
- `supabase/functions/invoice-portal-revoke/index.ts`
- `supabase/functions/resend-webhook/index.ts` (+ test)
- `supabase/functions/_shared/email/templates/invoice-default.ts`
- `src/components/invoices/InvoiceEmailActions.tsx`
- `src/components/invoices/InvoiceDeliveryTimeline.tsx`
- `src/hooks/useInvoiceDeliveries.ts`

**Modified:**
- Project → Invoice detail page: mount `<InvoiceEmailActions />`
- `supabase/config.toml`: register new functions with `verify_jwt` per route (send/resend/revoke = true; webhook = false)

## Known limitations to disclose after implementation
- Requires user to add `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` and verify a domain in Resend dashboard before real sends work.
- Platform fallback sender uses `invoices@pitch-crm.ai`; ensure that domain is verified in Resend.
- Suppression list is per-tenant, stored in `invoice_email_deliveries` derived query (no separate suppression table this slice).
