

## Add Stripe Payment Links to Project Invoices

### What We're Building
A "Send Payment Link" button on each invoice in the PaymentsTab that generates a Stripe Payment Link and lets the client pay online. When the client pays, the webhook automatically records the payment and updates the invoice balance.

### Current State
- `stripe-create-payment-link` edge function exists and works (creates Stripe Payment Links)
- `stripe-webhook-handler` exists but updates a generic `payments` table, NOT `project_payments`/`project_invoices`
- `PaymentsTab.tsx` has invoice creation and manual payment recording — no Stripe integration
- `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are already configured
- **Missing**: `STRIPE_WEBHOOK_SECRET` secret (needed for webhook verification)
- **Missing**: `payment_links` table doesn't exist yet (the edge function tries to insert into it)

### Steps

**Step 1 — Create `payment_links` table + add `stripe_payment_link_url` to `project_invoices`**

Migration to:
- Create `payment_links` table (stores Stripe link ID, URL, amount, status, linked invoice_id)
- Add `stripe_payment_link_url` column to `project_invoices` for quick access
- Add RLS policies

**Step 2 — Update `stripe-webhook-handler` to record payments in `project_payments`**

When `checkout.session.completed` fires:
- Look up the `payment_links` record by metadata
- Find the linked `project_invoices` record
- Insert into `project_payments` (amount, method='stripe', reference=stripe session ID)
- Update `project_invoices` balance and status
- Update `payment_links` status to 'completed'

**Step 3 — Add "Send Payment Link" button to PaymentsTab invoice cards**

For each invoice row:
- Add a small "Send Link" / link icon button
- On click: call `stripe-create-payment-link` with invoice amount, invoice_id in metadata
- Show the generated URL (copy to clipboard)
- Show link status badge (active/paid) if a link exists

**Step 4 — Request `STRIPE_WEBHOOK_SECRET`**

Prompt user to add the webhook secret so payment confirmations work end-to-end.

### Technical Details

```text
Flow:
  User creates invoice → clicks "Send Payment Link"
       → Edge function creates Stripe Payment Link
       → URL saved to payment_links table + project_invoices
       → User copies/sends URL to client
       → Client pays via Stripe
       → Stripe webhook fires checkout.session.completed
       → Webhook handler records payment in project_payments
       → Invoice balance auto-updates
```

- The `stripe-create-payment-link` edge function already handles Stripe customer creation from contacts
- We'll pass `invoice_id` and `pipeline_entry_id` in metadata so the webhook can route correctly
- Payment links are one-time use by default (Stripe handles this)

