

# Fix: Phone number normalization regex bug causing all calls to fail

## Root Cause

In `supabase/functions/_shared/phone.ts` line 17, the regex `/[^\\d+]/g` uses a double backslash inside a regex literal. In JavaScript regex literals, `\\d` means "literal backslash followed by d" — NOT the digit character class `\d`. This causes `normalizeE164("7708420812")` to strip all digits, returning an empty string, which fails E.164 validation.

Edge function logs confirm: `"Invalid or missing phone number undefined"`

## Fix

### `supabase/functions/_shared/phone.ts`
- Line 17: Change `/[^\\d+]/g` to `/[^\d+]/g`

This single character fix restores phone normalization, unblocking all outbound call flows (Quick Call, Power Dialer, KanbanCard calls).

