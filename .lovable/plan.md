

# Fix Signature Submission Error and Preview Close Buttons

## Issue 1: "Failed to submit signature" Error

**Root cause confirmed from edge function logs:**
```
ERROR: column signature_recipients.name does not exist
```

In `supabase/functions/submit-signature/index.ts` line 57, the query selects `name` and `email`:
```typescript
.select('id, envelope_id, name, email, status, tenant_id')
```

But the actual database columns are `recipient_name` and `recipient_email`. The function crashes before it even reaches the signature insert logic.

**Fix:** Change line 57 to:
```typescript
.select('id, envelope_id, recipient_name, recipient_email, status, tenant_id')
```

Then update all references in the file from `recipient.name` to `recipient.recipient_name` and `recipient.email` to `recipient.recipient_email` (used in the notification message on line 176).

---

## Issue 2: Close Buttons Not Working on Preview Estimate

**Root cause:** The Dialog uses `p-0` and `overflow-hidden` on `DialogContent`. The built-in Radix close icon (the X button at `right-4 top-4`) is positioned absolute but gets clipped or overlapped by the custom `DialogHeader` which has its own padding and border. The user's screenshot shows the X icon is visible but unresponsive -- this happens because the header's `flex` container sits on top of it, blocking pointer events.

**Fix:**
- Give the Radix built-in close icon a higher `z-index` so it's above the header content, OR hide it entirely and rely on the custom "Close Preview" button which already calls `onOpenChange(false)`.
- Ensure the custom "Close Preview" button has `position: relative` and a `z-index` above overlapping elements.
- Best approach: add `z-50` to the Radix close button by customizing the DialogContent for this specific dialog, and ensure the "Close Preview" button has `relative z-10`.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/submit-signature/index.ts` | Fix column names: `name` to `recipient_name`, `email` to `recipient_email` |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Fix close button z-index so both the X icon and "Close Preview" button are clickable above the content |

## After Fix

- Signature submission will succeed -- the homeowner can sign, the PDF will be generated and emailed
- Both close buttons on the preview dialog will respond to clicks
- Edge function will be redeployed automatically
