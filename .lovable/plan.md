

# Fix Subject Line, Deploy Signing Page Layout, and Fix SMS Notification

## 3 Issues Found

### Issue 1: "Please sign:" keeps appearing in subject/title
**Root cause:** Two places add the "Please sign:" prefix as a fallback:
- `ShareEstimateDialog.tsx` line 136: when the user leaves subject blank, it falls back to `"Please sign: Tile & Mortar Repair"`
- `send-document-for-signature/index.ts` line 118: same pattern as a second fallback

This `documentTitle` becomes the envelope's `title` (stored in the database), and also the email subject. So even if the user types a custom subject, if they leave it blank, the prefix gets added. The fix: use just the estimate display name without "Please sign:" as the fallback.

### Issue 2: Document preview still shows old small layout
**Root cause:** The code in `PublicSignatureCapture.tsx` IS already updated with the full-screen layout and "Approve & Sign" button. However, the user's screenshot is from `pitch-crm.ai` (the published/production domain). The latest code changes have not been published yet -- the production site still runs the old card-based layout.

**Action needed:** Publish the app after these fixes. But I'll also verify the layout code is optimal.

### Issue 3: No SMS text to the rep when customer opens signing page
**Root cause:** The `notify-signature-opened` edge function has zero logs -- it was never invoked. The function call lives in the frontend code (`PublicSignatureCapture.tsx` line 59), but the published site has the OLD frontend code that doesn't include this call. Once published, the new code will invoke it.

I'll also verify the function is correctly deployed.

---

## Changes

### 1. Remove "Please sign:" prefix (`ShareEstimateDialog.tsx`)

Line 136 -- change the fallback from:
```
email_subject: subject.trim() || `Please sign: ${estimateDisplayName || estimateNumber || 'Estimate'}`,
```
To:
```
email_subject: subject.trim() || estimateDisplayName || estimateNumber || 'Estimate',
```

### 2. Remove "Please sign:" prefix (`send-document-for-signature/index.ts`)

Lines 85, 101, 118 -- remove "Please sign:" from all fallbacks:
- Line 85: `"Please sign this document"` becomes `"Document Signature Request"`
- Line 101: `"Please sign: ${data.title}"` becomes just `data.title || 'Document'`
- Line 118: `"Please sign: ${data.display_name}"` becomes just `data.display_name || data.estimate_number || 'Estimate'`

### 3. Re-deploy `notify-signature-opened` edge function

Verify it's deployed and accessible so the SMS fires when the customer opens the signing page.

### 4. Publish reminder

After these changes, the app must be **published** so the production site (`pitch-crm.ai`) picks up the new full-screen layout, the "Approve & Sign" button, and the SMS notification call.

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/estimates/ShareEstimateDialog.tsx` | Remove "Please sign:" from subject fallback |
| `supabase/functions/send-document-for-signature/index.ts` | Remove "Please sign:" from all documentTitle fallbacks |
| Edge function deployment | Re-deploy `notify-signature-opened` to ensure it's live |

## After Implementation

You will need to **publish** the app for the changes to appear on `pitch-crm.ai`. The signing page layout, SMS notification, and subject fix all depend on the published code being up to date.

