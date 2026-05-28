# ABC Integration — Re-Audit vs. Today's Repo

Verified against the live repo, not the May 14 plan.

## 1. What already exists (do NOT rebuild)

**Database (all present in `public`):**
`abc_integrations`, `abc_connections`, `abc_tokens`, `abc_oauth_states`, `abc_oauth_callback_logs`, `abc_credential_audit`, `abc_accounts`, `abc_branches`, `abc_items`, `abc_item_availability`, `abc_price_requests`, `abc_orders`, `abc_order_lines`, `abc_order_job_links`, `abc_invoices`, `abc_invoice_lines`, `abc_webhooks`, `abc_webhook_events`, `abc_api_audit`.

**Edge functions:**

- `abc-api-proxy/` (index.ts + handler.ts) — working shim
- `abc-oauth-callback/` — public OAuth redirect
- `supplier-api/abc-proxy-handler.ts` — grouped proxy handler
- `supplier-webhook/index.ts` — grouped function, scaffolded

**Frontend:**

- `src/components/settings/ABCConnectionSettings.tsx` — sandbox connect flow, working
- `src/components/settings/AbcDiagnosticsPanel.tsx` — already accepts `projectId` prop and self-filters on `job_id`/`estimate_id` (line 82, 106–111)
- `src/components/orders/PushToSupplierDialog.tsx` — ABC branch already wired, calls `abc-api-proxy` with `action: 'submit_order'`
- `src/components/orders/ProjectMaterialsTab.tsx` — mounts `PushToSupplierDialog` + `SrsDiagnosticsPanel`

**Docs:** `docs/ABC_DEMO_READINESS.md`, `docs/ABC_WAF_ALLOWLIST.md` both present.

## 2. Partially built

- `supplier-webhook/index.ts` — exists as routed function but only has `/srs/orders` and `/qxo/orders` returning 501. No `/abc/events` route at all.
- `abc_webhook_events` table exists, but nothing writes to it (no receiver).

## 3. Missing

- Project-scoped ABC diagnostics card on the Materials tab (panel exists in Settings only).
- `POST /abc/events` route inside `supplier-webhook` (ingestion, dedupe, tenant resolution, order/invoice updates).
- Verified ABC webhook signature contract (header name, algorithm, payload format).

## 4. Obsolete from the May 14 plan

- "14 new standalone edge functions" — replaced by grouped `supplier-api` + `abc-api-proxy` shim + `supplier-webhook`. Do not recreate.
- Separate `abc-webhook` standalone function — forbidden by the architecture guard; route lives inside `supplier-webhook`.
- New `abc-*` tables to be "created in Phase 1" — already created.
- Frontend `src/features/abc-supply/` module rewrite — superseded by existing `ABCConnectionSettings` + `AbcDiagnosticsPanel` + `PushToSupplierDialog`.

## 5. Must do before Sandy's demo

**Priority 1 — UI mount (no DB, no edge changes)**

- Edit `src/components/orders/ProjectMaterialsTab.tsx`: import `AbcDiagnosticsPanel` from `@/components/settings/AbcDiagnosticsPanel` and render `<AbcDiagnosticsPanel projectId={projectId} />` directly under the existing `<SrsDiagnosticsPanel projectId={projectId} />`.

**Priority 2 — Webhook receiver (gated on docs verification)**

Step 2a (research, no code): confirm from ABC partner docs:

- exact signature header name (e.g. `X-ABC-Signature` vs `X-Signature`)
- exact algorithm (HMAC-SHA256 raw vs `sha256=` prefix vs JWT)
- canonical payload-signing procedure
- retry/backoff behavior
- webhook registration API endpoint and event-type catalog

Step 2b (after 2a): add `POST /abc/events` to `supabase/functions/supplier-webhook/index.ts`:

- Public route (no `requireAuth`/`requireTenant`).
- Verify signature using the algorithm confirmed in 2a — do **not** assume generic HMAC.
- Resolve tenant server-side: look up `abc_orders` / `abc_webhooks` row by ABC order/account id from payload; never trust `tenant_id` from body. Quarantine if not resolvable.
- Idempotent upsert into `abc_webhook_events` keyed on provider event id (add unique index if missing).
- Dispatch by event type → update `abc_orders.status`, insert/update `abc_invoices` + `abc_invoice_lines`, append delivery timestamps.
- Write `abc_api_audit` row for every receipt (success, sig-fail, quarantine).
- Return 200 only after persistence; 401 on bad signature; 202 on quarantine.

**Secret needed before 2b:** `ABC_WEBHOOK_SIGNING_SECRET` (sandbox first). Ask user to add when 2a is confirmed.

## 6. After-demo (do not block Sandy)

- Webhook registration automation (call ABC's webhook-register endpoint from a worker instead of manual portal entry).
- `abc-token-refresh-scheduler` via `pg_cron` if not already covered by current refresh path.
- Invoice PDF fetch worker (`abc_invoices.pdf_url` backfill).
- Production environment toggle and admin gate (currently sandbox-only is correct).
- Memory entry + `docs/abc-supply-integration.md` consolidation.

## Architectural guardrails enforced

- No new standalone edge function.
- Webhook route is public, signature-verified, tenant resolved server-side from lookup row, audit-logged.
- Frontend push flow unchanged.
- No DB migrations required for Priority 1; Priority 2 may add one unique index on `abc_webhook_events(provider_event_id)` if not already present — will verify before writing the migration.

## Decision gate

Approve Priority 1 → I ship it immediately (single-file UI edit).
Priority 2 waits until you (or I, via web search of ABC partner docs) confirm the signature contract. Say the word and I'll search the ABC partner docs first.  
  


```
Approved.

Execute Priority 1 immediately:

1. Edit:
src/components/orders/ProjectMaterialsTab.tsx

2. Import:
import { AbcDiagnosticsPanel } from "@/components/settings/AbcDiagnosticsPanel";

Use the correct export style from the existing component.

3. Render:
<AbcDiagnosticsPanel projectId={projectId} />

directly under:
<SrsDiagnosticsPanel projectId={projectId} />

4. Do not change the existing PushToSupplierDialog flow.
5. Do not change the ABC submit_order payload.
6. Do not change database schema.
7. Do not add new edge functions.
8. Deploy and verify that the project Materials tab now shows ABC Submit Diagnostics for that project.

Acceptance:
- Open project → Materials tab.
- Confirm Materials list exists.
- Confirm Push To Supplier still exists.
- Confirm SRS diagnostics still exists.
- Confirm ABC Submit Diagnostics now appears under SRS diagnostics.
- Push ABC sandbox order from the project.
- Confirm confirmation number appears in project-scoped ABC panel.
- Confirm Inspect and Refresh Status work from the project page.

Priority 2 is approved only after webhook docs verification.

Before writing the /abc/events route, search/verify the official ABC webhook docs and confirm:
- webhook registration endpoint
- exact callback URL expectations
- exact event types
- exact signature header name
- exact signing algorithm
- exact payload canonicalization/signing method
- retry behavior
- expected response codes
- whether sandbox sends real webhook events

Do not assume generic HMAC-SHA256 unless ABC docs confirm it.

Once verified, implement inside:
supabase/functions/supplier-webhook/index.ts

Route:
POST /abc/events

Do not create a standalone abc-webhook function.

Required behavior:
- public route
- signature verified
- tenant resolved server-side only
- never trust tenant_id from payload
- insert abc_webhook_events
- dedupe provider event id
- update abc_orders status
- upsert abc_invoices / abc_invoice_lines for invoice events
- audit every receipt in abc_api_audit
- quarantine unresolved tenant/order events
- return correct response codes based on ABC docs

Secret:
Use ABC_WEBHOOK_SIGNING_SECRET only after ABC confirms the signing contract.

Report back after Priority 1 with:
- file changed
- deploy status
- screenshot/result confirming ABC Submit Diagnostics appears in project Materials tab
- whether project-level ABC Send to Supplier still works
```

For Sandy’s demo, this gives you the right project-level story without overbuilding before you know ABC’s exact webhook contract.