# Lock Down QXO Credentials (Audit Finding #1)

## Problem
`qxo_connections` currently stores `username`, `password`, `client_id`, `access_token`, and `refresh_token` in a row that any authenticated tenant member can `SELECT *` on. `QXOConnectionSettings.tsx` does exactly that and hydrates the password back into a controlled `<Input type="password">`, exposing the cleartext password to the browser on every page load.

## Goal
- No SMS / OAuth / API credentials ever reach the browser again.
- Existing edge functions (`qxo-api-proxy`, `qxo-sync-orchestrator`, `qxo-push-order`, `_shared/qxo-auth.ts`) keep working with no behavior change.
- Existing UI keeps functioning: save credentials, test connection, show connected/disconnected, disconnect.

## Architecture

```text
Browser (UI)
  └── invoke('qxo-save-credentials')  ──► service role ──► qxo_credentials  (NO RLS policies = client-blocked)
                                                          (username, password, client_id,
                                                           access_token, refresh_token, token_expires_at)

Browser (UI)
  └── select() from qxo_connections   ──► RLS allows tenant ──► qxo_connections (non-sensitive only)
                                                                (tenant_id, site_id, account_id,
                                                                 profile_id, default_branch_code,
                                                                 connection_status, last_validated_at,
                                                                 last_error, environment, valid_indicator,
                                                                 has_credentials boolean)

Edge functions
  └── service role joins both tables to obtain BeaconAuth
```

## Implementation steps

### 1. DB migration
- Create `public.qxo_credentials` (1:1 with `qxo_connections` via `tenant_id` UNIQUE).
  - Columns: `id`, `tenant_id`, `username`, `password`, `client_id`, `access_token`, `refresh_token`, `token_expires_at`, `created_at`, `updated_at`.
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and **define no policies** → only service role can read/write.
- Backfill: `INSERT INTO qxo_credentials SELECT … FROM qxo_connections WHERE username IS NOT NULL OR access_token IS NOT NULL`.
- Add `has_credentials BOOLEAN NOT NULL DEFAULT false` to `qxo_connections`; update from backfill.
- Drop sensitive columns from `qxo_connections`: `username`, `password`, `client_id`, `access_token`, `refresh_token`, `token_expires_at`.
- Add `update_updated_at` trigger on `qxo_credentials`.

### 2. New edge function `qxo-save-credentials`
- Validates caller JWT, resolves `tenant_id` they belong to, requires tenant admin/manager.
- Upserts into `qxo_credentials` using `SUPABASE_SERVICE_ROLE_KEY`.
- Upserts non-sensitive fields (`site_id`, `environment`, `has_credentials=true`, `connection_status='disconnected'`) into `qxo_connections`.
- Never returns secrets in the response.

### 3. Update `_shared/qxo-auth.ts`
- Load both rows by `tenant_id`. Use service-role client to read `qxo_credentials`.
- Persist refreshed `access_token`/`refresh_token`/`token_expires_at` to `qxo_credentials`, not `qxo_connections`.
- Persist status fields (`connection_status`, `last_validated_at`, `last_error`, `valid_indicator`) to `qxo_connections` as before.

### 4. Touch-up other functions
- `qxo-api-proxy`, `qxo-sync-orchestrator`, `qxo-push-order`: replace any `.from('qxo_connections').select('*')` reads of secret fields with the shared helper. (The mirror writes in `qxo-sync-orchestrator` need to split: tokens → `qxo_credentials`, status → `qxo_connections`.)

### 5. UI changes (`QXOConnectionSettings.tsx`)
- Remove `username`/`password`/`client_id` from the loaded `QXOConnection` interface and stop hydrating them.
- Show "Credentials on file" vs "No credentials saved" based on `has_credentials`.
- Password / username / client_id inputs start blank; on save call `supabase.functions.invoke('qxo-save-credentials', …)` instead of writing the table directly.
- Disconnect calls the same edge function with `{ clear: true }` to wipe `qxo_credentials` and set `connection_status='disconnected'`.

### 6. Verification
- `bun run build` clean.
- Manually round-trip Save → Test Connection on staging tenant.
- Confirm `select * from qxo_connections` as a logged-in user returns no secret columns (they no longer exist).

## Out of scope (later audit items)
- Shared `qxoFetch` http client / retry-backoff (#2)
- Base-URL standardization (#3)
- API-version unification (#4)
- Removing hardcoded site defaults (#5)
- CI test suite + OpenAPI artifact (#6, #7)
- Deprecating cookie auth path (#8)
