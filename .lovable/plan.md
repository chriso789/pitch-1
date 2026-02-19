

# Fix: Signature Submission Failing Due to Invalid IP Address Format

## Root Cause

The edge function logs show the exact error:

```
invalid input syntax for type inet: "173.169.254.66,173.169.254.66, 3.2.51.244"
```

The `ip_address` column in `digital_signatures` is PostgreSQL type `inet`, which only accepts a **single** IP address. But the `X-Forwarded-For` header returns a comma-separated list of proxy IPs (e.g., `"173.169.254.66,173.169.254.66, 3.2.51.244"`). The `getClientInfo()` helper in `supabase/functions/_shared/utils.ts` returns this raw value without parsing it.

## Fix

**File: `supabase/functions/_shared/utils.ts`** (line 185)

Change the IP extraction to take only the **first** IP from the `X-Forwarded-For` header (which is the actual client IP):

```typescript
// Before:
const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

// After:
const forwardedFor = req.headers.get('x-forwarded-for');
const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (req.headers.get('x-real-ip') || 'unknown');
```

This is a one-line fix in the shared utility. Since `getClientInfo` is used by multiple edge functions, this fix applies globally.

**Redeploy:** `submit-signature` (and any other functions using this shared util).

## Expected Result

After this fix, the signature submission will:
1. Insert the signature record successfully with a valid single IP
2. Update the recipient status to "signed"
3. Trigger `finalize-envelope` (generates signed PDF, emails copies, saves to CRM)

