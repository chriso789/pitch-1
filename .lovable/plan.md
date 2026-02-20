

# Fix: Signature Link "Unable to Load" for External Recipients

## Root Cause

The `PublicSignatureCapture` page directly queries the `signature_recipients` table using the Supabase client (anon key). However, the RLS policy on `signature_recipients` only allows access when `tenant_id = get_user_tenant_id()`. Since Chris is an external recipient with no Supabase auth session, `get_user_tenant_id()` returns null, the query returns zero rows, and the page shows "Invalid or expired signature link."

The `signer-open` edge function already exists and uses the service role key to bypass RLS -- it was designed for exactly this purpose. But `PublicSignatureCapture.tsx` never calls it; instead, it queries the database directly.

## Solution

Replace the direct database query in `PublicSignatureCapture.tsx` with a call to the existing `signer-open` edge function. This function:
- Validates the access token using the service role (bypasses RLS)
- Checks envelope status (expired, voided, completed, etc.)
- Marks the recipient as "viewed" on first open
- Notifies the sender
- Returns the envelope details and signature fields

Additionally, the `document_url` stored in the envelope is a **signed URL** with a 30-day expiry. While this won't be the immediate issue (it was just created), we should also ensure the edge function generates a fresh signed URL from the storage path if the stored URL has expired. This prevents future "unable to load" errors for documents accessed days later.

## Changes

### File: `src/pages/PublicSignatureCapture.tsx`

Replace the `loadEnvelope` function. Instead of:

```typescript
const { data: recipient, error: recipientError } = await supabase
  .from('signature_recipients')
  .select(`*, signature_envelopes(*)`)
  .eq('access_token', token)
  .single();
```

Use:

```typescript
const { data, error: fnError } = await supabase.functions.invoke('signer-open', {
  body: { access_token: token }
});

if (fnError || !data?.data) {
  setError('Invalid or expired signature link...');
  return;
}

const { envelope: envData, recipient: recipData } = data.data;
```

Then map `envData` and `recipData` into the existing `SignatureEnvelope` state shape.

### File: `supabase/functions/signer-open/index.ts`

Add fresh signed URL generation: if `envelope.document_url` contains a storage path (not a full URL) or if the signed URL's token is expired, regenerate a signed URL from the storage path. This ensures the PDF always loads regardless of when the link was first created.

## What This Fixes

- External recipients (unauthenticated users) can now open signature links
- PDF documents will always load with fresh signed URLs
- The existing `signer-open` edge function handles all validation, audit logging, and notifications -- no duplicate logic needed
- No RLS policy changes required (keeps security tight)
