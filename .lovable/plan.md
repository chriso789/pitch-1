

# Show the Estimate in the Signature Email and Signing Page

## Problem

When a customer receives a signature request email, they only see a generic "Review & Sign Document" button. The actual estimate PDF is never shown -- not in the email and not on the signing page. Two gaps cause this:

1. The `email-signature-request` function receives a `document_url` parameter but the email template ignores it entirely -- no PDF link or preview is included.
2. The `PublicSignatureCapture` signing page tries to show the PDF from `envelope.document_url`, but that column does not exist on the `signature_envelopes` table. The actual field is `generated_pdf_path`, and the signed URL is only generated at send time but never stored.

## Solution

### 1. Store the signed document URL on the envelope

In `supabase/functions/send-document-for-signature/index.ts`, after generating the 30-day signed URL (line ~147), save it back to the envelope record so the signing page can retrieve it later. We will add a `document_url` column to `signature_envelopes` to hold this.

**Database migration:**
```sql
ALTER TABLE signature_envelopes ADD COLUMN IF NOT EXISTS document_url TEXT;
```

Then after the envelope is created (line ~170), update it:
```typescript
if (documentUrl) {
  await supabase
    .from("signature_envelopes")
    .update({ document_url: documentUrl })
    .eq("id", envelope.id);
}
```

### 2. Add PDF link/preview to the signature request email

In `supabase/functions/email-signature-request/index.ts`, use the `document_url` from the request body to add a "View Estimate" button or embedded PDF link in the email, placed between the personal message and the signing CTA button. This gives the homeowner a way to review the estimate before signing.

Add a section like:
```html
<!-- Document Preview Link -->
${document_url ? `
<div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px 20px; margin: 24px 0; text-align: center;">
  <p style="margin: 0 0 12px; color: #0c4a6e; font-size: 14px; font-weight: 600;">
    📄 View the attached estimate before signing
  </p>
  <a href="${document_url}" style="display: inline-block; background-color: #ffffff; color: ${primaryColor}; text-decoration: none; padding: 10px 24px; font-size: 14px; font-weight: 500; border-radius: 6px; border: 1px solid ${primaryColor};">
    View Estimate PDF
  </a>
</div>
` : ''}
```

### 3. Fix the signing page to read the correct field

In `src/pages/PublicSignatureCapture.tsx`, update the `loadEnvelope` function to read `document_url` from the envelope data (which will now exist after the migration). The existing iframe preview code at line 374-389 already handles displaying it -- it just needs the data to be present.

Currently:
```typescript
document_url: (recipient.signature_envelopes as any).document_url,
```
This will now work because the column exists on the table.

## Files Changed

| File | Change |
|------|--------|
| Database migration | Add `document_url` column to `signature_envelopes` |
| `supabase/functions/send-document-for-signature/index.ts` | Save signed URL to new `document_url` column on envelope |
| `supabase/functions/email-signature-request/index.ts` | Add "View Estimate PDF" section to email HTML using the `document_url` parameter |
| `src/pages/PublicSignatureCapture.tsx` | No changes needed -- already reads `document_url` from envelope |

## Result

- Homeowners receive an email with a "View Estimate PDF" link so they can review the full estimate
- The signing page shows an embedded PDF preview above the signature box
- The complete flow: open email, view estimate, sign -- all in one experience
