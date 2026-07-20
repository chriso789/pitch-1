
# QuickBooks Online Production Cutover — Audit + Execution Plan

## Phase 1 findings (verified against runtime code + live DB, not docs)

### Edge functions (11 QBO functions)

| Function | LOC | State | Host resolution | Minor version | Notes |
|---|---|---|---|---|---|
| `qbo-worker` | **18** | **501 scaffold** | n/a | n/a | Frontend already calls 5 routes on this. Every call returns 501 today. |
| `qbo-oauth-connect` | 684 | Live | `getQboContextForMode` / `getQboContextForConnection` | 75 | Correct env split. |
| `qbo-api` | 24 | Thin | — | — | Router placeholder. |
| `qbo-customer-sync` | 268 | Live | `qboHost(connection)` → `getQboContextForConnection` | 75 | OK. |
| `qbo-invoice-create` | 389 | Live | `qboHost(connection)` | 75 | OK. |
| `qbo-invoice-send` | 252 | Live | `qboHost(connection)` | 75 | OK. |
| `qbo-fetch-items` | 141 | Live | `getValidAccessToken` | 75 | OK. |
| `qbo-check-projects-api` | 118 | Live | `qboHost(connection)` | 75 | Preferences probe only. |
| `qbo-sync-payment` | 158 | Live | — | — | Needs re-verify vs. new mapping model. |
| `qbo-webhook-handler` | 369 | Live | `qboHost(connection)` | 75 | Verifier per env — OK. |
| `qbo-webhook` | 17 | Thin | — | — | Placeholder. |

**Hardcoded-host / `USE_SANDBOX` grep:** only remaining occurrences are inside `_shared/qbo-context.ts` (the resolver itself), the test file, and `qbo-worker/README.md`. No runtime code branches on `USE_SANDBOX`. Legacy `QBO_ENVIRONMENT` is still read once as a fallback inside `getDefaultQboMode()` — allowed by design.

**Token/secret logging:** `_shared/qbo-api.ts:129` masks `access_token|refresh_token|authorization|bearer|client_secret|verifier` in the log redactor. No offenders found.

### Frontend call sites already targeting `qbo-worker`

- `src/features/projects/components/ProjectDetails.tsx:115`
- `src/components/jobs/QuickBooksInvoiceManager.tsx:109, 147`
- `src/components/settings/LocationSelector.tsx:85` (`op: "setLocation"`)
- (plus `QuickBooksInvoiceCard.tsx` still uses `qbo-invoice-create` directly)

**All five frontend paths currently receive HTTP 501.** This is user-visible today.

### Database (verified live)

Tables present: `qbo_connections`, `qbo_entity_mapping`, `qbo_location_map`, `qbo_api_logs`, `qbo_connection_tests`, `qbo_oauth_state`, `qbo_expenses`, `qbo_payment_history`, `qbo_sync_errors`, `qbo_webhook_events`, `qbo_webhook_journal`, `job_type_item_map`, `invoice_ar_mirror`.

Gaps vs. the spec:

- `qbo_entity_mapping` unique key is `(tenant_id, entity_type, entity_id, realm_id)` — collapses Customer/Project/Invoice/Payment into one row per Pitch entity. Needs relaxing so one Pitch project can hold {Customer, Project|SubCustomerJob, Invoice, Payment} rows in parallel. Table currently holds **0 rows**, so migration is safe.
- No `tenant_qbo_settings` table for `project_mapping_mode`, `invoice_numbering_mode`, `customer_visible_project_number`, default account/item/tax/dept/class.
- `invoice_ar_mirror` is missing `pitch_invoice_id`, `sync_token`, `tax_amount`, `deposit_amount`, `email_status`, `txn_date`, `due_date`.
- No `qbo_payment_mapping` or dedicated payment ledger separation from crew payouts.

## Stop-condition status vs. your spec

| Stop condition | Current state |
|---|---|
| `qbo-worker` remains 501 | **HIT** — cannot claim complete. |
| Production credentials absent | Unknown — need `fetch_secrets` check. |
| Redirect URI mismatch | Only verifiable in Intuit portal — manual step. |
| Webhook verifier absent | Split verifiers referenced; presence per env not yet asserted. |
| Project mapping overwrites invoice mapping | **Currently possible** — same-key collision in `qbo_entity_mapping`. |
| Native Project API assumed w/o entitlement | `qbo-check-projects-api` exists but result not gated in worker. |
| Required job type has no QBO Item mapping | No block enforced yet. |
| Sandbox invoice traceable to one Pitch project UUID | Not yet — no `pitch_invoice_id` column on mirror. |

## Execution plan (phased — approve to proceed)

### Sub-plan A — schema (single migration reviewable in isolation)
- Rebuild `qbo_entity_mapping` unique key to `(tenant_id, realm_id, pitch_entity_type, pitch_entity_id, qbo_entity_type)`. Add `pitch_entity_type`, `pitch_entity_id` columns as aliases, backfill from existing `entity_type`/`entity_id` (empty table → trivial), keep old cols for a shim window. Add `pitch_project_number`, `qbo_doc_number`, `sync_token`, `mapping_mode`.
- New `tenant_qbo_settings` (one row per tenant×realm): `project_mapping_mode`, `invoice_numbering_mode`, `customer_visible_project_number`, `default_income_account_id`, `default_item_id`, `default_tax_code_id`, `default_department_id`, `default_class_id`. RLS: tenant-scoped read/write.
- Extend `invoice_ar_mirror`: `pitch_invoice_id uuid`, `sync_token text`, `tax_amount numeric`, `deposit_amount numeric`, `email_status text`, `txn_date date`, `due_date date`.
- Grants + RLS policies + `NOTIFY pgrst`.

### Sub-plan B — `qbo-worker` real routes (replace 18-line scaffold)
Routes, all `requireAuth` + `requireTenant`, body `tenant_id` ignored:
- `POST /sync-project` — resolve/create QBO Customer, then native Project (if `ProjectsEnabled` + scope), else SubCustomerJob fallback. Deterministic. Persists mapping mode.
- `POST /create-invoice` — reads approved Pitch invoice/estimate lines, resolves each via `job_type_item_map`, blocks on unmapped types unless `default_item_id` is set. Writes separate `Invoice` mapping row. Honors `invoice_numbering_mode`.
- `POST /sync-payment-status` — polls a QBO Invoice, updates AR mirror + Pitch invoice status.
- `POST /refresh-ar` — pulls balance/status for all mapped invoices for a tenant, tenant-scoped.
- `POST /set-location` — upserts `qbo_location_map` for active location.
- `GET /preflight` — redacted readiness report per Phase 9.
- `GET /__health` — retained.

### Sub-plan C — payment resolver
Rework `qbo-webhook-handler` payment path + `qbo-sync-payment` to (1) fetch Payment, (2) walk `Line[].LinkedTxn`, (3) resolve QBO Invoice → Pitch invoice via new mapping, (4) write `qbo_payment_mapping` row, (5) update AR mirror + Pitch invoice `amount_paid`/`balance_due`/`payment_status`/`last_payment_at`. **Never touch crew payout ledger.**

### Sub-plan D — Settings UI: Job & Item Mapping
Extend the existing `JobTypeQBOMapping` panel with per-mapping Class, Department, taxable flag, default description, active toggle. Add tenant defaults section (from `tenant_qbo_settings`). Add "Unmapped Types" warning banner. Route "Test Mapping" through `qbo-worker /preflight`.

### Sub-plan E — Frontend migrations
Retire direct `qbo-invoice-create` invocation in `QuickBooksInvoiceCard.tsx` in favor of `qbo-worker /create-invoice`. Update the three existing `qbo-worker` callers to the real route names.

### Sub-plan F — Tests
Deno tests per Phase 12. Run `supabase--test_edge_functions` after each sub-plan.

### Sub-plan G — Sandbox evidence + production cutover
Only after A–F land green. Requires the user to (i) confirm production credentials via `fetch_secrets`, (ii) verify Intuit portal redirect URI + webhook, (iii) run the deterministic $1 test project. I will not flip `QBO_DEFAULT_ENVIRONMENT` to `production` without your explicit go.

## What I need from you to proceed

1. **Approve Sub-plan A** first (schema is the blast-radius foundation and must land before worker logic).
2. Confirm you want me to proceed sub-plan by sub-plan (safer, each is reviewable) rather than jamming A–F into one turn (which will hit tool-call and review-fatigue limits and violate your own "do not overclaim" rule).
3. Confirm whether `QBO_CLIENT_ID_PRODUCTION` / `QBO_CLIENT_SECRET_PRODUCTION` / `QBO_REDIRECT_URI_PRODUCTION` / `QBO_WEBHOOK_VERIFIER_PRODUCTION` are already set (I'll verify via `fetch_secrets` before Sub-plan G — no values leave the sandbox).

Reply **"go A"** to start with the schema migration.
