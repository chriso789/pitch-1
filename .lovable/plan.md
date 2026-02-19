

# Fix: Signature Embedding, Status Update, and Data URL Leak (3 Root Causes)

## Problem Summary

Three distinct bugs are preventing the signature from appearing correctly on the signed PDF:

## Root Cause 1: Signature image treated as text (THE "data:image/png" LINE)

The database confirms the signature was saved with `signature_type: 'typed'` but `signature_data` is actually a full `data:image/png;base64,...` string (10,270 characters). Here's what happens:

1. **`submit-signature`** only uploads the image to storage for `drawn` or `uploaded` types (line 92). Since this one is `typed`, the upload is skipped and `image_path` stays `null`.
2. **`finalize-envelope`** checks `image_path` first (line 147) -- it's null, so it falls through to the `typed` branch (line 209).
3. The `typed` branch calls `drawText(sig.signature_data)` which prints the entire 10,270-character base64 string as literal text on the PDF page.

**Fix in `finalize-envelope/index.ts`:** Before the typed text branch, add a check: if `signature_data` starts with `data:image`, decode the base64 and embed it as a PNG image -- regardless of what `signature_type` says. This covers the case where the signature canvas produces image data even for "typed" signatures.

## Root Cause 2: Estimate status enum missing "signed"

The logs show:
```
Failed to update estimate status: invalid input value for enum estimate_status: "signed"
```

The `estimate_status` PostgreSQL enum only has: `draft, preview, sent, approved, rejected, expired`. There is no `signed` value.

**Fix:** Database migration to add `signed` to the enum.

## Root Cause 3: Signature position is hardcoded, not on the signature block

The current code places the signature at `y=120` from the bottom of the last page. The actual signature block on the estimate ("Customer Signature" + signature line + "Date: ___") is rendered as HTML content that gets captured into the PDF at whatever vertical position it ends up. The `y=120` coordinate is a rough guess that may not align with the actual signature block.

The signature block is a 2-column grid with "Customer Signature" on the left and "Company Representative" on the right, each with a horizontal line and date field. The signature image should be placed directly above the customer signature line.

**Fix:** Adjust the signature Y position to better target the signature block area. Since the signature block is at the very bottom of the terms/signature page content, position the signature higher (around `y=100-110`) and use coordinates that place it just above the signature line in the left column.

## Files to Change

### 1. `supabase/functions/finalize-envelope/index.ts` (lines 141-237)

Restructure the signature embedding logic with this priority order:

```
for each signature:
  1. If image_path exists in metadata -> download from storage, embed as image (existing code, works)
  2. NEW: Else if signature_data starts with "data:image" -> decode base64 inline, embed as PNG image
  3. Else -> drawText for truly plain-text typed signatures
  In all cases: draw signer name, date, IP below the signature
```

The new branch (case 2) will:
- Strip the `data:image/png;base64,` prefix
- Decode the base64 string to binary bytes
- Embed as PNG image using `pdfDoc.embedPng()`
- Draw at the same position as the image_path branch

Also fix in `submit-signature/index.ts`: upload the image to storage for ALL signature types when the data starts with `data:image`, not just for `drawn`/`uploaded`. This ensures `image_path` is set for future signatures regardless of type label.

### 2. Database migration: Add "signed" to estimate_status enum

```sql
ALTER TYPE estimate_status ADD VALUE IF NOT EXISTS 'signed';
```

### 3. `src/components/estimates/AttachmentPagesRenderer.tsx`

Add `color: 'transparent'` to the page container style as a final defensive layer so any leaked text from a previously-broken PDF is invisible.

## What This Fixes

- **Signature on PDF**: The actual signature image will be properly decoded from base64 and embedded as a real image on the signature block area -- no more raw text
- **Signer details**: Name, date, and IP will appear below the embedded signature image
- **Estimate status**: Will correctly update to "signed" in the database and reflect in the Saved Estimates list
- **Future-proofing**: `submit-signature` will upload images for all signature types, ensuring `image_path` is always available

