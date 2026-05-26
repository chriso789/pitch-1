## Fix

Single file: `supabase/functions/qbo-oauth-connect/index.ts`.

Add a service-role client used **only** for `qbo_connections` writes, after the existing auth + role gates pass. RLS policies stay untouched.

### Changes

1. **Import unchanged** — `createClient` from `@supabase/supabase-js` is already used.

2. **Keep user-scoped client** (`supabase`, bound to caller JWT) for:
   - `auth.getUser()`
   - profile lookup (`tenant_id`, `role`)
   - role gate (`master | owner | office_admin | corporate`)
   - any read of `qbo_connections` used to drive UI status

3. **After auth + role gate succeed**, instantiate once per request:
   ```ts
   const adminClient = createClient(
     Deno.env.get("SUPABASE_URL") ?? "",
     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
   );
   ```

4. **Swap `supabase` → `adminClient` only on these three write paths**:
   - `callback`: `qbo_connections.upsert({...})` — `tenant_id` sourced from the authenticated profile, never from the request body. Keeps `scopes` array fix and `is_sandbox` field.
   - `refresh`: `qbo_connections.update({ access_token, refresh_token, token_expires_at, ... }).eq('tenant_id', profile.tenant_id).eq('id', connectionId)` (or `realm_id`).
   - `disconnect`: `qbo_connections.update({ is_active: false, disconnected_at: new Date().toISOString() }).eq('tenant_id', profile.tenant_id).eq('id', connectionId)`.

5. **Preserve**: scopes split-to-array, `is_sandbox` column write, per-connection sandbox vs production Intuit host selection.

6. **Response envelope**:
   - Success (callback):
     ```json
     { "success": true, "connected": true, "realm_id": "...", "company_name": "...", "is_sandbox": false }
     ```
   - Write failure (any of the three paths) → HTTP 500:
     ```json
     { "success": false, "error": "qbo_connection_write_failed", "details": "<error.message>" }
     ```

7. **Logging** (`console.log` / `console.error`):
   - Log: `action`, `tenant_id`, `realm_id`, `is_sandbox`, write `error?.code` / `error?.message`, success boolean.
   - Never log: `access_token`, `refresh_token`, `client_secret`, OAuth `code`, PKCE `verifier`, `id_token`.

### Out of scope (explicit)

- No changes to `qbo_connections` RLS or new INSERT/UPDATE/DELETE policies.
- No frontend popup/callback changes.
- No Intuit app or redirect URI changes.
- No edits to the prior `scopes` array fix or the `is_sandbox` migration.

### Verification

1. Click **Connect to QuickBooks** from `/settings`.
2. Complete Intuit login; popup closes, toast "Connected to QuickBooks", card flips to Connected with company name.
3. Edge function logs show no `42501`; show `action=callback`, `tenant_id`, `realm_id`, `is_sandbox`, success.
4. `select id, tenant_id, qbo_company_name, is_active, is_sandbox from qbo_connections` returns the new row.
5. Disconnect flips `is_active=false`, sets `disconnected_at`, no `42501`.
6. Token refresh (manual trigger or scheduled) updates token fields, no `42501`.
7. No token strings present anywhere in edge logs.
