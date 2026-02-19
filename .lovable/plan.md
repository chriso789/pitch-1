

# Fix: Finalize-Envelope Crashing After Signature (3 Errors)

The live edge function logs show exactly why the signed document is never generated, emailed, or saved back to the CRM. The `finalize-envelope` function crashes due to 3 separate errors, all of which must be fixed together.

## Error 1: Unicode character crash (CRITICAL)

```
Error: WinAnsi cannot encode "✓" (0x2713)
```

**Line 308** of `finalize-envelope/index.ts` uses a checkmark `✓` in a drawText call. The `pdf-lib` standard fonts (Helvetica) only support WinAnsi characters and cannot render Unicode symbols.

**Fix:** Replace `✓` with a plain ASCII alternative like `[X]` or `*`.

```
// Line 308 — before:
certPage.drawText(`✓ "${consentText}"`, { ... });

// After:
certPage.drawText(`[X] "${consentText}"`, { ... });
```

## Error 2: Missing `final_pdf_hash` column (CRITICAL)

```
Could not find the 'final_pdf_hash' column of 'signature_envelopes'
```

The envelope update on **line 409** tries to write `final_pdf_hash` but that column does not exist on `signature_envelopes`. This causes a 500 error and kills the entire function — nothing after this runs (no document record, no estimate update, no emails).

**Fix:** Database migration to add the column, OR remove `final_pdf_hash` from the update and store it in `metadata` or skip it. Adding the column is cleaner since the code also reads it later.

**Migration:**
```sql
ALTER TABLE signature_envelopes 
ADD COLUMN IF NOT EXISTS final_pdf_hash TEXT;
```

**No code change needed** — the existing code on lines 404-412 will work once the column exists.

## Error 3: Notification type check constraint (NON-BLOCKING but noisy)

```
new row for relation "user_notifications" violates check constraint "user_notifications_type_check"
```

The `user_notifications` table has a CHECK constraint limiting `type` to only: `rank_change`, `achievement_unlock`, `prize_zone`, `reward_ready`. The signature system passes `signature_received` and `envelope_completed` which are rejected.

**Fix:** Alter the check constraint to include the signature types.

**Migration:**
```sql
ALTER TABLE user_notifications DROP CONSTRAINT user_notifications_type_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_type_check 
  CHECK (type = ANY (ARRAY[
    'rank_change', 'achievement_unlock', 'prize_zone', 'reward_ready',
    'signature_received', 'envelope_completed', 'envelope_viewed'
  ]));
```

## Summary of Changes

| File / Resource | Change |
|---|---|
| **Database migration** | Add `final_pdf_hash` column to `signature_envelopes`; expand `user_notifications` type check constraint |
| **`supabase/functions/finalize-envelope/index.ts`** | Line 308: replace `✓` with `[X]` to avoid WinAnsi encoding crash |

## What This Fixes

Once all 3 errors are resolved, the finalize-envelope function will run to completion, which means:
- Signed PDF with embedded signature + certificate page is generated and uploaded
- Document record is created in the Documents tab
- Estimate status is updated to "signed" in Saved Estimates
- Completion email with download link is sent to the client and the sales rep
- In-app notifications are created without constraint violations

