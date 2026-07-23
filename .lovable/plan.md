# SRS Production Hardening Plan

Scope covers the 11 tasks in your brief. Nothing on the QA‑validated Submit Order payload changes. All risky behavior (payload mutation, submit variances, auto‑retry) is moved behind a `SRS_DEBUG_MODE` gate. New diagnostics + readiness surfaces are added; contract questions for SRS are documented, not coded.

## Files touched

**Edge functions**
- `supabase/functions/srs-api-proxy/index.ts` — freeze submit payload builder; strip auto variance/multi‑submit from the production path; add `SRS_DEBUG_MODE` gate around QA-only branches; switch token exchange to `application/x-www-form-urlencoded` primary with JSON fallback preserved; ensure a single persisted `transaction_id` is reused on network retries and never regenerated; keep queueID/orderID persistence and audit logging intact.
- `supabase/functions/srs-api/index.ts` — same gate/normalization if variance logic lives here; leave webhook + status paths unchanged.
- `supabase/functions/_shared/srs/` (new) — small `env.ts` helper exposing `getSrsMode()` returning `'production' | 'qa' | 'debug'` derived from `SRS_DEBUG_MODE` + platform admin override header.

**Pre‑submit validation**
- New `supabase/functions/_shared/srs/validateSubmitOrder.ts` — checks customer, branch, jobAccount, product IDs against tenant catalog, shipping method, UOM, delivery method, contact, address, expected delivery. Rejects with 422 + field errors before any SRS call. Wired into `srs-api-proxy` submit route.

**Webhook**
- No functional changes. Add a short header comment marking it as VERIFIED and pointing to the audit doc.

**Pricing (Task 7)**
- No code changes. Add `// TODO(srs-meeting):` block in `srs-pricing/index.ts` listing the productId vs productNumber question.

**Frontend — Integration Health Dashboard (Task 10)**
- New `src/components/admin/SrsIntegrationHealth.tsx` — 15 status tiles: Authentication, Customer, Branch, Job Account, Catalog, Price, Submit, Queue, Order ID, Webhook, Delivery, Invoice, Last Success, Last Error, Environment. Pulls from existing `srs_connections`, `srs_order_status_events`, `srs_webhook_events`, `srs_audit_log` tables via read queries scoped by `useEffectiveTenantId()`.
- Mounted inside `src/components/admin/SrsAdminSurfaces.tsx` above the existing panels.

**Frontend — Production Readiness Report (Task 11)**
- New `src/components/admin/SrsProductionReadinessReport.tsx` — checklist of 17 items with VERIFIED / PENDING / BLOCKED badges + a "Copy for SRS" button that exports the report + outstanding questions as markdown.
- Mounted inside `SrsAdminSurfaces.tsx` at the bottom.

**Docs**
- Update `docs/srs-sips-integration-audit.md`:
  - Mark OAuth, Submit Order, Order ID, Webhook, Status updates, Audit logging as **VERIFIED via QA end-to-end**.
  - Remove stale "webhook TODO / missing / incomplete" statements.
  - Append **Outstanding Questions for SRS** section (5 items from your brief).
  - Append **Frozen Submit Payload Contract** section listing the exact fields.

## Behavioral changes (production path)

1. `SRS_DEBUG_MODE !== 'true'` and no `x-srs-debug: true` header from a master/COB user → payload builder is pass‑through; no field mutation, no variance sweep, no multi‑submit.
2. Network‑layer retry: same `transaction_id`, exponential backoff, max 3 attempts, only on 5xx / network errors. Business retries require an explicit user action.
3. OAuth token request body is `application/x-www-form-urlencoded`; JSON path retained as a `catch` fallback.
4. Pre‑submit validator returns `{ ok:false, code:'srs_invalid_order', details:{...} }` before any SRS call for missing/invalid inputs.

## Non‑changes (explicit)

- Submit Order payload shape and field set.
- Webhook processing, dedupe, idempotency, matching, status history, attachments, invoice creation.
- Any price endpoint request contract — flagged as TODO only.
- Existing token caching, expiration, audit log tables.

## Rollout

- Ship edge function changes → they auto‑deploy.
- No DB migration required (all reads use existing tables).
- After deploy, open Company Admin → Integrations → SRS to see the new Health Dashboard + Readiness Report.

Approve and I'll implement.