# Revised Plan: Tenant-Scoped QXO Connect Flow (evidence-aligned)

Refines the shipped two-step flow based on the research report. Three real corrections vs. what's currently in code; everything else is already in line with the evidence.

## Corrections vs. current implementation

### 1. Stop hard-coding `/v1/rest/com/becn/oauth` as the authenticate path

Public Beacon/QXO docs do **not** confirm that path. They confirm:

- Legacy session login: `POST {QXO_BASE_V1}/login`
- Separate OAuth token service: `POST {QXO_BASE}/rest/model/REST/oauth/token` (refresh)
- Website OIDC at `login.qxo.com` — not a partner contract for Pitch yet

Action in `supabase/functions/qxo-api-proxy/index.ts`:

- Introduce a single `qxoAuthenticate(username, password)` helper driven by a server-side `QXO_AUTH_MODE` env (`session` | `token`), defaulting to `session` (legacy `/login`) since that's the contract publicly documented.
- Persist `auth_mode` on `qxo_credentials` so refresh/disconnect branches know which contract to use.
- Remove any code path that assumes a fixed `/oauth` authenticate endpoint.

### 2. Split persistence cleanly — credentials vs. mapping

- `qxo_credentials` (service-role only): `username`, encrypted `password` (only if `auth_mode='session'` requires re-auth), `access_token`, `refresh_token`, `token_expires_at`, `auth_mode`, `raw_user`.
- `qxo_connections` (tenant-readable): `account_id`, `account_number`, `default_branch_code`, `job_account`, `branch_contact_name`, `branch_contact_phone`, `branch_contact_email`, `template_id`, `template_name`, `connection_status`, `last_validated_at`, `last_sync_at`.

Migration adds the new non-sensitive columns (`branch_contact_*`, `template_*`, `account_number`) to `qxo_connections` if missing. No new sensitive columns.

### 3. Expand Step B to match real QXO partner flows

Partner evidence (Roofr, Roofle) shows two fields the current Step B is missing:

- **Branch contact** (name + phone/email) — Roofr requires it per selected branch.
- **Order template** — Roofle requires a QXO template before ordering.

`ConnectSupplierDialog.tsx` (QXO branch, Step B) gets:

- Account selector (only if >1)
- Branch selector (required)
- Branch contact name + phone/email (required when branch selected)
- Optional Job Account selector
- Optional Template selector (only rendered if `authenticate` discovery returned templates)

## Already correct — keep as-is

- Two-step `authenticate` → `finalize_connection` flow.
- Tenant resolution from JWT via `_shared/tenant.ts`; body `tenant_id` ignored.
- Service-role-only `qxo_credentials`; tenant UI never sees client_id/secret/siteId/realm/env.
- Developer surfaces gated behind `useSupplierDeveloperMode`.
- Connected card layout (Account #, Default Branch, Branch Count, Last Sync, View Orders, Disconnect).

## New: token lifecycle + UI states

Proxy adds explicit state transitions surfaced to `useQxoConnectionStatus`:
`disconnected` → `connecting` → `needs_mapping` → `connected` → `expired` → `error`.

- On any 401/`invalid_token` from QXO: attempt one refresh (token mode) or mark `expired` (session mode), do not silent-retry.
- `needs_mapping` is set when `authenticate` succeeds but `finalize_connection` hasn't run.

## Disconnect

- Session mode: best-effort `POST /logout`, then hard-delete `qxo_credentials` row + clear mapping fields on `qxo_connections` (`connection_status='disconnected'`).
- Token mode: same, plus revoke if a revocation endpoint is later confirmed.
- `qxo_orders` rows are preserved.

## Files

- `supabase/migrations/<new>.sql` — add `branch_contact_*`, `template_id`, `template_name`, `account_number`, `auth_mode` columns (IF NOT EXISTS); no new sensitive columns; preserve existing GRANTs.
- `supabase/functions/qxo-api-proxy/index.ts` — `qxoAuthenticate` helper driven by `QXO_AUTH_MODE`; remove hard-coded `/oauth` path; emit `needs_mapping` state; refresh-once on 401; persist `auth_mode`.
- `src/components/settings/ConnectSupplierDialog.tsx` (QXO branch only) — add branch-contact fields and optional template selector in Step B.
- `src/components/settings/SupplierIntegrationsPanel.tsx` — surface Branch Contact + Template (if set) on connected card; render `needs_mapping`/`expired` states with a "Resume mapping" / "Reconnect" CTA.
- `src/hooks/useQxoConnectionStatus.ts` — expose `branch_contact_*`, `template_*`, and the expanded state enum.

## Out of scope

- Real OIDC redirect to `login.qxo.com` — blocked on QXO issuing Pitch a partner client_id/redirect_uri. Plan stays in-app credential exchange until then.
- Order-submission edge function changes beyond reading the new mapping fields.
- SRS / ABC flows — unchanged.

## Acceptance checks

- Tenant A authenticate + map does not surface on tenant B's connected card, orders, or disconnect.
- Body-supplied `tenant_id` is ignored; JWT-resolved tenant wins.
- Forcing `QXO_AUTH_MODE=token` swaps backend contract without UI changes.
- Disconnect on tenant A leaves tenant B's connection intact.
- Expired credentials drive UI to `expired` with reconnect CTA, not silent failure.  
**QXO Tenant-Scoped Connect Flow Assessment for Pitch**
  ## **Research scope and evidence quality**
  The current `api.qxo.com/partner-integrations-service/consolidated-api` page is publicly reachable as a Swagger UI shell, but in this research run it did not expose endpoint text that could be directly extracted from the page output. Because of that limitation, the most reliable public evidence came from QXO’s own API-services and partner-integration pages, partner help-center documentation from active CRM/integration partners, and still-public legacy Beacon swagger pages that remain relevant during the QXO rebrand. That rebrand transition is explicit in partner help content, which notes that older Beacon branding is still in use while the underlying guidance remains accurate.
  That matters because the question here is not just “what APIs exist,” but “what does a non-developer tenant actually see when they click Connect inside a CRM?” On that point, the partner help docs are especially valuable, because they document the exact customer-facing connect flow used by Roofr, Roofle, Hover, and AccuLynx-style integrations in production.
  ## **What public QXO materials say the integration is supposed to do**
  QXO’s own API-services page says its APIs are meant to let software partners place and track orders, retrieve pricing, access account information, browse product data, follow delivery tracking, and retrieve invoice information. The official QXO partner pages for ServiceTitan, JobTread, and AccuLynx all describe the same core value proposition: rich catalog data, branch-sensitive pricing, real-time ordering, delivery/status tracking, and a flow that keeps contractors inside their CRM instead of bouncing them back to QXO.com.
  QXO’s own online-product pages also show that templates and order history are first-class parts of the contractor experience. QXO Online advertises real-time inventory and pricing, custom order templates, delivery tracking, and order history; its order-history page says contractors can view past-order prices, invoices, payment status, delivery photos, and downloadable order summaries for CRM/ERP use. That is strong evidence that any Pitch implementation should assume branch-specific pricing, persistent external order IDs/history, and optional-but-important template support.
  ## **How customers actually connect their QXO account inside CRMs**
  There is no single public QXO customer-linking pattern across all CRMs. Roofr and Roofle both document an **embedded credential flow**: the user clicks Connect inside the CRM, enters the company’s QXO credentials in a CRM modal, and then proceeds to branch mapping. Roofr explicitly says “enter your QXO account credentials,” then “choose the branches” and add a branch contact before saving. Roofle likewise tells the user to enter the company’s QXO email and password in a popup, then associate CRM markets with QXO branches so orders route to the correct branch.
  Hover documents a different, but equally real, **redirect-authorization flow**. In Hover, clicking Connect next to QXO redirects the user to sign into QXO, then redirects them back to Hover after authorization. Hover then requires a separate supplier direct-ordering/default-branch form so support can finish connecting the organization to its preferred branch for ordering. Hover also documents reconnect triggers, including password changes, inactivity, and reuse of the same QXO login across multiple Hover markets.
  AccuLynx sits closer to the embedded-authentication model in how it is described publicly. QXO’s AccuLynx integration page says QXO customers can see material costs and place orders from inside AccuLynx, and the original launch announcement said roofing companies authenticate their Beacon PRO+ account inside AccuLynx to access catalog data and pricing. That does **not** prove the exact UI widget AccuLynx uses, but it does support the principle that the contractor’s own QXO account is authenticated inside the CRM rather than by exposing partner developer keys to the contractor.
  The practical conclusion is important: a tenant-facing Pitch plan should **not** assume one universal QXO connect mode. Public evidence supports at least two: embedded credentials and redirect-based authorization.
  ## **What the public auth evidence says about implementation details**
  The still-public Beacon swagger pages show multiple legacy auth contracts, not one universal one. The Version 1 docs describe a session model that uses `POST /login` and `POST /logout`, says a session must be established before services can be called, and notes a default session lifetime of one hour with a persistent-login option extending it to seven days. The combined swagger also exposes account and routing-related resources such as `GET /accounts`, `POST /switchAccount`, `GET /branchlist`, and `GET /jobs`.
  The public Beacon/QXO swagger evidence also shows an OAuth-style bearer-token family. Version 2 and `v2_ng` are described as OAuth/bearer-token APIs, and the separate OAuth swagger page documents a refresh-token service under the production base URL `https://beaconproplus.com/rest/model/REST/oauth`. Another public swagger snippet notes that `apiSiteId` can be parsed from the OAuth token and tied to the generating client ID, which strongly suggests client-credential artifacts such as `client_id`, `apiSiteId`, or similar fields belong to the partner/backend layer, not to ordinary tenant users.
  That means Lovable’s first correction — **stop hard-coding one authenticate path** — is right in spirit. The public material I could verify supports a legacy session login contract, a bearer/OAuth contract with refresh, and at least one redirect-to-QXO authorization flow in a live partner integration. What I did **not** find was public evidence that a fixed `/v1/rest/com/becn/oauth` path is the universal tenant-auth endpoint for every CRM integration.
  ## **Where Lovable’s revised plan is strongly supported**
  The plan is **strongly supported** on one core product principle: ordinary tenants should not see developer-facing auth artifacts such as client IDs, client secrets, site IDs, realms, environments, or backend diagnostics. In the public customer-facing flows I reviewed, tenants either enter only their company’s QXO credentials or click Connect and authorize with QXO; none of the public partner guides ask the contractor to supply partner `client_id` or similar backend values. The public OAuth swagger also ties `apiSiteId` behavior to token/client generation, reinforcing that those details belong behind the server boundary.
  The plan is also **strongly supported** in adding explicit post-auth mapping. The public legacy API surface lists accounts, account switching, branches, and jobs. The partner docs then show what the user actually does with those objects: Roofr requires branch confirmation and branch-contact capture; Roofle requires branch-to-market association; Roofr’s FAQ says QXO job accounts can appear later in proposals/material orders and may even be mandatory in some cases.
  The plan is additionally **well supported** in separating sensitive credentials from tenant-readable mapping/status. That exact storage schema is not prescribed by QXO’s public docs, so this is an engineering recommendation rather than a QXO requirement. Still, it aligns with how the public partner UX works: contractors authenticate with company credentials or authorize access, while the CRM later needs to remember non-sensitive objects like selected branch, optional job account, and branch contact settings for pricing and order routing.
  ## **Where the revised plan needs changes before you call it evidence-aligned**
  The strongest change I would make is this: **do not model QXO as only** `session | token` **at the customer-connect level**. Public evidence shows at least three distinct patterns in the ecosystem: old session login, bearer/OAuth APIs, and redirect-to-QXO authorization in Hover. For Pitch, that means you probably want two layers of configuration: a tenant-facing `connect_mode` such as `embedded_credentials` versus `redirect_authorize`, and a backend `auth_mode` such as `session` versus `oauth_bearer`. Treating QXO as only a hidden backend switch between “session” and “token” misses a real customer-facing connect mode already used by another partner.
  The second change is about templates. Template support is real and important, but the **public evidence does not say that every CRM must require template selection during connection**. Roofle requires that the QXO account have at least one branch and one template available, but its order guide has the user choose the QXO template during the material-order workflow, not during account linking. QXO Online also positions templates as an ordering aid, not strictly as a connection prerequisite. So Lovable’s plan should keep template discovery in Step B, but frame it as “optional default template” or “choose later at order time,” unless Pitch’s actual QXO contract requires it earlier.
  The third change is about the out-of-scope note on redirect auth. Saying “real OIDC redirect is blocked because QXO has not published one” is too strong for the public evidence. What the sources do show is that Hover already redirects users to QXO for authorization and then returns them to the CRM. What the sources do **not** show is whether that flow is OIDC, whether Pitch can use the same contract, or whether QXO would issue Pitch its own client/redirect registration. So the safer, evidence-aligned wording is: **“Redirect-based authorization exists for at least one partner, but Pitch should not assume it is available until QXO confirms Pitch’s partner contract.”**
  The fourth change is about passwords. Public partner docs make clear that password changes can force reconnection, and legacy session docs make clear that sessions expire. That makes a strong case for an `expired` or `reconnect_required` state in the UI. It does **not** automatically justify storing raw passwords long-term. If Pitch must support session re-auth under a session-mode contract, password material should be encrypted and service-role-only; otherwise, a reconnect CTA is safer.
  ## **Evidence-aligned implementation blueprint for Pitch’s non-developer tenants**
  For ordinary tenants, the cleanest evidence-aligned design is: when the user clicks **Connect QXO Account**, Pitch should run a **configurable customer-connect mode**. If Pitch’s QXO partner contract matches Roofr/Roofle, show a modal that asks only for the company’s QXO email/username and password. If Pitch’s contract matches Hover, redirect the user to QXO to authorize and then return them to Pitch. In either case, the tenant should never see partner client IDs, secrets, site IDs, or environment controls.
  After successful authentication/authorization, Pitch should move into a post-auth mapping step. Public evidence supports fetching available accounts, branches, and jobs; requiring branch selection; capturing branch contact name plus at least one contact method when the flow requires it; and surfacing job accounts only when returned and relevant. Persisting `account_number` when returned is also sensible, since Roofr’s troubleshooting ties missing pricing to wrong account/account-number selection.
  Templates should be discovered at or after connection, but the UI should treat them as **optional defaults** unless the real partner contract says otherwise. The user can connect QXO without forcing a template choice immediately, then either set a default template later or pick a template during the order flow, which is exactly how Roofle documents the experience and how QXO’s own online-ordering materials position templates.
  The ordering side should then use the stored tenant mapping to drive branch-specific pricing, variants, availability, and PO submission. Official QXO pages and partner docs consistently point to local/preferred-branch pricing, real-time or near-real-time product data, order submission from inside the CRM, delivery/status updates, and proof-of-delivery/order-history visibility after submission.
  For auth lifecycle, I would explicitly expose `connected`, `needs_mapping`, `expired`, and `error` states. That is well supported by the public material: old session docs show finite session lifetime, OAuth docs show refresh-token behavior, and Hover documents real reconnect triggers such as password changes, inactivity, and market-scoping issues. A silent failure path is the least evidence-aligned behavior here.
  For tenant isolation, the critical product rule is: **the current Pitch tenant must own the QXO connection object, not the browser’s ambient QXO session**. In embedded-credential flows like Roofr/Roofle, a preexisting QXO browser session should be irrelevant because the CRM is collecting credentials itself. In redirect flows like Hover, the browser session can influence the authorization step, so Pitch should bind the callback to the initiating tenant and user before finalizing the connection. That is where a signed `state` payload is warranted; it is a good security measure for redirect-based flows, but not something you need for embedded credentials.
  The bottom line is that Lovable’s revised plan is **directionally right but not yet fully evidence-aligned**. The parts you should keep are: hiding developer fields from tenants, doing explicit post-auth mapping, capturing branch contact data, supporting job accounts, and surfacing expired/reconnect states. The parts you should change are: stop assuming one hard-coded auth endpoint, stop assuming one universal customer-connect mode, and treat template selection as optional/default-or-order-time unless QXO explicitly requires it earlier. If Pitch’s actual partner contract is still unknown, the safest architecture is a pluggable `connect_mode` for the tenant UX and a separate `auth_mode` for the backend.