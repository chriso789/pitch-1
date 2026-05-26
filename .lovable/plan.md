# Cost Tracker Part C — Internal Secret + Hot-Path Wiring

Part A (schema + `platform-api` + dashboard shell) is shipped. This plan completes the secret plumbing, wires `trackUsage()` into real cost hot paths, and adds the rollup cron.

## 1. Internal Worker Secret

- Add `secrets--add_secret` request for `INTERNAL_WORKER_SECRET` (you paste the value — `openssl rand -hex 32` or any 64-char random string, prefixed `PITCH_INTERNAL_WORKER_` if you want).
- Add route `GET /platform-api/internal-secret-status` (master-only) returning `{ configured: boolean }`. Never returns the value.
- Add dashboard card **Internal Worker Secret** on `/developer/cost-tracker`:
  - Shows Configured / Missing badge.
  - If missing, shows step-by-step Supabase Secrets instructions and a "Generate suggested value" button (client-side `crypto.getRandomValues` → hex string, copy-to-clipboard, one-time display). Does NOT write the value anywhere — user pastes into Supabase Secrets manually.

No per-company secret. Tenant attribution is via `company_id` only.

## 2. Harden `platform-api` validation

Update `/track-usage` and `/check-usage-limit` to accept EITHER:
- master/platform admin JWT, OR
- header `x-internal-secret` matching `INTERNAL_WORKER_SECRET`.

If secret env var is missing, log warning and reject internal calls with 503 `secret_not_configured` (the helper handles this as a no-op so callers never throw).

## 3. Update `_shared/track-usage.ts`

- `trackUsage(payload)` — fire-and-forget. Reads `INTERNAL_WORKER_SECRET`; if missing, `console.warn` and return. Sends `x-internal-secret` header. Never sends `unit_cost` / `estimated_cost` — server computes from `provider_costs`.
- `checkUsageLimit({ company_id, event_type, quantity })` — synchronous. If secret missing:
  - SMS / mass-send / roof-report / expensive AI → return `{ allowed: false, reason: "secret_not_configured" }` (fail-closed).
  - Low-cost logging (storage, edge invocation, map load) → return `{ allowed: true, warn: true }`.
- Always carries `company_id` + `user_id` when caller provides them.

## 4. Company-id resolution helper

New `_shared/resolve-company-id.ts`:
1. Use explicit `company_id` if given.
2. Else look up via `user_id → user_company_access`.
3. Else derive from `contact_id` / `lead_id` / `job_id` / `pipeline_entry_id` when present in payload.
4. Else write event with `company_id = null` + `metadata.needs_company_resolution = true`.

## 5. Hot-path wiring (priority order)

Wired with `trackUsage()` + (where noted) pre-flight `checkUsageLimit()`:

| # | Path | File(s) | Provider / event_type |
|---|---|---|---|
| 1 | Outbound SMS | `messaging-api` `/sms/send` route + `telnyx-send-sms` shim | telnyx / `sms_outbound` (quantity = segments) — pre-check limit |
| 2 | Inbound SMS | `telnyx-sms-webhook` | telnyx / `sms_inbound` |
| 3 | Voice / call | `telnyx-call-webhook` (or `bridge-calls` end handler) | telnyx / `voice_minute` (quantity = duration_minutes) |
| 4 | AI generation | `_shared/ai/*` callers (estimate, supplement, doc-parse, sms-rewrite, email-rewrite, call-summary, roof-report-parse, permit-parse) | openai / `ai_generation` + `ai_tokens_input` + `ai_tokens_output` — pre-check on expensive ones |
| 5 | Storage uploads | `_shared/storage-upload.ts` server-side wrapper + `safeStorageUpload` client telemetry beacon | supabase / `storage_mb` |
| 6 | Heavy edge functions | wrap top-of-handler in `start-ai-measurement`, `measurement-worker`, `pdf-compile`, `bulk-sms-blast` | supabase / `edge_invocation` |
| 7 | Map loads | `useMapboxMap` hook on init (debounced) | mapbox / `map_load` |
| 8 | Permit scraping | `permits/*` scraper edge fn | firecrawl|serpapi / `scrape_credit` — pre-check |
| 9 | Roof reports | `roofr-order-report`, `eagleview-order-report` | roofr|eagleview / `roof_report` — pre-check |
| 10 | Estimate/supplement gen | `generate-estimate-ai`, `generate-supplement-ai` | openai / `ai_estimate_generation` |

Every event includes `status`: `success` | `failed` | `blocked_limit` | `provider_error` | `skipped_missing_secret`.

## 6. Dashboard additions on `/developer/cost-tracker`

- **Internal Secret Status** card (from §1).
- **Unassigned Usage Events** card — count + drill-down for `company_id IS NULL`.
- **Company Attribution Health** — assigned / unassigned / % over last 30d.
- **Hot Path Coverage Checklist** — green/red per row in §5, based on whether ≥1 event of that type was seen in last 30d (live query against `usage_events`).

## 7. Rollup cron

Add `pg_cron` job (via `supabase--read_query` for safety, not migration — contains URL+anon) calling `platform-api/recalculate-rollups` daily at 02:00 UTC with `x-internal-secret`.

## 8. Explicitly NOT doing this loop

- No removal of AI Admin Command Center.
- No drop of `ai_conversations` / `ai_messages`.
- No deletion of AI workflow tables / functions.
- Open-ended chat UI removal deferred until 7–14 days of cost data exists.

## Order of execution

1. Request `INTERNAL_WORKER_SECRET` via `secrets--add_secret`. Wait.
2. Update `platform-api` validation + add `/internal-secret-status`.
3. Update `_shared/track-usage.ts` + add `_shared/resolve-company-id.ts`.
4. Wire hot paths #1–#4 (highest cost first), test each with `seed-test-event` + real call.
5. Wire #5–#10.
6. Dashboard cards.
7. `pg_cron` schedule.
8. Smoke test: trigger one event per provider, confirm rows land with correct `company_id` and `status`.

## Technical notes

- All edge code uses existing `_shared/router.ts`, `_shared/auth.ts`, `_shared/tenant.ts`, `_shared/env.ts`. No new standalone edge functions — everything lives in `platform-api` or inside existing grouped routers per the architecture guard.
- Frontend dashboard reads through `edgeApi("platform-api", "/...")`.
- Client-only secret generation in §1 uses `crypto.getRandomValues(new Uint8Array(32))` → hex; never sent to server, never persisted.
