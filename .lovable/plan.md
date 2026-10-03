# Branded Invoice Email and Viewer

## What will change

- Redesign invoice emails with stronger company branding, clearer amount and due-date hierarchy, a polished invoice summary, and a prominent action button.
- Replace the customer-facing Supabase PDF link with a branded `pitch-crm.ai/invoice/...` link.
- Add a public Pitch CRM invoice viewer that keeps the branded address visible while securely loading the current PDF and offering view/download actions.
- Preserve invoice open/click receipts and first-open notifications through the branded viewer.
- Keep the existing project email prefill and multi-recipient sending behavior unchanged.

## Customer experience

1. The customer receives a more professional invoice email from the contractor.
2. “View invoice” opens a contractor-branded page on Pitch CRM.
3. The invoice PDF displays inside that page instead of navigating to a Supabase address.
4. The customer can download or print the invoice from the branded page.

## Technical details

- Use the official production origin `https://pitch-crm.ai` for all emailed invoice links.
- Validate the opaque delivery identifier server-side, issue only short-lived PDF access, and avoid exposing permanent storage URLs.
- Move the touched legacy invoice email/tracking handlers into the grouped email service, leaving compatibility shims for existing links and callers.
- Add the public invoice route to the existing lazy-loaded public routing structure.
- Verify the email HTML at desktop/mobile widths, the branded viewer, tracking events, build health, and edge-function consolidation audit counts.
