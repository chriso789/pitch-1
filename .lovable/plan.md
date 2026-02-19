

# Add "Request Signature" to Estimate Sharing Flow

## What This Does

When you share an estimate with a homeowner, you'll now have the option to also request their digital signature. The homeowner receives an email with a link to view the estimate and sign it digitally -- no printing, scanning, or emailing back needed. You'll get notified when they sign, and the signed document is stored in the system.

## How It Works

1. When you click **Share** on an estimate, the dialog now shows a **"Request Signature"** toggle
2. When enabled, the homeowner receives an email with a signing link instead of just a view link
3. The homeowner clicks the link, reviews the estimate PDF, and draws or types their signature
4. Once signed, the system records the signature, updates the estimate status, and notifies you

## Technical Changes

### 1. Update `ShareEstimateDialog` to include signature request option

**File:** `src/components/estimates/ShareEstimateDialog.tsx`

- Add a `Switch` toggle labeled "Request Digital Signature" below the message field
- When toggled on, show a note: "Homeowner will receive a signing link to digitally sign the estimate"
- On send: if signature is requested, call `send-document-for-signature` edge function (with `document_type: 'estimate'`) in addition to (or instead of) the regular `send-quote-email`
- Pass the `estimateId` as `document_id` to create a signature envelope
- Add new props: `estimateDisplayName` for the envelope title

### 2. Update `send-document-for-signature` edge function to handle estimates better

**File:** `supabase/functions/send-document-for-signature/index.ts`

- The function already supports `document_type: 'estimate'` but queries the `estimates` table (which may not exist as `enhanced_estimates` is the actual table)
- Update the estimate lookup to query `enhanced_estimates` instead
- Use the estimate's stored `pdf_url` to get the document URL from storage (generate a signed URL)
- Set the envelope title from the estimate number/display name

### 3. Update `PublicSignatureCapture` to show estimate PDF

**File:** `src/pages/PublicSignatureCapture.tsx`

- The page already supports `document_url` via the envelope -- it renders an iframe preview
- Ensure the PDF URL is a valid signed URL so the homeowner can view the full estimate before signing
- No major changes needed here; the existing flow handles it

### 4. Add signature status indicator on estimate

**File:** `src/components/estimates/SavedEstimatesList.tsx`

- Show a badge on estimates that have a pending or completed signature envelope
- Display "Awaiting Signature", "Signed", etc. next to the estimate in the list

## Flow Diagram

```text
Contractor                          System                          Homeowner
    |                                 |                                |
    |-- Click "Share" on estimate --> |                                |
    |   [x] Request Signature toggle  |                                |
    |-- Click "Send Quote" ---------> |                                |
    |                                 |-- Generate/upload PDF -------> |
    |                                 |-- Create signature envelope -> |
    |                                 |-- Create recipient + token --> |
    |                                 |-- Send email with sign link -> |
    |                                 |                                |
    |                                 |          Homeowner clicks link |
    |                                 |<-- Load /sign/:token ---------|
    |                                 |-- Return PDF + sign fields --> |
    |                                 |                                |
    |                                 |     Homeowner draws signature  |
    |                                 |<-- Submit signature -----------|
    |                                 |-- Store digital signature ---> |
    |                                 |-- Update envelope status ----> |
    |<-- Notification: "Signed!" ---- |                                |
    |                                 |                                |
```

## Files Modified

| File | Change |
|------|--------|
| `src/components/estimates/ShareEstimateDialog.tsx` | Add "Request Signature" toggle; call signature edge function when enabled |
| `supabase/functions/send-document-for-signature/index.ts` | Fix estimate table lookup (`enhanced_estimates`); generate signed PDF URL |
| `src/components/estimates/SavedEstimatesList.tsx` | Show signature status badge on estimates |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Pass `estimateDisplayName` prop to ShareEstimateDialog |

