

# Fix: Custom Setup Token System for 4-Hour Link Validity

## Problem
Supabase's OTP token expiry setting is not visible/configurable in your dashboard. The default is 1 hour, causing setup links to expire too quickly. This is a server-side constraint that can't be changed from code alone.

## Solution: Bypass Supabase OTP tokens entirely

Create a custom `setup_tokens` table with our own expiry (24 hours), and modify the setup flow to validate against this table instead of calling `supabase.auth.verifyOtp()`. Use `admin.updateUserById` (already proven in `admin-update-password`) to set the password server-side.

## Changes

### 1. Database Migration: Create `setup_tokens` table

```sql
CREATE TABLE public.setup_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_setup_tokens_token ON public.setup_tokens(token);
CREATE INDEX idx_setup_tokens_user ON public.setup_tokens(user_id);

ALTER TABLE public.setup_tokens ENABLE ROW LEVEL SECURITY;
-- No client-side access needed — only edge functions use service role
```

### 2. New Edge Function: `validate-setup-token`

Accepts `{ token, password }`. Validates token against `setup_tokens` table (not expired, not used). If valid, calls `admin.updateUserById` to set the password, marks token as used, and returns a session via `admin.generateLink({ type: 'magiclink' })` or signs the user in.

### 3. New Edge Function: `create-setup-token`

Called internally by existing invitation edge functions. Generates a crypto-random token, stores it in `setup_tokens` with 24-hour expiry, returns the token for URL construction.

### 4. Update All Invitation Edge Functions (7 files)

Replace `generateLink({ type: 'recovery' })` + `buildDirectSetupLink()` pattern with a call to insert into `setup_tokens` and build URL using our custom token:

```
https://pitch-1.lovable.app/setup-account?setup_token=<random>&type=setup
```

**Files to update:**
- `supabase/functions/create-company-user/index.ts`
- `supabase/functions/resend-user-invitation/index.ts`
- `supabase/functions/admin-create-user/index.ts`
- `supabase/functions/provision-tenant-owner/index.ts`
- `supabase/functions/seed-company-owners/index.ts`
- `supabase/functions/initialize-company/index.ts`
- `supabase/functions/send-user-invitation/index.ts` (update `linkExpirationHours` reference)

### 5. Update `SetupAccount.tsx`

Replace `verifyOtp()` flow with:
1. Read `setup_token` from URL params
2. Call `validate-setup-token` edge function with `{ token, password }`
3. Edge function validates, sets password, returns user info + session
4. Client signs in with returned session and proceeds to dashboard

The error/resend flow stays the same — `handleResendLink` already calls `resend-user-invitation` which will now generate a new custom token.

### 6. Update `_shared/email-config.ts`

Update `linkExpiration.passwordSetup` comment and `buildDirectSetupLink` to support the new token format. Keep backward compatibility for any existing links still using OTP tokens.

## Summary of Files Changed

| File | Change |
|---|---|
| New migration | Create `setup_tokens` table |
| New `validate-setup-token/index.ts` | Validate token + set password |
| 6 edge functions | Replace `generateLink` with custom token insert |
| `src/pages/SetupAccount.tsx` | Use custom token validation instead of `verifyOtp` |
| `supabase/config.toml` | Add `validate-setup-token` function config |

