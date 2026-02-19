

# Fix PDF Size, Add "Approve & Sign" Button, and Fix SMS Notification

## 1. Redesign Layout: Full-Screen PDF with Floating "Approve & Sign" Button

The current side-by-side layout gives the signature panel ~35% of the screen, making the PDF feel cramped. Instead:

- The PDF iframe will take up the **full viewport** (100% width, full height minus the thin header bar)
- A prominent **"Approve & Sign"** button sits in the top-right header bar
- Clicking it opens a **slide-over drawer** (from the right) containing the signature controls (draw/type, printed name, submit)
- The download button stays in the header alongside the Approve & Sign button
- On mobile, the drawer takes full width

Layout:
```text
+----------------------------------------------------------+
|  [doc icon] Tile & Mortar Repair   [Download] [Approve & Sign] |
+----------------------------------------------------------+
|                                                          |
|              Full-screen PDF viewer                      |
|              (100% width, calc(100vh - 57px))            |
|                                                          |
|                                                          |
+----------------------------------------------------------+
```

When "Approve & Sign" is clicked, a right-side drawer slides in with the signature form, overlaying the PDF.

### File: `src/pages/PublicSignatureCapture.tsx`

- Remove the `flex-col lg:flex-row` split layout
- Make the PDF iframe take full width/height
- Add a `Sheet` (vaul drawer from shadcn) triggered by the "Approve & Sign" button
- Move all signature controls (draw/type toggle, canvas, typed name input, printed name, legal notice, submit button) inside the Sheet content
- The Sheet opens from the right side on desktop, bottom on mobile

## 2. Fix SMS Notification: Pass `tenant_id` and `sent_by`

The `notify-signature-opened` function calls `telnyx-send-sms` via `supabase.functions.invoke` without passing `tenant_id` or `sent_by`. The SMS function needs these to look up the correct outbound phone number for the company.

### File: `supabase/functions/notify-signature-opened/index.ts`

- Switch from `supabase.functions.invoke` to a direct `fetch` call (same pattern as `track-quote-view`)
- Pass `tenant_id` from the envelope and `sent_by` as the envelope's `created_by`
- Use the service role key in the Authorization header so `telnyx-send-sms` recognizes it as a service-to-service call

Change from:
```typescript
await supabase.functions.invoke("telnyx-send-sms", {
  body: { to: creatorProfile.phone, message, skipAuth: true }
});
```

To:
```typescript
await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    to: creatorProfile.phone,
    message,
    tenant_id: envelope.tenant_id,
    sent_by: envelope.created_by,
  })
});
```

## Files Changed

| File | Change |
|------|--------|
| `src/pages/PublicSignatureCapture.tsx` | Full-screen PDF layout with floating "Approve & Sign" button that opens a Sheet/drawer for signature capture |
| `supabase/functions/notify-signature-opened/index.ts` | Fix SMS by using direct fetch with `tenant_id` and `sent_by` params |

## Result

- PDF takes up ~95% of the viewport -- full immersive viewing experience
- "Approve & Sign" button is always visible in the top-right corner, no scrolling needed
- Clicking it opens a clean drawer with signature controls overlaying the PDF
- SMS notification actually sends to the rep when the customer opens the signing page
