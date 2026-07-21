
# SRS Production Hardening Plan

The QA end-to-end run (OAuth → validate → submit → real Order ID → webhook → status → audit) is now the **production contract**. This plan hardens around that contract without redesigning it.

## Guiding rules

- **Do not** change any field in the successful Submit Order payload.
- **Do not** refactor the webhook processor — only verify.
- Anything experimental (variance submits, payload mutation, multi-submit) must be gated behind `SRS_DEBUG_MODE=true` **or** an explicit Platform Admin toggle.
- Open contract questions are **documented only**, not coded.

---

## Work items

### 1. Freeze the Submit Order payload
- Lock the current builder in `supabase/functions/_shared/srs/orderPayloadBuilder.ts` (and any call sites in `srs-api-proxy` / `srs-order-submit`).
- Add a snapshot test that pins the exact field set: `sourceSystem, customerCode, accountNumber, branchCode, shipToSequenceNumber, transactionID, transactionDate, shipTo, poDetails, orderLineItemDetails, customerContactInfo`.
- Assert line items **omit** `price` and top-level `jobAccountNumber` stays absent.
- Any future change to this shape must delete/replace the snapshot deliberately.

### 2. Remove QA retry/variance logic from production
- Audit `srs-api-proxy`, `srs-order-submit`, and `_shared/srs/*` for:
  - Automatic payload mutation after queue responses
  - Automatic variance re-submits
  - Multi-submit fallbacks
- Wrap each behind `isSrsDebugModeEnabled(tenantId)` which is `true` only when:
  - `Deno.env.get("SRS_DEBUG_MODE") === "true"`, **or**
  - A Platform Admin has flipped `tenant_settings.srs_debug_mode` (new boolean, defaults `false`).
- Production path: single submit, no mutation. Queue responses go to the existing poller/webhook path unchanged.

### 3. OAuth request encoding
- In `_shared/srs/oauthClient.ts`: send token requests as `application/x-www-form-urlencoded` **first**.
- Keep JSON as a fallback only if SRS returns a `415`/`400` indicating encoding issue.
- Preserve current token cache, expiry handling, and `srs_credential_audit` logging.

### 4. Transaction ID management
- Persist `transactionID`, `queueID`, `orderID` on `srs_orders` (already present — verify columns and backfill nullable ones).
- Transport-level retries (network timeouts, 5xx) reuse the **same** `transactionID`.
- Business retries (user-initiated resubmit) require an explicit UI confirmation and generate a new `transactionID` with an audit link back to the original.

### 5. Pre-submit validation layer
- Add `_shared/srs/preSubmitValidator.ts` that verifies before any SRS call:
  - Customer, branch, job account resolved and active
  - Product IDs exist in `abc_catalog_items`/SRS catalog cache
  - Catalog membership for the branch
  - Shipping method, UOM, delivery method
  - Contact + shipping address complete
  - Expected delivery date present and in the future
- Reject with a structured `422` error envelope before touching SRS. Log rejections to `srs_submit_audit`.

### 6. Webhook — verify only, no changes
- Read-only audit of `srs-webhook` / `roofhub-webhook`. Confirm:
  - Duplicate detection + idempotency keys
  - Transaction/order/PO matching
  - Status history writes
  - Attachment + delivery document import
  - Invoice creation
  - Raw payload storage
- Produce a checklist in `docs/srs-webhook-verification.md`. No code changes.

### 7. Price API — TODO only
- Add a TODO in `docs/srs-open-questions.md`:
  - Confirm whether `/products/v2/price` should key on `productId` + `productName` + `productOptions` instead of `productNumber`.
- **No code changes** to pricing until SRS confirms.

### 8. Environment separation
- Introduce `SRS_ENVIRONMENT` = `production | qa | debug` (env + `tenant_settings.srs_environment`).
- Only `debug` unlocks payload experimentation, submit variances, and automatic retries.
- `qa` uses QA base URL + credentials; `production` uses prod URL + creds and locks experimental paths.

### 9. Documentation refresh
- Update `docs/srs-sips-integration-audit.md` and README sections:
  - Mark OAuth, Submit Order, Order ID, Webhook, Status Updates, Audit Logging as **VERIFIED via QA end-to-end**.
  - Remove stale "webhook TODO / missing callback" notes.

### 10. Integration Health Dashboard
- New master-admin surface `src/components/admin/SrsHealthDashboard.tsx` (mounted inside the existing SRS admin tab — **no new route/page**).
- Reads from a new `srs-api / GET /health` route inside the existing `srs-api` grouped function (no new edge function folder).
- Shows per-tenant status: Authentication, Customer, Branch, Job Account, Catalog, Price, Submit, Queue, Order ID, Webhook, Delivery, Invoice, Last Success, Last Error, Environment.

### 11. Production Readiness Report
- Add `docs/srs-production-readiness.md` covering all 17 sections listed in the brief plus the Outstanding Questions block.
- Add an in-app export button on the health dashboard that renders the same report as PDF.

---

## Outstanding questions (documented, not coded)

Recorded in `docs/srs-open-questions.md`:

1. `/products/v2/price` request contract — `productId` vs `productNumber`.
2. Non-color products: `option: "N/A"` vs empty string.
3. `transactionID` idempotency + recommended retry behavior.
4. Production webhook registration — global to `PITCH` SourceSystem or per-customer.
5. Confirm the QA-approved Submit Order payload (with `shipToSequenceNumber`, no top-level `jobAccountNumber`, no line-item price) is the authoritative PITCH contract.

---

## Technical notes

**Files to add**
- `supabase/functions/_shared/srs/preSubmitValidator.ts`
- `supabase/functions/_shared/srs/debugMode.ts`
- `supabase/functions/_shared/srs/__tests__/orderPayload.snapshot.test.ts`
- `src/components/admin/SrsHealthDashboard.tsx`
- `docs/srs-open-questions.md`
- `docs/srs-production-readiness.md`
- `docs/srs-webhook-verification.md`

**Files to edit**
- `supabase/functions/_shared/srs/oauthClient.ts` — form-urlencoded first.
- `supabase/functions/_shared/srs/orderPayloadBuilder.ts` — freeze + snapshot hook.
- `supabase/functions/srs-api/*` — add `/health` route, gate variance behavior.
- `supabase/functions/_shared/srs/submitOrder.ts` (or equivalent) — remove auto-variance from prod path.
- `docs/srs-sips-integration-audit.md` — mark VERIFIED.
- `src/components/admin/SrsAdminSurfaces.tsx` — mount health dashboard tab.

**Migration**
- `tenant_settings`: add `srs_environment text default 'production'`, `srs_debug_mode boolean default false`. Both master-admin-only writable (RLS via existing `has_role(auth.uid(),'master')` policy pattern).

**Architecture-guard compliance**
- No new standalone edge functions. Health endpoint lives inside existing `srs-api`.
- All new routes declare auth mode: authenticated tenant route (`requireAuth` + `requireTenant`) for health, master-only for debug toggles.
- Server resolves tenant from JWT; never trusts client body.

**Zero-change guarantees**
- Submit payload byte-for-byte identical to the QA-verified run.
- Webhook processor untouched.
- Pricing endpoint untouched until SRS answers Q1.
