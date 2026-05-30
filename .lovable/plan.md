# Plan: Tenant-Scoped QXO Connect Flow

Align QXO with the same model we just landed for SRS: contractors authenticate as a QXO user, then map account / branch / job-account. No `client_id`, `siteId`, or partner secrets shown to normal tenants. Platform-level partner config (if any) stays server-side.

## 1. Frontend — `ConnectSupplierDialog.tsx` (QXO branch)

Replace the current 4-field form (Site/Realm, Username, Password, API Client ID) with a two-step in-app flow:

**Step A — Authenticate**

- Inputs: QXO Email/Username, QXO Password only.
- Submit → `qxo-api-proxy { action: 'authenticate' }` (renamed from `save_credentials` + `validate_connection`).
- Backend acquires bearer token via `/v1/rest/com/becn/oauth` using platform-held `QXO_CLIENT_ID` (server env) + the user-supplied credentials, stores tokens in `qxo_credentials`, returns the list of accessible accounts / branches / job-accounts.

**Step B — Map account**

- If multiple accounts → Account selector.
- Branch selector (required) → becomes `default_branch_code`.
- Optional Job Account selector if QXO returns any.
- Submit → `qxo-api-proxy { action: 'finalize_connection', account_id, branch_code, job_account }` writes non-sensitive mapping to `qxo_connections` and runs initial `sync_branches`.

No environment toggle, no client_id field, no realm/site field for normal tenants. Developer-mode (master/O'Brien) keeps the existing advanced fields behind `useSupplierDeveloperMode`.

## 2. Backend — `supabase/functions/qxo-api-proxy/index.ts`

Add/refactor actions, all tenant-scoped via `_shared/tenant.ts`:

- `authenticate` — accepts `{ username, password }`; reads `QXO_CLIENT_ID` from env (already present per repo `qxo-auth.ts`); calls `/v1/rest/com/becn/oauth`; persists `access_token`, `refresh_token`, `token_expires_at`, `username`, `password` into `qxo_credentials` keyed by `tenant_id`; calls QXO account-discovery endpoints; returns `{ accounts[], branches[], job_accounts[] }`. Never echoes secrets back to client.
- `finalize_connection` — accepts `{ account_id, branch_code, job_account? }`; updates `qxo_connections` with `account_id`, `profile_id`, `default_branch_code`, `connection_status='connected'`, `last_validated_at`; triggers `sync_branches` inline.
- `sync_branches` — unchanged behavior, but uses bearer from `qxo_credentials` for the active tenant only.
- Keep `disconnect` as-is (already deletes credential row + flips status).

Legacy `validate_connection` (uses `/login` + `siteId`) is removed from the normal-tenant path; kept only behind a `developer_mode: true` flag for debugging.

## 3. Connected-state card (`SupplierIntegrationsPanel.tsx`)

Mirror the SRS connected card shape:

- Status pill, Account #, Default Branch, Job Account (if set), Branch Count, Last Sync, View Orders.
- Disconnect button.
- No "Open QXO Portal" link as the Connect action — only a secondary link shown after `isConnected`.

## 4. Hook — `useQxoConnectionStatus.ts`

Extend `QxoConnectionRow` to surface `account_id`, `default_branch_code`, `last_validated_at` to the UI (already in the select — confirm and ensure they reach the card). No schema change needed; existing columns cover it.

## 5. Security / tenancy invariants

- `qxo_credentials` stays service-role-only (already enforced).
- `qxo-api-proxy` resolves `tenant_id` from JWT via `_shared/tenant.ts`; never trusts body `tenant_id`.
- Partner `QXO_CLIENT_ID` (and `QXO_CLIENT_SECRET` if required by QXO) read from `Deno.env.get(...)` only — never returned to browser, never exposed in tenant UI. Platform secret config is out of scope for this plan (no `add_secret` call requested).
- All writes to `qxo_connections` / `qxo_credentials` filter by resolved `tenant_id`.

## 6. Out of scope

- True browser-redirect SSO to a QXO-hosted authorize URL (QXO has not published one; the fallback embedded-credentials form is what we ship).
- Order-time pricing / availability per-row controls (covered by Priority 2 in `.lovable/plan.md`).
- Schema migrations — current `qxo_connections` / `qxo_credentials` columns are sufficient.

## Files to edit

- `src/components/settings/ConnectSupplierDialog.tsx` — QXO form → 2-step flow
- `src/components/settings/SupplierIntegrationsPanel.tsx` — connected QXO card
- `src/hooks/useQxoConnectionStatus.ts` — expose mapping fields if missing
- `supabase/functions/qxo-api-proxy/index.ts` — new `authenticate` / `finalize_connection` actions, gate legacy `validate_connection` behind developer mode  
  
Implement the QXO integration exactly as a tenant-scoped customer account connection flow.
  For all normal tenant/company users, hide all developer/backend fields including client_id, client_secret, siteId, realm, environment, API URLs, diagnostic tools, backend health checks, and platform supplier credentials.
  Normal tenant QXO flow must only show:
  1. Connect QXO Account button
  2. QXO Email/Username
  3. QXO Password
  4. Account selector if QXO returns multiple accounts
  5. Default Branch selector
  6. Optional Job Account selector
  7. Connected status card with Account #, Default Branch, Job Account, Branch Count, Last Sync, View Orders, Disconnect
  Do not expose platform-level QXO_CLIENT_ID, QXO_CLIENT_SECRET, partner credentials, backend tests, or integration diagnostics to any tenant outside the developer/master account.
  Developer/master access must remain separate and only available to Chris O’Brien / [chrisobrien91@gmail.com](mailto:chrisobrien91@gmail.com) or users with master/developer role. That developer mode is where backend supplier setup, environment config, health checks, raw API diagnostics, and advanced validation tools live.
  All tenant writes must resolve tenant_id from the authenticated JWT/session only. Never trust tenant_id from the request body. All QXO credentials/tokens must be saved in service-role-only qxo_credentials. Tenant-readable qxo_connections may only store non-sensitive mapping/status fields.
  Normal users should feel like they are simply linking their QXO account so Pitch can send orders, pull pricing, sync branches, and receive order/status updates. They should never see or manage the developer integration layer.
- &nbsp;