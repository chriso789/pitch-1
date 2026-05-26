## Phase 1 finish: refactor qbo-oauth-connect + request QBO secrets

### 1. Request QBO secrets (first, blocking)

Use `secrets--add_secret` for any of these not already present (will check `fetch_secrets` first):
- `QBO_CLIENT_ID` — Intuit app Client ID
- `QBO_CLIENT_SECRET` — Intuit app Client Secret
- `QBO_REDIRECT_URI` — e.g. `https://pitch-crm.ai/settings/integrations/qbo/callback`
- `QBO_ENVIRONMENT` — `sandbox` or `production`
- `QBO_WEBHOOK_VERIFIER_TOKEN` — from Intuit webhooks settings (used in Phase 3 but added now)

### 2. Refactor `supabase/functions/qbo-oauth-connect/index.ts`

Replace the hand-rolled OAuth with the shared `_shared/qbo-auth.ts` module from Phase 1a:

- **Auth mode**: authenticated tenant route. Resolve `user` from JWT, load `profiles.tenant_id` + role, require `admin`/`master`. Reject otherwise.
- **`action=initiate`**:
  - Generate CSRF `state = crypto.randomUUID()`.
  - Persist `oauth_state` + `oauth_state_expires_at` (now + 10 min) on a pending `qbo_connections` row for `(tenant_id, connected_by=user.id)` — or in a small `qbo_oauth_states` scratch row keyed by `(tenant_id, state)`. Pick the simpler path: write `oauth_state` to `qbo_connections` upsert with `is_active=false` placeholder.
  - Build authorize URL via `buildAuthorizeUrl({ state, scope })` from shared module.
  - Return `{ authUrl, state }`.
- **`action=callback`**:
  - Validate `{ code, realmId, state }` with Zod.
  - Look up stored `oauth_state` for this tenant; reject if missing, expired, or mismatched. Clear it on success.
  - Call `exchangeAuthorizationCode(code)` from shared module.
  - Call `fetchCompanyInfo(realmId, accessToken)` from shared module.
  - Call `persistTokens({ tenantId, realmId, tokens, companyInfo, connectedBy: user.id })` — this writes `access_token`, `refresh_token`, `token_expires_at`, `refresh_token_expires_at`, `last_refresh_at=now`, `disconnected_at=null`, `is_active=true`, `qbo_company_name`, `metadata.company_info`, with `onConflict: 'tenant_id,realm_id'`.
  - Return `{ ok: true, connection: { id, realmId, companyName } }`.
- **`action=refresh`**:
  - Delegate to `getValidAccessToken({ tenantId })` which already does the ≥5min skew + rollover + 100-day reauth gate. Return `{ ok: true, expiresAt }`.
- **`action=disconnect`**:
  - Call `revokeConnection({ tenantId })` from shared module (calls Intuit revoke endpoint, sets `is_active=false`, `disconnected_at=now`, clears tokens).
- **CORS**: keep current headers, return them on every response including errors.
- **Errors**: never leak `client_secret`, raw Intuit response bodies, or stack traces. Use `{ ok: false, error, code }` envelope.
- **No service role**: continue using user-scoped client; `persistTokens` accepts the same client.

### 3. Out of scope (later phases)
- No changes to `qbo-customer-sync`, `qbo-invoice-create`, `qbo-webhook(-handler)`, `qbo-worker`, etc. (those move to shared client in Phase 2).
- No new tables. `oauth_state` + `oauth_state_expires_at` columns already exist on `qbo_connections` from Phase 1a migration.
- No frontend changes beyond what the existing connect flow already calls (`initiate` → redirect → `callback` → `disconnect`).

### 4. Validation
- Deno test: `qbo-oauth-connect` rejects unauthenticated, rejects non-admin, rejects callback with bad state, accepts callback with matching state (mocked token exchange).
- Manual: connect → reconnect → disconnect against Intuit sandbox.

### Security checklist
- Tenant resolved from JWT, never from body. ✓
- Role gate (admin/master) enforced server-side. ✓
- CSRF `state` persisted server-side and verified on callback. ✓
- Secrets read only via `Deno.env.get`. ✓
- Tokens never returned to the browser. ✓
- Audit log entry on connect / disconnect via `_shared/audit.ts`.
