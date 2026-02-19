
# Signature Experience Overhaul: Layout, Notifications, Email Cleanup, and Company Domain

## 5 Changes

### 1. Side-by-Side Layout for Signing Page (PublicSignatureCapture.tsx)

Replace the current stacked vertical layout (small PDF preview on top, signature section below requiring scroll) with a side-by-side layout:

- **Left panel (~65% width):** Full-height PDF viewer with the estimate embedded at near-full width, plus a "Download PDF" button in the header
- **Right panel (~35% width):** Compact signing card (draw/type signature + submit button) -- always visible without scrolling
- On mobile, stack vertically but with a much taller PDF viewer (min 600px height instead of 400px)
- Remove the separate "Document Preview" card header to maximize viewing space

### 2. Remove "View Estimate PDF" Button from Email (email-signature-request)

Since the "Review & Sign Document" button already opens the signing page which embeds the full estimate, the separate "View Estimate PDF" link is redundant. Remove the entire `document_url` conditional block (lines 121-131) from the email HTML template. This makes the email cleaner with a single clear CTA.

### 3. SMS Notification to Rep When Customer Opens Signing Page (PublicSignatureCapture.tsx + new edge function call)

When `loadEnvelope` successfully loads the document (i.e., the customer clicked "Review & Sign"):

- Call a new lightweight edge function `notify-signature-opened` (or invoke `telnyx-send-sms` via the existing pattern from `track-quote-view`)
- The function looks up the envelope's `created_by` user, gets their phone number, and sends an SMS like: `"🔔 Jason Dudjak just opened their signature request for Quote #EST-001!"`
- Also log a `signature_events` entry with event_type `"opened"`
- Deduplicate: only send on the first open (check if an "opened" event already exists for this envelope)

### 4. Add Download Button to Signing Page

In the PDF header area of the signing page, add a download link/button using the `document_url`. This gives the customer a way to save the estimate locally without cluttering the email.

### 5. Send Signature Email from Company Domain, Not PITCH CRM (email-signature-request)

Currently the email uses `signatures@{RESEND_FROM_DOMAIN}` and falls back to "PITCH CRM" as the sender name. Instead, mirror the pattern from `send-quote-email`:

- Query `company_email_domains` for the tenant's verified domain
- Use the company's `from_email` / `from_name` if configured
- Fall back to `{tenantName} <signatures@{RESEND_FROM_DOMAIN}>` only if no company domain is set
- Update the footer from "Powered by PITCH CRM Signature System" to just the company name

---

## Technical Details

### Files Modified

| File | Changes |
|------|---------|
| `src/pages/PublicSignatureCapture.tsx` | Redesign to side-by-side layout; add download button; call notify endpoint on load |
| `supabase/functions/email-signature-request/index.ts` | Remove "View Estimate PDF" block; use `company_email_domains` for from address; clean footer |
| `supabase/functions/notify-signature-opened/index.ts` | **New** -- looks up envelope creator, sends SMS notification, logs event, deduplicates |

### New Edge Function: `notify-signature-opened`

```text
Input: { access_token: string }
Logic:
  1. Look up recipient by access_token
  2. Get envelope + created_by user
  3. Check signature_events for existing "opened" event for this envelope -- skip SMS if found
  4. Insert signature_events row (event_type: "opened")
  5. Get creator's phone from profiles
  6. Call telnyx-send-sms with notification message
  7. Return success (never block page load on failure)
```

### Layout Structure (PublicSignatureCapture.tsx)

```text
+--------------------------------------------------+
|  Header: Document Title          [Download PDF]   |
+--------------------------------------------------+
|                        |                          |
|   Full-width PDF       |   Your Signature         |
|   iframe/embed         |   [Draw] [Type]          |
|   (h-[calc(100vh-     |                          |
|     200px)])           |   [canvas / input]       |
|                        |                          |
|                        |   Printed Name: ____     |
|                        |                          |
|                        |   [Complete Signature]   |
|                        |                          |
+--------------------------------------------------+
```

### Company Domain Email Pattern (from send-quote-email)

```typescript
const { data: emailDomain } = await supabase
  .from("company_email_domains")
  .select("*")
  .eq("tenant_id", envelope.tenant_id)
  .eq("verification_status", "verified")
  .eq("is_active", true)
  .single();

const fromEmail = emailDomain?.from_email || `signatures@${fromDomain}`;
const fromName = emailDomain?.from_name || tenantName;
```
