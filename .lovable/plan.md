

## Add Zelle Payment Support + Backend Readiness

### Overview

Add Zelle as a payment method alongside Stripe. Companies can configure their Zelle details (email/phone) in tenant settings, and the system generates "Zelle payment instruction links" (shareable pages with Zelle details + amount) that can be sent to clients. When clients pay via Zelle, staff manually confirms the payment (Zelle has no webhook API).

### What Zelle Actually Is

Zelle is a bank-to-bank transfer system. There is **no Zelle API** for businesses to integrate programmatically. The workflow is:
1. Company provides their Zelle-registered email or phone to the client
2. Client opens their banking app, searches for that email/phone in Zelle, and sends money
3. Company confirms receipt and records the payment

So "Zelle payment links" = a branded instruction page showing the company's Zelle info + invoice amount.

### Database Changes (1 migration)

**Add Zelle columns to `tenant_settings`:**
- `zelle_enabled` (boolean, default false)
- `zelle_email` (text, nullable) — company's Zelle-registered email
- `zelle_phone` (text, nullable) — company's Zelle-registered phone
- `zelle_display_name` (text, nullable) — name shown to clients
- `zelle_instructions` (text, nullable) — custom instructions

**Add columns to `payment_links`:**
- `payment_type` (text, default 'stripe') — 'stripe' or 'zelle'
- `zelle_confirmation_status` (text, default 'pending') — 'pending', 'confirmed', 'rejected'
- `shareable_token` (text, unique) — short token for public Zelle payment page URL

**Add `zelle` to payment method options in `project_payments`** (already text field, no schema change needed).

### New Edge Function: `zelle-payment-page`

A public-facing edge function that serves/returns Zelle payment instructions:
- Input: `token` (the shareable_token from payment_links)
- Returns: JSON with company Zelle details, amount, invoice number, instructions
- No auth required (public page for clients)
- The frontend can render this as a nice branded page

### Frontend Changes

**1. Tenant Settings — Zelle Configuration (`src/components/settings/` or similar)**
- New section in company settings: "Payment Methods"
- Toggle to enable Zelle
- Fields for Zelle email, phone, display name, custom instructions
- Save to `tenant_settings` table

**2. PaymentsTab.tsx — Add Zelle Payment Link Option**
- When clicking the link icon on an invoice, show a choice: "Stripe" or "Zelle"
- If Zelle selected: create a `payment_links` record with `payment_type='zelle'`, generate a shareable token, build a URL like `{app_url}/pay/{token}`
- Copy the link to clipboard
- Show Zelle link status badge (pending/confirmed)

**3. New Route: `/pay/:token` — Public Zelle Payment Page**
- Fetches payment details via the edge function
- Shows: company name, Zelle email/phone, amount due, invoice number
- Instructions: "Open your banking app → Send via Zelle to [email/phone] → Amount: $X,XXX"
- Clean, branded, mobile-friendly page
- "I've sent the payment" button that updates status to awaiting confirmation

**4. PaymentsTab.tsx — Confirm Zelle Payment**
- For Zelle payment links with status 'pending', show "Confirm Payment" button
- On confirm: record in `project_payments` (method: 'zelle'), update invoice balance, mark link as 'confirmed'

### Stripe Backend Readiness

The Stripe integration is already built and ready:
- `stripe-create-payment-link` edge function exists
- `stripe-webhook-handler` handles `checkout.session.completed` and updates invoices
- `payment_links` table exists
- PaymentsTab has the "Send Payment Link" button wired up

**Only missing**: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` secrets need to be added when you're ready to activate Stripe.

### File Summary

| File | Action |
|------|--------|
| Migration SQL | Add Zelle columns to `tenant_settings` + `payment_links` |
| `supabase/functions/zelle-payment-page/index.ts` | New — public endpoint returning Zelle payment details |
| `src/components/settings/ZelleSettings.tsx` | New — Zelle configuration UI for company settings |
| `src/components/estimates/PaymentsTab.tsx` | Edit — add Zelle link generation + confirmation flow |
| `src/pages/ZellePaymentPage.tsx` | New — public-facing payment instruction page |
| Route config | Add `/pay/:token` route |

### Mapbox Token

The `get-mapbox-token` edge function requires auth headers. I'll test it via the browser once you're logged in, or I can update the function to not require auth. The token itself should be working if you updated it in Supabase Edge Function secrets.

