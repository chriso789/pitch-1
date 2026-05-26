
# PITCH CRM — Infrastructure Cost Tracker & AI Chat Removal

A large two-part build. Shipping in ordered phases so each piece is reviewable and reversible. Before I start writing migrations and edge functions, I want to confirm scope and a few decisions that materially affect the implementation.

---

## Part A — Cost Tracking & Profitability System

### A1. Database (one migration)

New tables in `public`:

- **provider_costs** — pricing catalog (provider, event_type, unit, cost_per_unit, markup_percent, is_active). Seeded with the 18 rows you listed.
- **usage_events** — append-only event log (company_id, user_id, provider, event_type, feature_area, quantity, unit, unit_cost, estimated_cost, billable_amount, request_id, edge_function, status, metadata, created_at). Indexed on company_id, user_id, provider, event_type, feature_area, created_at.
- **company_usage_limits** — per-tenant plan + monthly caps + `hard_stop_enabled` + `warning_threshold_percent`. Default plan `basic_50` auto-provisioned for each existing company via backfill.
- **company_usage_monthly_rollups** — unique on (company_id, month).
- **user_usage_monthly_rollups** — unique on (company_id, user_id, month).

RLS:
- New SECURITY DEFINER helper `public.is_platform_admin(uuid)` checking the existing master/COB role via `has_role` (not a new role table — reusing what's already there).
- All five tables: SELECT/INSERT/UPDATE/DELETE locked to `is_platform_admin(auth.uid())`.
- `service_role` gets full access for edge functions.
- No `anon` grants anywhere.
- GRANTs explicitly included for every new table.

### A2. Edge functions

Following your route-migration enforcer (no new standalone folders for one-off endpoints), I'll put these inside an existing or new grouped router:

- **`platform-api`** (new grouped router, developer-only): routes `/track-usage`, `/check-usage-limit`, `/recalculate-rollups`, `/seed-test-event`, `/get-cost-dashboard`, `/list-company-usage`, `/get-company-detail`, `/update-provider-cost`. All routes require platform-admin JWT except `/track-usage` and `/check-usage-limit`, which require **either** platform admin OR `INTERNAL_WORKER_SECRET` so other edge functions can call them server-to-server.

- **Cron**: `pg_cron` job every hour calls `/recalculate-rollups` (idempotent upsert).

Server-side cost calc only — client-provided `unit_cost`/`estimated_cost` is ignored.

### A3. Shared utility

`supabase/functions/_shared/track-usage.ts` exporting `trackUsage({...})` — fire-and-forget POST to `platform-api/track-usage` with `INTERNAL_WORKER_SECRET`, never throws into caller. I'll wire it into the highest-value hot paths only (not every function in one pass):

- `start-ai-measurement` and the measurement worker (AI tokens, edge invocations, roof reports)
- SMS send paths (Telnyx outbound/inbound webhooks)
- Telnyx voice webhook (minutes)
- OpenAI/Anthropic/Gemini callers in the shared AI helper

The remaining hooks (storage, map loads, scraping, document parsing) will be stubbed with TODO comments referencing the helper — wiring them all in one pass would touch 40+ files and exceed safe review size. I'll list them in the response so you can prioritize a follow-up loop.

### A4. Developer dashboard (frontend)

New route `/developer/cost-tracker` (gated by `is_platform_admin`, hidden from non-platform users in the nav). Pages:

1. **Overview** — MTD revenue, MTD cost, GP, GM%, per-provider spend cards, most-expensive company/user, daily trend chart (recharts).
2. **Companies table** — sortable, filterable (date range, provider, event_type, status), with profitability status badge (Good/Watch/Bad/Losing Money) using your thresholds.
3. **Company detail** — cost by provider, by feature, by user; daily trend; raw events; projected month-end; usage-limit progress bars.
4. **User detail** — totals, breakdowns, recent events.
5. **Provider Costs admin** — editable table (provider, event_type, cost_per_unit, markup_percent, active).
6. **Test tools** — buttons for Log Test AI/SMS/Upload Event, Recalculate Rollups, Verify $50 Profitability. All test events tagged `metadata.test = true`.

Data fetched via `edgeApi("platform-api", "/...")` — no direct table reads from frontend (RLS would block anyway, but explicit gate is cleaner).

---

## Part B — Remove General AI Chat Surfaces

This is the riskier half because the codebase has multiple AI-adjacent features. I want to confirm scope before deleting anything.

### B1. What I'd remove/disable (need your confirmation per item)

- Any floating "Ask AI" button / chat widget in the app shell
- AI copilot sidebar(s)
- Persistent chat thread UI / chat history pages
- AI command palette (if any "Ask AI" command exists)
- WebSocket streaming chat client
- Nav entries for AI chat
- Tables `ai_conversations` and `ai_messages` — **drop or just stop writing to them?** Dropping is destructive; recommended path is: stop UI + writes now, schedule table drop after a 30-day observation window per the schema-drift guard.

### B2. What I'd KEEP (your "good examples")

All structured AI actions stay: Generate Estimate, Rewrite SMS, Summarize Call, Analyze Roof Report, AI autofill, AI tagging, document parsing, roof report parsing, workflow automation, smart suggestions. These already exist as discrete actions, not chat — no changes needed beyond verifying none of them depend on the removed chat plumbing.

### B3. Special case — AI Admin Command Center

Project memory has `mem://features/ai-admin/command-center` documenting a **master-only chat tool for database and settings management**. That sounds like exactly the kind of "AI chat" you want removed, but it's also a master/COB power-user tool — not customer-facing AI burn.

**Question:** Does the chat removal apply to the master AI Admin Command Center too, or only to customer-tenant-facing chat?

---

## Questions before I start

1. **AI Admin Command Center** — remove it, or keep it as a master-only tool? (Memory says master-only.)
2. **`ai_conversations` / `ai_messages` tables** — stop writing now and drop after 30 days, or drop immediately?
3. **Platform admin identity** — I'll define `is_platform_admin()` as `has_role(uid, 'master')` (the existing COB role). Confirm that's the right gate, or do you want a separate `platform_admin` role?
4. **Hook coverage in pass 1** — OK to wire `trackUsage()` into AI/SMS/voice/measurement only this pass, with TODO stubs for storage/maps/scraping/docs in a follow-up? Or do you want all event types wired in one (much larger, harder to review) loop?

Once you answer those, I'll ship Part A migration + edge router + dashboard in one go, then Part B in a second loop.
