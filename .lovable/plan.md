

# Fix "Auth Session Missing" Password Reset Error

## Root Cause

There are two problems creating this failure:

1. **Supabase SMTP is broken** — The auth logs show repeated `535 Authentication credentials invalid` errors on the `/recover` endpoint. This means any code path using `supabase.auth.resetPasswordForEmail()` silently fails (no email is ever sent). Two places still use this broken path:
   - `EnhancedUserProfile.tsx` (Settings → "Send Password Reset")
   - `AuthTabs.tsx` (Login → Forgot Password tab)

2. **Session not established on reset page** — If a user does reach `/reset-password`, the page expects `access_token` and `refresh_token` as URL query parameters. But Supabase recovery redirects put tokens in the URL **hash fragment** (`#access_token=...`), not query params. So the page never finds the tokens, never establishes a session, and `supabase.auth.updateUser()` fails with "Auth session missing."

The Login page's forgot password flow already works correctly — it uses the custom `send-password-reset` edge function (which uses Resend) and routes through `/setup-account` via `buildDirectSetupLink`. But other entry points bypass this working path.

## Fix

### 1. `src/components/settings/EnhancedUserProfile.tsx`
Replace `supabase.auth.resetPasswordForEmail()` with a call to the `send-password-reset` edge function (same as the Login page does). This uses Resend instead of broken Supabase SMTP.

### 2. `src/features/auth/components/AuthTabs.tsx`
Same change — replace `supabase.auth.resetPasswordForEmail()` with the `send-password-reset` edge function call.

### 3. `src/pages/ResetPassword.tsx`
Add hash fragment parsing as a fallback. When `access_token` isn't found in query params, parse `window.location.hash` to extract tokens. This handles users who arrive via any Supabase-generated recovery link that uses hash fragments.

## Files Changed

| File | Change |
|------|--------|
| `src/components/settings/EnhancedUserProfile.tsx` | Use `send-password-reset` edge function instead of `resetPasswordForEmail` |
| `src/features/auth/components/AuthTabs.tsx` | Use `send-password-reset` edge function instead of `resetPasswordForEmail` |
| `src/pages/ResetPassword.tsx` | Add URL hash fragment parsing fallback for token extraction |

