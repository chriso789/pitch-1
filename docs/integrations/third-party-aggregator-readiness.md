# Pitch CRM — Third-Party Supplier Aggregator: Readiness Standard

> **Source of truth.** Any change touching `qxo-*`, `abc-*`, `srs-*`, `billtrust-*`, or `supabase/functions/_shared/integrations/*` must conform to this document. If a request conflicts with this doc, this doc wins until it is updated.

---

## 1. What Pitch is (and is not)

Pitch is a **third-party supplier aggregator platform**. Many independent contractor companies (tenants) connect their **own** ABC Supply, QXO/Beacon, and SRS/Roof Hub accounts and place orders, pull pricing, read invoices, and track deliveries **through** Pitch.

Pitch is **not**:

- a single master supplier account shared across customers;
- a price-comparison or price-scraping product;
- a supplier-data resale product;
- a portal-scraper of supplier websites;
- a place where supplier portal passwords live in the browser;
- a pooled-token product;
- a cross-customer permanent catalog/pricing database (except where contractually allowed by a specific supplier).

## 2. The only legitimate flow

```
tenant company
  → authorized user (member of that tenant)
    → connected supplier account (owned by that tenant)
      → supplier API action (scope-checked, rate-limited, idempotent)
        → audit log row (tenant_id, user_id, supplier, action, result)
          → supplier response stored against the same tenant
```

Every step must be enforceable server-side. The browser never holds the supplier credential, never decides the tenant, and never decides whether an action is allowed.

## 3. The single most important rule

**Prevent cross-tenant supplier access and unauthorized supplier-account use.** No tenant may read pricing, catalogs, invoices, quotes, order history, or delivery data belonging to another tenant's supplier connection, and no tenant may place an order through another tenant's supplier account.

A violation of this rule is a P0 incident regardless of how it was introduced.

## 4. Mandatory properties for every supplier action

Every supplier API call originating from Pitch MUST be:

1. **Tenant-scoped** — resolved server-side from `auth.uid()` → `user_company_access`, never from the request body.
2. **User-authorized** — the authenticated user is a member of that tenant and has the required role for the action.
3. **Supplier-account-authorized** — the supplier connection row's `tenant_id` matches the resolved tenant; the connection's `authorization_status='active'`; the required scope is present in the connection's `scopes[]`.
4. **Audited** — a structured row in `supplier_audit_log` with tenant_id, user_id, supplier, supplier_account_id (where safe), action, result, request_id, idempotency_key (where applicable), and redacted metadata. Tokens, refresh tokens, passwords, and full sensitive payloads are never logged.
5. **Rate-limited** — per (tenant, user, supplier, action) sliding window with safe 429 + audit event on limit hit.
6. **Idempotent where it creates side effects** — keyed by `tenant_id + supplier + action + idempotency_key`. A retry of the same key returns the prior result, never a second order.
7. **Fail-closed on mismatch or uncertainty** — when tenant, user, account, credential, scope, or signature cannot be verified, the request is denied with HTTP 403 / 401 / 412 and a safe error message. Uncertain supplier responses are persisted as `pending_verification`, never as `success`.

## 5. Stop-ship risks (do not ship features that introduce any of these)

- Cross-tenant supplier reads (pricing, catalog, invoices, quotes, order history, delivery).
- Cross-tenant order placement using another tenant's supplier account.
- Supplier credentials, refresh tokens, or raw secret material returned to the browser.
- Missing customer authorization record (`authorization_status` / `authorized_by_user_id` / `scopes[]`) for a connection being used.
- Duplicate order submission on retry (idempotency missing or bypassed).
- Inbound webhook events processed without provider signature verification (when the supplier publishes a signature) or without `manual_review_required` quarantine (when they do not).
- No rate limiting on supplier-facing endpoints.
- No incident-response process for credential leak, supplier-account compromise, or cross-tenant exposure.
- No data-retention policy for supplier payloads, pricing snapshots, invoices, or audit logs.
- No CI secret scanning; secrets committed to git; credential dumps in the repo.

## 6. Authorization model (data shape)

Every supplier connection record (`abc_connections`, `qxo_connections`, `srs_connections`, and any future supplier table) MUST carry, at minimum:

| Field | Purpose |
| --- | --- |
| `tenant_id` | Owns the connection. The only column the guard trusts. |
| `supplier` | `abc` \| `qxo` \| `srs` (etc.) — for shared tables. |
| `supplier_account_id` / `account_number` | The supplier's own identifier for the account. |
| `authorized_by_user_id` | The Pitch user who connected the account. |
| `authorization_method` | `oauth` \| `api_key` \| `integration_key` \| `manual_admin`. |
| `authorization_status` | `pending` \| `active` \| `revoked` \| `expired` \| `suspended`. |
| `scopes[]` | Subset of: `pricing`, `catalog`, `order_submit`, `order_status`, `invoice_read`, `delivery_tracking`. |
| `connected_at` | When authorization was first granted. |
| `revoked_at` | When authorization was withdrawn. |
| `last_verified_at` | Last successful supplier round-trip. |
| `environment` | `sandbox` \| `production`. |

Scope rules:
- No pricing call unless `pricing` scope present and status `active`.
- No catalog call unless `catalog` scope present.
- No order submit unless `order_submit` scope present.
- No order status read unless `order_status` scope present.
- No invoice read unless `invoice_read` scope present.
- No delivery tracking unless `delivery_tracking` scope present.
- Revoked / expired / suspended / missing connections fail closed.

## 7. Forbidden implementations (always)

- Implementing portal scraping (HTML/DOM extraction) against any supplier.
- Storing supplier portal passwords in browser storage.
- Building a cross-customer permanent supplier price database.
- Weakening RLS or service-role boundaries to make the UI work.
- Trusting any of `tenant_id`, `company_id`, `account_id`, `credential_id`, `scopes`, or `role` from a request body.
- Returning supplier credentials, refresh tokens, or raw provider secret material to the browser.
- Using a wildcard `*` CORS on any supplier endpoint that writes data or returns supplier data.

## 8. Sequencing of hardening work

The hardening order (documented for future agents and reviewers):

1. **Save this document and the production-readiness audit as source of truth** ← (this phase).
2. **QXO tenant verification** on `qxo-orders`, `qxo-invoices-v4`, `qxo-quotes`, `qxo-sync-orchestrator`, `qxo-submit-order`.
3. **Shared integration primitives** under `supabase/functions/_shared/integrations/` (`tenant-guard`, `credential-vault`, `idempotency`, `webhook-verify`, `audit`, `rate-limit`) backed by `supplier_idempotency_keys`, `supplier_audit_log`, `supplier_rate_limits` tables.
4. **Customer authorization data-model enforcement** — add the columns above to supplier connection tables and enforce them in `tenant-guard`.
5. **Compliance docs** under `docs/compliance/` + supplier runbooks under `docs/integrations/` + CI guardrails (gitleaks, `.gitignore`, lint/typecheck/test).
6. **ABC and SRS hardening** using the same shared guardrails.

Implementing steps 2–6 without first persisting the strategy (step 1) is forbidden because future agents lose the security posture.

## 9. Order safety (when we do submit)

Before any supplier order is submitted:

- The tenant authorization must be `active` and include `order_submit`.
- The user must have permission for the action.
- An idempotency key must be present.
- An order preview / confirmation must be shown to the user unless the tenant has explicitly enabled auto-submit.
- The submitted payload hash and the supplier response are persisted.
- The supplier confirmation / order number is persisted.
- The action emits an audit row.
- Duplicate submission attempts are blocked by `supplier_idempotency_keys`.
- If the supplier response is ambiguous (e.g., HTTP 200 + "Queued" + `queueID===orderID`), the order is persisted as `queued` / `pending_verification`, never as `success`. (Mirrors the existing SRS Orders rule in project memory.)

## 10. Insurance and contractual posture

Pitch's third-party-aggregator posture aligns to:

- Technology E&O
- Cyber Liability
- Commercial General Liability
- Crime / Social Engineering / Funds Transfer Fraud

Detailed coverage requirements live in `docs/compliance/insurance/coverage-requirements.md`. Supplier-partner agreements take precedence where they impose stricter terms (retention, scraping prohibitions, data-resale prohibitions, audit cooperation).

---

## Cross-references

- `docs/integrations/production-readiness-audit.md` — full readiness audit + per-supplier findings.
- `docs/integrations/abc-third-party-aggregator.md` — ABC supplier runbook (planned).
- `docs/integrations/qxo-third-party-aggregator.md` — QXO supplier runbook (planned).
- `docs/integrations/srs-third-party-aggregator.md` — SRS supplier runbook (planned).
- `docs/integrations/supplier-rate-limits.md` — per-supplier rate-limit posture (planned).
- `docs/integrations/supplier-webhooks.md` — per-supplier webhook signature posture (planned).
- `docs/EDGE_FUNCTION_RULES.md` — grouped function rules; supplier integrations route through `*-api` / `*-worker` / `*-webhook`.
- `docs/RATE_LIMITING.md` — backend rate-limiting primitive (or its absence; pair with this doc).
