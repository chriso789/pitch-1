# QBO Full Split: Per-Connection Environment Routing

Architect QBO integration so each `qbo_connections` row carries its own environment, and every API call (OAuth token exchange, refresh, revoke, accounting REST, webhook verification) selects credentials + host + verifier from that connection — not from a single global env var.

## 1. Secrets (add via `add_secret`)

New:

- `QBO_CLIENT_ID_DEVELOPMENT`
- `QBO_CLIENT_SECRET_DEVELOPMENT`
- `QBO_WEBHOOK_VERIFIER_DEVELOPMENT`
- `QBO_CLIENT_ID_PRODUCTION`
- `QBO_CLIENT_SECRET_PRODUCTION`
- `QBO_WEBHOOK_VERIFIER_PRODUCTION`
- `QBO_REDIRECT_URI_DEVELOPMENT` (optional; falls back to `QBO_REDIRECT_URI`)
- `QBO_REDIRECT_URI_PRODUCTION` (optional; falls back to `QBO_REDIRECT_URI`)
- `QBO_DEFAULT_ENVIRONMENT` (`development` | `production`) — used only when creating a NEW connection where the OAuth initiator did not specify an env

Legacy kept as fallback (for backwards compat only): `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_WEBHOOK_VERIFIER_TOKEN`, `QBO_ENVIRONMENT`, `QBO_REDIRECT_URI`.

## 2. Schema migration

Add to `public.qbo_connections`:

- `oauth_app_env text` — `'development' | 'production'`, canonical environment marker for this connection
- backfill: `oauth_app_env = case when is_sandbox then 'development' else 'production' end`
- add CHECK constraint on the two values
- keep `is_sandbox` as a generated/synced column for backwards compatibility (or keep both and keep them in sync at write time)
- `NOTIFY pgrst, 'reload schema';`

No new columns for tokens, no encryption change in this pass.

## 3. New shared helper: `supabase/functions/_shared/qbo-context.ts`

Exports:

```ts
type QboMode = "development" | "production";

type QboContext = {
  mode: QboMode;
  accountingBaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webhookVerifier: string;
};

function getQboContextForMode(mode: QboMode): QboContext
function getQboContextForConnection(conn: { oauth_app_env?: string|null; is_sandbox?: boolean|null }): QboContext
function getDefaultQboContext(): QboContext  // for NEW OAuth initiations
function resolveModeFromInitiateRequest(body, defaultMode): QboMode
```

Resolution rule:

1. Prefer `conn.oauth_app_env`
2. Else `conn.is_sandbox === true ? 'development' : 'production'`
3. For each mode, read `QBO_*_DEVELOPMENT` / `QBO_*_PRODUCTION`. If missing for that mode, fall back to legacy single-pair env vars and log a `qbo_context_legacy_fallback` warning (does not throw, so existing single-env tenants keep working during cutover).

`qboHost`/`qboHostFromRealm` in `_shared/qbo-host.ts` keep working but become thin wrappers that delegate to `getQboContextForConnection(...).accountingBaseUrl`.

## 4. `qbo-oauth-connect/index.ts` changes

- `verify` action: also return `qbo_default_environment`, `has_development_credentials`, `has_production_credentials`, `connection_oauth_app_env`, `qbo_context_mode`.
- `initiate` action: accept optional `mode` ("development"|"production") in body. Validate against creds available. Compute `QboContext` via `getQboContextForMode(mode)`. Use that context's `clientId` + `redirectUri` to build the authorize URL. Persist the chosen mode into the `state` value (signed/opaque) OR into a short-lived `qbo_oauth_state` row keyed on `state`.
- `callback` action: recover mode from `state` (or default), exchange code with the matching `clientId`/`clientSecret`/`redirectUri`. Fetch CompanyInfo via the matching host. Persist row via `adminClient` with `oauth_app_env` AND `is_sandbox` set together.
- `refresh` action: load connection, resolve `getQboContextForConnection(conn)`, refresh against THAT context's clientId/secret. Write tokens via `adminClient`. Never use a global single secret.
- `disconnect` action: load connection, attempt provider revoke against its own context, then `adminClient.update is_active=false, disconnected_at=now()`.
- Keep the existing pattern: user-scoped client for auth + role gate; `adminClient` (service role) is created AFTER the gate and used ONLY for `qbo_connections` writes.

## 5. `qbo-webhook-handler/index.ts` changes

- Stop reading a single global `QBO_WEBHOOK_VERIFIER`.
- Order of operations per request:
  1. Read raw body + `intuit-signature`.
  2. Try-verify against BOTH the development verifier AND the production verifier. The first match wins and is recorded as the request's `webhook_mode`. Reject 401 if neither matches.
  3. Parse payload. For each `notification`, look up `qbo_connections` by `realm_id` + `is_active=true`. Resolve `getQboContextForConnection(conn)`. Confirm `conn.oauth_app_env === webhook_mode` (if mismatch, log `qbo_webhook_realm_mode_mismatch` and skip that notification).
  4. Process events using the connection-specific host + access token (already loaded). Refresh-on-demand uses connection-specific context.

## 6. Downstream functions to thread through

For each, replace any direct read of `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET`/`apiBase` with `getQboContextForConnection(conn)`, and ensure all accounting REST calls and token refreshes use that context:

- `qbo-api`
- `qbo-customer-sync`
- `qbo-invoice-create`
- `qbo-invoice-send`
- `qbo-sync-payment`
- `qbo-fetch-items`
- `qbo-check-projects-api`
- `qbo-worker`
- `_shared/qbo-auth.ts` — `getQboEnv()` is deprecated in favor of `getQboContextForConnection(conn)`. `refreshAccessToken`, `exchangeAuthorizationCode`, `persistTokens`, `revokeConnection`, `fetchCompanyInfo` all accept an explicit `QboContext` arg.

Verification: `rg "quickbooks.api.intuit.com" supabase/functions/` returns hits only inside `_shared/qbo-context.ts` and `_shared/qbo-host.ts`.

## 7. Frontend (`QuickBooksSettings.tsx`, `QuickBooksCallback.tsx`, `QuickBooksInvoiceCard.tsx`)

- Add a `mode` selector on the Connect button: `Production` (default) or `Sandbox (development)`. Send `mode` in the `initiate` POST body. Master-only or settings-admin-only.
- Show the current connection's `oauth_app_env` + `connection_company_name` + `connection_realm_id` in settings.
- No business-logic changes; UI only surfaces what backend returns from `verify`.

## 8. Tests (`supabase/functions/.../__tests__/`)

- `qbo-context.test.ts`: development context, production context, fallback-to-legacy, missing-creds error message, `getQboContextForConnection` precedence (`oauth_app_env` over `is_sandbox`).
- `qbo-oauth-connect.test.ts`: initiate respects `mode`; callback persists `oauth_app_env`+`is_sandbox` consistently; refresh uses connection-specific creds; disconnect uses connection-specific creds; admin-client used only after auth+role gate (mock service-role client and assert call ordering).
- `qbo-webhook-handler.test.ts`: signature accepted under matching verifier only; realm→mode mismatch is logged and skipped; payment fetch uses connection host.

Run via `supabase--test_edge_functions`.

## 9. Acceptance criteria

- Existing single-env tenants keep working (legacy fallback path logs but does not throw).
- A sandbox connection and a production connection can co-exist; each refreshes against its own credentials.
- `qbo-oauth-connect` callback writes succeed (no 42501 RLS errors) and persist `oauth_app_env`.
- Webhook handler verifies with the correct verifier per request and never cross-routes a sandbox event into a production connection.
- `rg "quickbooks.api.intuit.com"` in `supabase/functions/` returns hits only in the two shared helpers.
- No tokens, refresh tokens, client secrets, auth codes, or verifier tokens appear in `console.log` output.
- `supabase--linter` clean for new migration.

## 10. Out of scope (separate follow-up plans)

- pgsodium / field-level token encryption.
- Webhook journal `oauth_app_env` column + indexes.
- Replacing `qbo-webhook` (legacy) with `qbo-webhook-handler` and removing the old folder.
- Provider redirect-URI registration in Intuit Developer portal (manual user step, documented in chat after merge).
- Production smoke-test runbook (separate doc).

## Technical details

- Mode persistence across the OAuth redirect uses a short-lived `qbo_oauth_state` row `{ state uuid pk, tenant_id, requested_mode, created_at }` with a `created_at < now() - 10min` cleanup on read. This avoids encoding trust into the `state` query param.
- Legacy fallback rule (so this is safe to ship before the user adds the split secrets): if `QBO_*_DEVELOPMENT` is unset, dev-mode context returns `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET` + sandbox host. Same for production. A `console.warn("qbo_context_legacy_fallback", { mode })` is emitted on every fallback so we can spot non-split deployments in logs.
- `is_sandbox` stays as a plain column (not generated) and is written together with `oauth_app_env` on every write. A DB trigger keeps them in sync if one is written without the other.  
  
The Lovable plan is strong. I would approve it, with **two changes before build**.
  First, **do not make Production the frontend default yet**. The plan says QuickBooksSettings should show “Production default.” That is dangerous while you are still validating. Default should come from backend `QBO_DEFAULT_ENVIRONMENT`, and for now that should be `development` until you intentionally cut over.
  Second, **do not let normal tenant admins freely pick sandbox/production** unless you explicitly want that. This should be **master-only** or internal admin-only until production is stable.
  Everything else is the right direction.
  ### What this plan gets right
  It fully fixes the problem instead of patching around it:
  - Each `qbo_connections` row gets its own permanent environment marker: `oauth_app_env`.
  - `is_sandbox` stays for backwards compatibility.
  - OAuth, refresh, revoke, accounting API calls, and webhooks all resolve from the connection environment.
  - Legacy single-env secrets remain as fallback so you do not break the existing connection during rollout.
  - `qbo-oauth-connect` keeps user auth/role checks on the user-scoped client, then uses the service-role admin client only for `qbo_connections` writes. That directly solves the RLS failure you hit.
  - Webhook verification checks both dev and prod verifiers first, then cross-checks the event realm against the matching connection environment. That is the right safe model.
  ### Required edits to the Lovable plan
  Add this correction:
  ```

  ```
  ```
  Correction 1 — frontend default:
  Do not hardcode Production as the default Connect mode yet.
  QuickBooksSettings.tsx must default the mode selector from backend qbo_default_environment.
  Until production smoke testing is complete, set QBO_DEFAULT_ENVIRONMENT=development.
  Production mode may be shown only to master/settings-admin users.
  ```
  Add this guardrail:
  ```

  ```
  ```
  Correction 2 — production access control:
  Only master users can initiate a production QBO connection unless an explicit company-level feature flag allows it.
  Tenant admins may reconnect their existing mode, but they should not be able to flip sandbox → production unless allowed by backend authorization.
  Backend must enforce this. Frontend hiding is not enough.
  ```
  I would also add one more acceptance criterion:
  ```

  ```
  ```
  Acceptance addition:
  If a production QBO connection is attempted without production credentials present, the backend returns:
  {
    success: false,
    error: "qbo_production_credentials_missing"
  }
  and does not generate an Intuit authorize URL.
  ```
  ### Final decision
  Approve the plan with those changes.
  This is the right implementation path:
  ```

  ```
  ```
  Full split credentials
  + qbo_connections.oauth_app_env
  + is_sandbox compatibility
  + service-role writes after auth
  + per-connection QBO context
  + webhook verifier split
  + frontend mode selector gated by role
  ```
  Do not downgrade this to helper-only. The uploaded plan correctly covers the pieces that would otherwise break later: token refresh, webhook verification, RLS writes, and mixed sandbox/prod tenants.