

# Zelle Payment Flow — Completion Plan

## What's Already Done
- Database: `tenant_settings` has all Zelle columns, `payment_links` has `payment_type`, `shareable_token`, `zelle_confirmation_status`
- Edge function: `zelle-payment-page` handles GET (fetch details) and POST (notify sent) — deployed and working
- Public page: `ZellePaymentPage.tsx` at `/pay/:token` — fully built with copy buttons, instructions, notify flow
- Settings: `ZelleSettings.tsx` — fully built, saves to `tenant_settings`
- Routes: `/pay/:token` registered in both `App.tsx` and `publicRoutes.tsx`

## What Needs to Be Built (2 changes)

### 1. PaymentsTab — Add Zelle link generation and confirmation
**File:** `src/components/estimates/PaymentsTab.tsx`

Add:
- Query for `zelleLinks` from `payment_links` filtered by `pipeline_entry_id` and `payment_type = 'zelle'`
- Query for `zelleSettings` from `tenant_settings` to check if Zelle is enabled
- `handleSendZelleLink(invoice)` — inserts a `payment_links` row with `payment_type: 'zelle'`, generates a `shareable_token`, copies the `/pay/{token}` URL to clipboard
- `handleConfirmZellePayment(paymentLink, invoice)` — inserts a `project_payments` row, updates invoice balance/status, marks the payment link as confirmed
- Invoice action dropdown gets a "Zelle Payment Link" option (alongside existing Stripe option)
- Pending Zelle links show a "Confirm Zelle" button on the invoice row

### 2. CustomerPortalPublic — Fix broken Zelle link
**File:** `src/pages/CustomerPortalPublic.tsx`

Replace the broken `/pay/zelle?amount=...&ref=...` href with a lookup against existing `payment_links` for that invoice. If a Zelle payment link exists, use `/pay/{shareable_token}`. If none exists, hide the Zelle button (since only the CRM user should generate links, not the customer portal).

### Technical Details
- Token generation uses `crypto.randomUUID().replace(/-/g, '').slice(0, 16)` for short, URL-safe tokens
- Zelle confirmation records payment with `payment_method: 'zelle'` and reference `ZELLE-{token}`
- Invoice balance recalculation: `Math.max(currentBalance - paymentAmount, 0)`, status set to `paid` if zero, `partial` if reduced
- No migration needed — all columns already exist

