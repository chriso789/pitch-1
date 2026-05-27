# QBO Production Hardening + Legal Acceptance Gating (Phase 1)

Smallest scope that unblocks Intuit production review and creates the legal-evidence foundation. Audit confirmed: `qbo_connections` already carries `is_sandbox`, `oauth_app_env`, `refresh_token_expires_at`, `last_refresh_at`, `disconnected_at`, `connected_by`; `qbo-webhook-handler` already verifies `intuit-signature` with dual dev/prod verifiers and rejects realm/env mismatches. So this plan extends existing code rather than re-implementing it.

Explicitly **out of scope** for this phase: AI disclosure/review gates, measurement liability workflow, SMS/TCPA consent center, public subprocessor page, incident model, full compliance dashboard.

---

## 1. Replace client-rendered callback with server-side 302

**Problem.** `supabase/functions/qbo-oauth-connect/index.ts` currently catches the GET callback from Intuit and 302s the browser to `https://pitch-crm.ai/quickbooks/callback`, where `src/pages/QuickBooksCallback.tsx` renders HTML, reads `code` / `realmId` / `state` from `window.location.search`, and posts to `window.opener` with `targetOrigin: '*'`. Intuit's security guidance says token-bearing callback endpoints must not return HTML and must 302 instead.

**Fix.** Make the `qbo-oauth-connect` GET handler perform the full server-side exchange before any browser HTML loads.

Flow on Intuit's redirect to `…/functions/v1/qbo-oauth-connect/callback?code=…&realmId=…&state=…`:
1. Look up `state` in `qbo_oauth_states`; if missing/expired → 302 `…/settings/integrations?provider=qbo&status=invalid_state`.
2. Resolve `tenant_id`, `user_id`, `expected_oauth_app_env`, `consent_id` from that row. Delete the row (single-use).
3. If Intuit returned `error` → 302 `…?status=denied` (or `…?status=denied&reason=<error>`).
4. If `realmId` missing → 302 `…?status=missing_realm`.
5. Exchange `code` for tokens against the host derived from `expected_oauth_app_env`. On failure → 302 `…?status=exchange_failed`.
6. Upsert `qbo_connections` (admin client, then `.eq('tenant_id', resolvedTenantId)`): `realm_id`, `qbo_company_name` (fetch from `/v3/company/{realmId}/companyinfo/{realmId}`), `is_sandbox`, `oauth_app_env`, `access_token`, `refresh_token`, `token_expires_at = now() + expires_in`, `refresh_token_expires_at = now() + x_refresh_token_expires_in`, `last_refresh_at = now()`, `connected_by = user_id`, `connected_at = now()`, `disconnected_at = null`, `is_active = true`, `scopes` from response.
7. 302 → `https://pitch-crm.ai/settings/integrations?provider=qbo&status=connected&realm=<realmId>`.

Status query params used by the settings page:
- `connected`, `denied`, `invalid_state`, `exchange_failed`, `missing_realm`, `reauth_required`.

**Token refresh hardening** (existing refresh paths in `qbo-oauth-connect` and `_shared/qbo-auth.ts`):
- Always overwrite `refresh_token` with whatever Intuit returns (the response may rotate it).
- Always update `refresh_token_expires_at = now() + x_refresh_token_expires_in` and `last_refresh_at = now()`.
- On 400 `invalid_grant` from token endpoint → mark connection `is_active = false`, set `disconnected_at = now()`, and surface `status=reauth_required` to the UI on the next visit.

**Initiate endpoint.** `qbo-oauth-connect` `POST { action: 'initiate' }` must, in this order:
1. Validate authenticated user + role.
2. Confirm latest required `legal_acceptances` exist for this tenant (see §2). If not → return `{ ok: false, code: 'legal_acceptance_required', required: [...] }`.
3. Confirm a fresh `integration_consents` row was just written (consent_id in body) for `quickbooks`. If not → `consent_required`.
4. Insert `qbo_oauth_states { state, tenant_id, user_id, expected_oauth_app_env, consent_id, expires_at = now()+15min }`.
5. Return Intuit authorize URL with that `state`.

**Frontend cleanup.**
- `src/pages/QuickBooksCallback.tsx` → reduce to a thin redirect-only shell (e.g., reads `status` query, redirects to `/settings/integrations?...`) or remove from the router entirely. The Intuit redirect URI registered in the Intuit app will be changed to point at the edge function URL.
- `src/components/settings/QuickBooksSettings.tsx` connect button → opens the initiate URL in the **same tab** (no popup, no `window.opener`).

---

## 2. Legal acceptance gating + consent receipts

Greenfield. Three new tables.

**`legal_documents`** — registry of legal doc versions.
- Columns: `id`, `document_key` (`'privacy_policy' | 'terms_of_service' | 'qbo_integration_consent'`), `version` (semver string), `effective_at`, `body_markdown`, `body_sha256`, `is_current` (bool, partial unique index per `document_key` where `is_current = true`), `created_at`.
- RLS: anyone authenticated can read; only master role can insert/update.
- Seed migration inserts initial v1.0 rows for the three keys (text TBD — Phase 1 uses placeholder text and a follow-up legal-review pass replaces it).

**`legal_acceptances`** — per-user acceptance of a document version.
- Columns: `id`, `tenant_id`, `user_id`, `document_key`, `document_version`, `document_id` (FK), `body_sha256` (snapshot), `accepted_at`, `ip inet`, `user_agent`.
- Unique `(user_id, document_key, document_version)`.
- RLS: user can read their own + insert their own; master sees all in their tenant.

**`integration_consents`** — per-connection-attempt consent receipt.
- Columns: `id`, `tenant_id`, `user_id`, `integration text` (`'quickbooks'`), `consent_version`, `consent_text_snapshot text`, `consent_text_sha256`, `expected_oauth_app_env`, `accepted_at`, `ip`, `user_agent`, `used_for_connection_id` (nullable FK, set when used).
- Per-attempt — not unique on user; bound to an `oauth_state` on initiate.
- RLS: user can read/insert own; master sees tenant.

**`qbo_oauth_states`** — already needed (single-use OAuth state).
- Columns: `state text primary key`, `tenant_id`, `user_id`, `expected_oauth_app_env`, `consent_id` FK → `integration_consents.id`, `created_at`, `expires_at`.
- No anon grant. Service role + edge function only.

Every `CREATE TABLE` in this migration ends with explicit `GRANT` statements per the public-schema-grants rule, then `ENABLE ROW LEVEL SECURITY`, then policies.

**Pre-connect modal** (`src/components/settings/QuickBooksConnectDialog.tsx`, new):
- Displays current Privacy Policy + Terms + QBO integration consent text (pulled from `legal_documents` where `is_current`).
- Three required checkboxes (separate, never bundled).
- Lets user pick environment (Production / Sandbox) — but Production requires all three acceptances current; Sandbox can proceed without.
- On submit: writes one row per checkbox to `legal_acceptances` (if not already present for that version), writes one `integration_consents` row with the full snapshot + sha256, then calls `qbo-oauth-connect` `POST { action: 'initiate', consent_id, oauth_app_env }`.

**Server enforcement** (initiate endpoint, see §1).

---

## 3. Admin / developer visibility

Extend `src/components/settings/QuickBooksSettings.tsx` to show, per active connection:

- QuickBooks company name + realm ID.
- Environment badge: `Production` vs `Sandbox`.
- Connected by (user display name) + connected_at.
- `token_expires_at` (time-until).
- `refresh_token_expires_at` (time-until, **highlight red <14 days**).
- `last_refresh_at`.
- Webhook signature status (count of last 24h verified vs. invalid, from a new `qbo_webhook_events` audit table — see below).
- Latest legal-acceptance versions per `document_key` for the connecting user.
- Disconnect button (calls existing disconnect path; sets `is_active=false`, `disconnected_at=now()`, revokes via Intuit revoke endpoint).
- Re-connect banner when `status=reauth_required` query param present or connection inactive.

**`qbo_webhook_events`** (new table) — per audit brief:
- Columns: `id`, `realm_id`, `oauth_app_env`, `signature_valid bool`, `event_count int`, `received_at`, `processed_at`, `error_code`, `error_message`, `tenant_id` (resolved).
- Written from `qbo-webhook-handler` on every inbound notification (one row per delivery, not per event).
- RLS: tenant members read own; master reads all.

---

## Technical details

**Files created**
- `supabase/migrations/<ts>_qbo_legal_gating.sql` — `legal_documents`, `legal_acceptances`, `integration_consents`, `qbo_oauth_states`, `qbo_webhook_events`, seed rows, GRANTs, RLS, `NOTIFY pgrst, 'reload schema';`.
- `src/components/settings/QuickBooksConnectDialog.tsx` — pre-connect consent modal.
- `src/hooks/useQboConnectionStatus.ts` — combined query for connections + webhook stats + acceptance status.

**Files edited**
- `supabase/functions/qbo-oauth-connect/index.ts` — server-302 callback, state validation, consent + legal gating on initiate, token refresh writes latest refresh_token + expiry.
- `supabase/functions/qbo-webhook-handler/index.ts` — write `qbo_webhook_events` audit row on every delivery (verified and unverified).
- `supabase/functions/_shared/qbo-auth.ts` — token refresh helper persists `refresh_token`, `refresh_token_expires_at`, `last_refresh_at`; on `invalid_grant` marks connection inactive.
- `src/components/settings/QuickBooksSettings.tsx` — replace popup connect with same-tab initiate; render connection status card (env, realm, expiries, webhook status, legal acceptance status, disconnect, reauth banner).
- `src/pages/QuickBooksCallback.tsx` — reduce to redirect-only shell that reads `?status` and forwards to `/settings/integrations` (kept temporarily for any cached redirect URI; can be removed after Intuit app's Redirect URI is updated to the edge-function URL).
- `src/App.tsx` — no route changes; callback page stays mounted as redirect shell.

**Intuit dashboard step (user action, outside the codebase)**
After this ships, the user updates Production and Development app Redirect URIs in the Intuit developer dashboard to:
`https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback`

That swap is what activates the server-302 flow. Until then the frontend redirect shell keeps the old URI working.

**Auth model on edge function**
- `qbo-oauth-connect` POST `initiate` / `refresh` / `disconnect`: authenticated tenant route — user-scoped client validates JWT and role; admin client only for the writes to `qbo_connections` / `qbo_oauth_states` / `integration_consents`.
- `qbo-oauth-connect` GET `/callback`: public (Intuit can't authenticate), but every action is gated by `state` lookup in `qbo_oauth_states` which binds to `tenant_id` / `user_id` / `consent_id`. No body trust.
- `qbo-webhook-handler` POST: public webhook — signature verification already implemented.

**Not changed**
- Webhook signature verification logic (already correct).
- `qbo_connections` schema (all needed columns present).
- Other QBO functions (`qbo-invoice-create`, `qbo-invoice-send`, `qbo-sync-payment`, `qbo-customer-sync`, `qbo-fetch-items`, `qbo-check-projects-api`, `qbo-worker`, `qbo-api`) — they already route by `is_sandbox`/`oauth_app_env` via `_shared/qbo-host.ts`. No changes this phase.

**Phase 2 (not now)**: AI disclosure gate on measurement reports, SMS/TCPA consent infra, subprocessor page, incident model, audit dashboards. These reuse the `legal_documents` / `legal_acceptances` tables introduced here.
