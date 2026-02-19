
# Fix Signature Flow: Email Copies, CRM Storage, and SMS Notifications

## Root Cause Analysis

I investigated the most recent signed envelope (`8dc5fc7a`) and found:

### Finding 1: `submit-signature` edge function has WRONG column names
The code tries to insert into `digital_signatures` using columns that **do not exist** in the actual database:
- `signature_type` -- does NOT exist
- `image_url` -- does NOT exist
- `consent_text` -- does NOT exist
- `user_agent` -- does NOT exist
- `metadata` -- does NOT exist

**Actual columns:** `id, tenant_id, envelope_id, recipient_id, field_id, signature_data, signature_hash, signature_metadata, signed_at, ip_address, is_valid, created_at`

This means the deployed (old) version of submit-signature works differently from the current code. The old version likely sets the envelope to `completed` directly but **never calls `finalize-envelope`**.

### Finding 2: `finalize-envelope` has ZERO logs -- it was never called
This is why:
- `signed_pdf_path` is NULL on the completed envelope
- No completion email was sent to anyone
- No signed document was saved to the CRM documents tab

### Finding 3: `notify-signature-opened` has ZERO logs
The frontend call (`supabase.functions.invoke('notify-signature-opened')`) exists in the latest code but the **production site has NOT been published** with these changes. The old published site doesn't make this call.

### Finding 4: No "opened" event in signature_events
Only one event exists: `envelope_sent`. No `opened` event, confirming the notification was never triggered.

---

## Fix Plan

### 1. Fix `submit-signature` to match actual database schema

Rewrite the insert to use the correct columns:

```text
Before (broken):
  signature_type, signature_data, image_url, signature_hash,
  ip_address, user_agent, consent_text, metadata

After (correct):
  tenant_id, envelope_id, recipient_id, signature_data,
  signature_hash, signature_metadata, ip_address, is_valid
```

Store the signature image data in `signature_data`, and put extra info (type, consent, user agent) into `signature_metadata` JSONB.

Also upload the signature image to storage and store the path in `signature_metadata.image_path`.

### 2. Fix `submit-signature` to properly call `finalize-envelope`

After updating recipient status to `signed` and checking if all recipients signed, call `finalize-envelope` via direct `fetch` (not `supabase.functions.invoke`) with the service role key -- same pattern as the SMS fix.

### 3. Fix `finalize-envelope` to embed signature on the PDF

Currently it only adds a "Signature Certificate" page at the end. It should also attempt to draw the signature image on the last page of the actual estimate (the "signature block" area) before adding the certificate page.

The `finalize-envelope` function should:
- Download each signer's signature image from storage
- Draw it on the last page of the PDF at a designated position (bottom area, above the certificate)
- Then add the certificate page as it already does

### 4. Fix `finalize-envelope` to reliably email signed copies

The email block already exists but was never reached (function never ran). Once `submit-signature` properly calls it with the service role key, the flow will:
- Generate the signed PDF with signature embedded
- Upload to `documents` storage bucket
- Create a `documents` table record (saves to CRM for the lead)
- Email the signed copy to the homeowner AND the rep via Resend

### 5. Publish reminder

After deploying these fixes, the app **must be published** so the production site:
- Calls `notify-signature-opened` when the customer opens the signing page (SMS to rep)
- Uses the new `submit-signature` that triggers the full finalization flow

---

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/submit-signature/index.ts` | Fix column names to match actual schema; upload signature image to storage; call `finalize-envelope` via direct fetch with service role key |
| `supabase/functions/finalize-envelope/index.ts` | Embed signature image on the last page of the estimate PDF (signature block area) before adding certificate page; fix `signature_image_path` reference to use `signature_metadata` |

Both edge functions will be redeployed after changes.

---

## Expected Result After Fix + Publish

1. Customer clicks "Review and Sign" in email --> opens signing page --> **SMS sent to rep** ("Jason just opened their signature request")
2. Customer signs --> `submit-signature` stores signature correctly --> calls `finalize-envelope`
3. `finalize-envelope` downloads original PDF --> embeds signature image on the document --> adds certificate page --> uploads signed PDF --> saves document record to CRM (appears in Documents tab for the lead) --> emails signed copy to homeowner AND rep
