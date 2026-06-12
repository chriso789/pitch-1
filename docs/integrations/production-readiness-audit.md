# Pitch CRM — Third-Party Supplier Integration: Production Readiness Audit

> **Status:** Source-of-truth audit captured 2026-06-12. Companion to `third-party-aggregator-readiness.md`.
> Scope: ABC Supply, QXO/Beacon, SRS/Roof Hub. Billtrust is referenced as a quarantine item.

---

## TL;DR

The `chriso789/pitch-1` repository is **meaningfully invested** in third-party supplier integrations but is **not yet uniformly production-ready** for multi-tenant third-party ordering across ABC Supply, QXO/Beacon, and SRS/Roof Hub.

- **ABC Supply** is the strongest. Documented OAuth Authorization Code + PKCE flow, tenant-scoped webhook design, encrypted token persistence, ABC-specific settings UI, diagnostics, audit logging.
- **SRS/Roof Hub** is the most ambiguous. Submit-side semantics (HTTP 200 ≠ acceptance; `queueID===orderID` ≈ queued) are encoded in project memory but the live path still requires cron-poller / webhook reconciliation to call an order accepted.
- **QXO/Beacon** is the **highest-risk surface today**: orders / invoices / quotes / sync-orchestrator routes exist, but tenant verification is inconsistent. Cross-tenant invoice / order access via QXO is the failure mode most likely to lose a partner relationship and create real liability.

The right next move is **not** "ship more supplier UI". It is to harden the execution path, tests, and compliance package, starting with QXO tenant gating.

## Stop-ship items (highest priority first)

| # | Item | Why it is stop-ship |
| --- | --- | --- |
| 1 | **QXO tenant verification** missing or inconsistent on `qxo-orders`, `qxo-invoices-v4`, `qxo-quotes`, `qxo-sync-orchestrator`. | Cross-tenant supplier read/write — P0 multi-tenant bug. |
| 2 | **Centralized credential vault** does not exist. Each supplier integration has its own credential persistence shape. | Drift, audit gaps, harder rotation. |
| 3 | **Billtrust quarantine** — Billtrust artifacts are present without a clear authorization model or runbook. | Treat as not-production until reviewed. |
| 4 | **Idempotency layer** absent for order submission across all three suppliers. Retries can submit duplicate orders. | Real money / real materials. |
| 5 | **Supplier-boundary bug** — `src/components/orders/PushToQXOButton.tsx` invokes `abc-api-proxy` with ABC payload shape, not a QXO route. A QXO UI action must never call ABC. | UX is supplier-misrouted; could push the wrong order to the wrong supplier. |
| 6 | **Webhook signature verification** not uniformly applied across supplier webhooks; some suppliers do not publish signature schemes (must quarantine as `manual_review_required`). | Spoofable inbound events. |
| 7 | **Compliance package** (privacy policy, AUP, customer authorization form, IR one-pager, retention schedule) does not exist in the repo. | Required by partner due-diligence. |
| 8 | **No CI secret scanning** (gitleaks) and no enforced `.gitignore` for `.env*` patterns specific to supplier dumps. | One paste away from credential leak. |
| 9 | **Rate limiting** is absent. The project has no rate-limiting primitive (see `docs/RATE_LIMITING.md`). | Will be the first thing supplier partners ask about. |
| 10 | **Audit logging** of supplier actions is partial and inconsistent. Some endpoints log, some do not, and the schemas differ across suppliers. | Cannot prove what happened, by whom, for which tenant. |

## Per-supplier snapshot

### ABC Supply
- **Auth model:** OAuth Authorization Code + PKCE, tenant-scoped state and callback, encrypted token persistence.
- **Tenant isolation:** strongest of the three. Webhook handlers resolve tenant before write.
- **Gaps:** still routes through `abc-api-proxy` rather than a domain-grouped `supplier-api` route per `docs/EDGE_FUNCTION_RULES.md`. Idempotency on order submit is not enforced via a shared key store. Audit log shape diverges from QXO/SRS.

### QXO / Beacon
- **Auth model:** mixed (per-connection credentials). `qxo_connections` exists per tenant.
- **Tenant isolation:** **inconsistent**. Several edge functions accept `tenant_id` / `account_id` parameters from the body; need server-side resolution and a verified ownership check against the credential row.
- **Gaps:** order/quote/invoice routes need a uniform `tenantGuard()` call; idempotency required for order submit; webhook verification needs to be documented (and quarantined as `manual_review_required` if the supplier does not publish a signature scheme).
- **UI bug:** `PushToQXOButton.tsx` invokes ABC endpoint.

### SRS / Roof Hub
- **Auth model:** per-tenant API credentials via `srs_connections`. Mature catalog/branches setup.
- **Order semantics:** `HTTP 200` is **not** proof of acceptance. When `queueID===orderID` or the response is ~"Queued", the order is persisted as `status='queued'` and the cron poller (or webhook) promotes to `accepted` / `rejected_by_srs`. This is encoded in project memory and must remain enforced.
- **Gaps:** baseline snapshots, reconciliation runs, and webhook journals exist; the integration is the most operationally complete after ABC, but it shares the missing shared primitives (idempotency, audit, rate-limit, tenant-guard).

### Billtrust (quarantine)
- Treated as **not production** until a runbook, scope definition, and authorization model exist.

## Required shared primitives (gap)

The repo lacks centralized helpers that every supplier integration should call. They must live under `supabase/functions/_shared/integrations/`:

- `tenant-guard.ts` — auth + tenant membership + supplier-connection-owns-tenant + scope check.
- `credential-vault.ts` — encrypted, tenant-scoped credential retrieval and refresh; redaction; never to browser.
- `idempotency.ts` — `tenant_id + supplier + action + idempotency_key` dedupe with stored result, backed by `supplier_idempotency_keys`.
- `webhook-verify.ts` — per-supplier signature verifier; mark unsupported as `manual_review_required`.
- `audit.ts` — single `supplier_audit_log` writer with redaction.
- `rate-limit.ts` — per (tenant, user, supplier, action) sliding window; safe 429.

## Required compliance / control-plane artifacts (gap)

Under `docs/compliance/`:

- `privacy-policy.md`
- `terms-of-use.md`
- `api-acceptable-use.md`
- `customer-authorization-form.md`
- `information-security-policy.md`
- `incident-response-plan.md`
- `data-retention-policy.md`
- `logging-and-audit-standard.md`
- `insurance/coverage-requirements.md`

All written for **third-party aggregator posture** (no scraping, no resale, no token pooling, no browser-stored passwords, no cross-customer price DB).

## Required CI / repo hygiene (gap)

- `.github/workflows/secret-scan.yml` (gitleaks) — block PRs with secrets.
- `.gitleaks.toml` — repo-specific allowlist and rules.
- `.gitignore` must exclude `.env`, `.env.*` (with `!.env.example`), Supabase local secret files, supplier dumps, generated COIs.
- `package.json` must expose `lint`, `typecheck`, `test`, `test:unit` scripts wired in `ci.yml`.

## Recommended sequencing (now → 30 days)

1. **Now:** persist this audit + the aggregator readiness doc (← this phase).
2. **+1 day:** QXO tenant verification on the four routes + fix `PushToQXOButton`.
3. **+3 days:** ship shared primitives + their tables; wire QXO routes through them; add cross-tenant tests.
4. **+5 days:** enforce authorization columns on `*_connections` tables; require scopes on every supplier call.
5. **+7 days:** ship compliance docs + supplier runbooks + CI secret scanning.
6. **+14 days:** propagate the shared primitives to ABC and SRS; deprecate per-supplier auth/audit shapes.
7. **+21 days:** Billtrust quarantine review with go/no-go decision.
8. **+30 days:** partner readiness package ready for ABC / QXO / SRS due diligence.

## Open items / unknowns

- A GitHub-connector review of the live repo was not completed in this session; conclusions above are grounded in public GitHub pages and raw file views plus official/public supplier sources. Re-running with full repo access may sharpen specific file-line citations but is not expected to change the overall verdict.
- Per-supplier webhook signature documentation (especially QXO) needs to be confirmed with each supplier's integration team; until confirmed, the webhook verifier MUST treat them as `manual_review_required`.

---

## See also

- `docs/integrations/third-party-aggregator-readiness.md` — the readiness standard derived from this audit.
- `docs/EDGE_FUNCTION_RULES.md` — grouped function policy.
- `docs/RATE_LIMITING.md` — current state of rate-limiting (gap).
- Memory: **SRS Orders** rule in `mem://index.md` (`queueID===orderID` semantics).
- Memory: **SRS Distribution Integration** at `mem://features/srs-distribution-integration`.
