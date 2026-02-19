
# Add CC and BCC Fields to Share Estimate Dialog

## What This Does

Adds optional CC and BCC email fields to the Share Estimate dialog so you can copy additional people (insurance adjusters, project managers, office staff, etc.) when sending quotes.

## Changes

### 1. `src/components/estimates/ShareEstimateDialog.tsx`

- Add two new state variables: `ccEmails` (string) and `bccEmails` (string)
- Add a collapsible "CC / BCC" section below the Recipient Email field (toggled by a small "Add CC/BCC" link to keep the dialog clean by default)
- CC field: comma-separated emails
- BCC field: comma-separated emails
- Parse both fields into arrays before sending
- Pass `cc` and `bcc` arrays to the `send-quote-email` edge function body
- Also pass them to `send-document-for-signature` when signature mode is active
- Reset both fields when dialog opens

### 2. `supabase/functions/send-quote-email/index.ts`

- Add `cc` and `bcc` optional fields to the `SendQuoteEmailRequest` interface
- Pass `cc` and `bcc` arrays to the `resend.emails.send()` call (Resend API natively supports both)
- Log CC/BCC in communication history metadata

### 3. `supabase/functions/send-document-for-signature/index.ts`

- Accept optional `cc` and `bcc` arrays in the request body
- Forward them to the Resend email send call when dispatching the signing link email

## UI Layout (inside dialog)

```text
Recipient Name     [___________________]
Recipient Email    [___________________]
                   + Add CC/BCC          <-- small text link

  (when expanded:)
  CC               [___________________]
  BCC              [___________________]
  Separate multiple emails with commas

Subject (optional) [___________________]
Personal Message   [___________________]
```

## Validation

- Each email in CC/BCC is validated with the same regex used for the primary recipient
- Empty CC/BCC fields are simply omitted from the API call
- Invalid emails show a toast error specifying which field has the issue
