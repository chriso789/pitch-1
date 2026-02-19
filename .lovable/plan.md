

# Fix: Signature Flow -- Link Estimate, Embed on Signature Block, Remove Extra Page, Fix Data URL Leak

## Issues Found

### 1. Estimate status never updates to "signed" (ROOT CAUSE)
The `send-document-for-signature` edge function only links `signature_envelope_id` back to `smart_doc_instances` (line 209), but when called from the Share Estimate dialog with `document_type: 'estimate'`, it never writes the envelope ID to `enhanced_estimates.signature_envelope_id`. So when `finalize-envelope` later tries to find the estimate via `signature_envelope_id`, it finds nothing and the status stays "draft".

**Fix:** Add an `else if (document_type === 'estimate')` block in `send-document-for-signature` that updates `enhanced_estimates.signature_envelope_id` for the given estimate.

### 2. Signature, date, and signer details should go on the signature block -- not a separate page
Currently `finalize-envelope` embeds the signature image on the last page at a fixed position (y=80), then creates an entirely separate "SIGNATURE CERTIFICATE" page. The user wants:
- Signature image placed directly on the signature block area
- Signer name and date printed below the signature
- The separate certificate page removed entirely

**Fix:** Modify `finalize-envelope` to:
- Draw the signer's name, date, and IP address as small text below the signature image on the last page (the signature block area)
- Remove the entire "STEP 2: Add Signature Certificate page" section (lines 201-338)

### 3. "data:image/png;base64,..." text leaking on screen
The attachment pages renderer converts PDF pages to base64 data URLs and renders them in `<img>` tags. The raw base64 string is overflowing its container and appearing as visible text. This happens because the page container uses `overflow: hidden` but the `<img>` alt text or a CSS rendering issue lets the URL text escape.

**Fix:** Add `overflow-hidden` to the image container, remove the data URL from the `alt` attribute (it's already not there, but the issue is likely the data URL being set as a text node somewhere), and ensure the image fills its container properly.

## Files to Change

### `supabase/functions/send-document-for-signature/index.ts`
- After line 214, add a new block:
```typescript
if (document_type === 'estimate') {
  await supabase
    .from("enhanced_estimates")
    .update({ signature_envelope_id: envelope.id })
    .eq("id", document_id);
}
```

### `supabase/functions/finalize-envelope/index.ts`
- **Enhance Step 1** (lines 127-199): After embedding the signature image, also draw signer name, signed date, and IP in small text below the signature
- **Remove Step 2** entirely (lines 201-338): Delete the certificate page generation code. The audit trail data (hash, timestamp, IP) is already stored in the database and in the completion email

### `src/components/estimates/AttachmentPagesRenderer.tsx`
- Add `overflow-hidden` and `text-indent: -9999px` or similar technique to prevent any text content from the data URL leaking visually
- Ensure the `<img>` element clips properly within its container

## What This Fixes

- **Estimate status**: Will correctly update from "draft" to "signed" after all recipients sign
- **Saved Estimates list**: Will reflect the signed status immediately
- **Signature placement**: Signature image + signer name + date appear directly on the estimate's signature block instead of a separate page
- **No extra page**: The separate "SIGNATURE CERTIFICATE" page is removed -- cleaner, more professional output
- **Data URL text**: The raw base64 string will no longer be visible on the estimate preview
- **Documents tab**: Signed PDF already saves correctly (confirmed working in logs)
- **Email**: Completion email already sends correctly (confirmed working in logs)
