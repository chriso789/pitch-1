

## Batch: Customer Portal + Payments + ML Training

### Current State Assessment

**Already built and working:**
- `PaymentsTab` with invoice creation, manual payment recording, Stripe/Zelle link generation
- `customer-portal-access` edge function (token generation, validation, messaging, payment links)
- `CustomerPortalPublic.tsx` (506-line public portal page with status, messages, documents, payments)
- `ZellePaymentPage.tsx` and `zelle-payment-page` edge function
- `stripe-create-payment-link` and `stripe-webhook-handler` edge functions
- `payment_links` table with Stripe + Zelle support
- Public routes at `/customer/:token` and `/pay/:token`

**Missing / broken:**
1. No "Send Customer Portal Link" button anywhere in the UI (the edge function supports `generate` action, but no frontend calls it)
2. Customer portal payment section doesn't integrate with the new `project_invoices`/`project_payments` tables (uses old `payments` table)
3. No way to view/pay specific invoices in the customer portal
4. No portal link generation from Project/Lead details pages
5. ML training pipeline needs complete rebuild (data wiped from `/tmp`)

### Plan (5 Steps)

**Step 1 -- Add "Send Customer Portal Link" button to Lead/Project details**

In `src/components/lead-details/` or `ProfitCenterPanel.tsx`, add a button that:
- Calls `customer-portal-access` with `action: 'generate'`
- Shows the generated link with copy-to-clipboard
- Requires a `project_id` and `contact_id` (from the pipeline entry)

This is the critical missing piece -- users can create invoices but can't share a portal link with clients.

**Step 2 -- Update Customer Portal to show invoices + payment links**

Update `CustomerPortalPublic.tsx` and `customer-portal-access` edge function:
- Fetch `project_invoices` (not just `payments`) by `pipeline_entry_id`
- Show each invoice with amount, balance, status, and due date
- For unpaid invoices, show "Pay Now" buttons that link to existing Stripe/Zelle payment flows
- Show payment history from `project_payments`

**Step 3 -- Wire Stripe payment flow in customer portal**

Update the `customer-portal-access` edge function's `request_payment_link` action:
- Create Stripe checkout session for a specific invoice (using `project_invoices` amount)
- Store link in `payment_links` table with `invoice_id`
- Return URL to client portal so the "Pay Now" button works

**Step 4 -- ML Training Pipeline Rebuild**

- Re-export training dataset from Supabase `training_pairs` to persistent storage (`/mnt/documents/roof-training/`)
- Apply correct label scaling (area/10000, lengths/500, pitch/12)
- Apply correct loss weighting (seg=2.0, reg=0.5)
- Train RoofNetV3 for 5 epochs (CPU, within sandbox limits)
- Generate sample prediction visualization
- Split checkpoint for download

**Step 5 -- Verification**

- Test portal link generation from a lead/project page
- Test customer portal loads with invoices visible
- Verify Zelle/Stripe payment link buttons appear for unpaid invoices
- Verify ML checkpoint is saved and prediction image generated

### Files to Create/Edit

| File | Action |
|------|--------|
| `src/components/lead-details/CustomerPortalButton.tsx` | New -- button + dialog for generating/copying portal links |
| `src/components/estimates/ProfitCenterPanel.tsx` | Edit -- add CustomerPortalButton |
| `supabase/functions/customer-portal-access/index.ts` | Edit -- fetch `project_invoices` + `project_payments` in validate action |
| `src/pages/CustomerPortalPublic.tsx` | Edit -- render invoices, pay buttons, payment history from new tables |
| `ml/dataset_v2.py` | Edit -- fix scaling constants |
| `ml/loss_v2.py` | Edit -- fix loss weights |
| `/tmp/export_training_data.py` | New -- export script to persistent storage |
| `/tmp/train_and_predict.py` | New -- training + visualization script |

