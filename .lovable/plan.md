
# Fix Signature Request Errors and Condense Share Dialog

## Problems Found

1. **Edge function crash**: The `email-signature-request` function inserts into `signature_events` using a column called `event_data` -- but the actual column is `event_metadata`. This causes a database error, which bubbles up as the "non-2xx status code" you're seeing.
2. **CC/BCC not forwarded**: The `email-signature-request` function doesn't accept or pass `cc`/`bcc` to the Resend API call, so even though `send-document-for-signature` sends them, they're ignored.
3. **Dialog not scrollable**: When CC/BCC is expanded, the dialog overflows the viewport and the Send button is hidden off-screen.
4. **Spacing too loose**: Fields have too much vertical padding, making the form unnecessarily tall.

## Changes

### 1. `supabase/functions/email-signature-request/index.ts`

- Fix the `signature_events` insert: rename `event_data` to `event_metadata` (line ~199)
- Add `cc` and `bcc` to the `RequestBody` interface (optional string arrays)
- Destructure `cc` and `bcc` from the request body
- Pass them to the Resend `fetch` call body so CC/BCC recipients get the signing email too

### 2. `src/components/estimates/ShareEstimateDialog.tsx`

- Add `max-h-[80vh] overflow-y-auto` to the DialogContent so the form scrolls when content exceeds viewport
- Reduce spacing from `space-y-4` to `space-y-3` on the form container
- Reduce textarea rows from 3 to 2
- Reduce the signature toggle section padding from `p-4` to `p-3`
- These changes keep all content visible and the buttons always reachable

## Result

- Signature requests will send successfully (no more edge function error)
- CC/BCC recipients will receive copies of the signing email
- The dialog will scroll properly and all buttons will be accessible regardless of how much content is shown
