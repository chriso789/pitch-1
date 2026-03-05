

# Fix Role Update Edge Function Error

## Root Cause

The edge function logs show the exact error:

```
Could not find the 'updated_at' column of 'user_roles' in the schema cache
```

The `user_roles` table only has columns: `id`, `user_id`, `tenant_id`, `created_at`, `created_by`, `role`. There is no `updated_at` column, but the edge function tries to upsert with `updated_at: new Date().toISOString()`.

Additionally, the page gets stuck on "Loading profile..." after save because the role update fails silently (returns 500), but the profile save succeeds and triggers a reload -- the reload then hangs or shows stale data.

A secondary concern: `verify_jwt = true` in config.toml can cause issues on Lovable Cloud due to ES256 token signing. The function already validates the JWT in code via `getUser()`, so gateway verification is redundant.

## Fix

### 1. Edge Function: Remove `updated_at` from upsert (supabase/functions/update-user-role/index.ts)

**Line 139-148**: Remove `updated_at` from the upsert payload:

```typescript
const { error: roleUpdateError } = await supabaseAdmin
  .from('user_roles')
  .upsert({
    user_id: userId,
    role: newRole,
    tenant_id: effectiveTenantId
  }, {
    onConflict: 'user_id,tenant_id'
  });
```

### 2. Update CORS headers to include all Supabase client headers (same file, line 4-5)

```typescript
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
```

### 3. Config: Set `verify_jwt = false` for update-user-role (supabase/config.toml)

Since the function already validates JWT in code via `getUser()`, disable gateway verification to prevent ES256 token issues:

```toml
[functions.update-user-role]
verify_jwt = false
```

### 4. Redeploy the edge function

These three changes fix the 500 error and ensure role updates persist immediately.

