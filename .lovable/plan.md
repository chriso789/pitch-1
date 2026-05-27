# Cost Tracker — Full Build Plan

The scaffold already exists (`src/pages/developer/CostTrackerPage.tsx`, 23 platform-api routes, rollups, limit checks, partial tracking). This plan finishes the developer dashboard, adds the missing routes, and patches the worst tracking blind spots.

## 1. Backend (platform-api) — add/verify routes

All routes master-only (`requireAuth + requireMaster`), JSON envelope, no client `tenant_id` trust.

New routes to add to `supabase/functions/platform-api/index.ts`:

- `GET  /users` — paginated user usage table (joins `user_usage_monthly_rollups` + profiles + companies).
- `GET  /user-detail` — already exists; extend with provider/feature breakdown + event timeline.
- `GET  /feature-breakdown` — aggregates `usage_events` by `feature_area` for month/range.
- `GET  /provider-breakdown` — aggregates by provider/event_type for month/range.
- `GET  /unassigned-events` — `usage_events` where `tenant_id is null` or `metadata->>needs_company_resolution = 'true'`, with suggested resolution (user/contact/job/report id present).
- `POST /usage-events/assign-company` — manual resolution; writes `tenant_id` + `metadata.manual_resolution=true`, audit log.
- `POST /company-usage-limits/update` — upsert into `company_usage_limits` with plan template support.
- `POST /seed-test-event` — extend to accept `type` (ai|sms|upload|map|scrape|roof|edge|blocked), all stamped `metadata.test=true`.
- `GET  /coverage-checklist` — verify returns 200; extend to compute per-row status from real `usage_events` counts in last 30 days + `metadata.tracker_files` static list.
- `GET  /dashboard` — extend: add `$50 plan viability` block, prev-period comparison, by-feature totals.
- `GET  /companies` — extend with all limit columns, status enum (`good|watch|bad|losing_money|over_cost|no_data`), filters.
- `GET  /company-detail` — extend with provider breakdown, feature breakdown, user breakdown, projected month-end, raw events page.

Each new route gets validation, master gate, and uses service-role client with explicit `.eq('tenant_id', …)` where applicable.

## 2. Frontend API client

Create `src/lib/developer/costTrackerApi.ts` wrapping every route via `edgeApi("platform-api", …)`. Typed responses. Replaces ad-hoc calls in `CostTrackerPage.tsx`.

## 3. UI components

Split current monolithic page into a tabbed dashboard at `/developer/cost-tracker`.

New files under `src/components/developer/cost-tracker/`:

- `CostTrackerHeader.tsx` — title, subtitle, date controls (month / range / quick filters), top actions (Refresh, Recalculate, Export CSV, Seed Test Events, Internal Secret).
- `CostKpiCards.tsx` — 12 KPI cards + `$50 Plan Viability` callout, status colors via semantic tokens.
- `CompaniesCostTable.tsx` — full profitability table with status badges, filters (plan/status/over-limit/losing/unassigned), row actions.
- `CompanyCostDrawer.tsx` — Sheet-based detail: profitability, provider breakdown, feature breakdown, user breakdown, limits progress bars, raw events, recommendations.
- `UsersCostTable.tsx` + `UserCostDrawer.tsx` — user view + drawer with timeline.
- `ProviderCostsTable.tsx` + `ProviderCostEditor.tsx` — editable provider pricing via `/provider-costs/update`.
- `FeatureBreakdownGrid.tsx` — feature cards (Comms, AI Gen, AI Tokens, Storage, Maps, Scraping, Reports, Automations, Edge) + feature table.
- `UsageLimitsEditor.tsx` — company selector, editable limits, plan templates (Basic $50, Starter $399, Growth $799, Enterprise), Apply Template + Save buttons, overage warnings.
- `CoverageChecklist.tsx` — checklist with status pills + "Run Coverage Audit" button hitting `/coverage-checklist`.
- `UnassignedUsageEventsTable.tsx` — table + assign-company dialog + ignore/mark-resolved.
- `InternalSecretCard.tsx` — status, generate-locally, copy-once, Supabase setup steps.
- `RollupSettingsCard.tsx` — Manual recalc + cron guidance.
- `TestEventsPanel.tsx` — buttons for each seed type, Danger Zone (clear test events, recalc all rollups, export CSV).

Page shell:

- `src/pages/developer/CostTrackerPage.tsx` rewritten to use `<Tabs>` (Overview, Companies, Users, Providers, Features, Limits, Coverage, Unassigned, Settings) and the new components.
- Loading skeletons, toasts on errors, no raw color classes (only semantic tokens).

## 4. Access control

- Reuse existing `useIsMaster()` / master role hook in the page; render `AccessDenied` state for non-masters and skip all data fetches.
- Route already gated in router; verify and lazy-load.

## 5. Tracking blind-spot fixes

Surgical, no behavior change:

- **Raw AI gateway** — wrap remaining `ai.gateway.lovable.dev` fetches in listed files with `trackUsage({ provider:'lovable-ai', event_type:'ai_generation' })` (plus token counts when response includes `usage`). Where safe (workers, simple chat), swap to `generateAIResponse`. Files in the user's list.
- **Maps** — add `useMapLoadTracker` to `DispatchMap`, `InteractiveMapCanvas`, `LiveLocationMap`.
- **Scraping** — wrap Firecrawl / SerpAPI / permit scrape calls with `trackUsage` (`provider:'firecrawl'|'serpapi'`, `event_type:'scrape'`).
- **Roof / measurement** — add `trackUsage` to `parse-roof-report`, `roof-report-ingest`, `start-ai-measurement`, `parse-roof-report-geometry`, `unified-measurement-pipeline`, `roof-segmentation`, `generate-roofr-style-report`.
- **Edge invocation** — add `trackUsage({ event_type:'edge_invocation' })` at top of listed heavy functions, tagged with `feature_area`.

All wrappers use existing `_shared/usage-tracking` helpers and never block on tracking failures.

## 6. Acceptance verification

After build:

- `/developer/cost-tracker` loads as master, shows tabs, no console errors.
- Non-master sees access-denied.
- `/coverage-checklist`, `/dashboard`, `/companies`, `/users`, `/feature-breakdown`, `/provider-breakdown`, `/unassigned-events` all return 200 for master.
- Seed test event → appears in `usage_events` with `metadata.test=true`, rollups update after Recalculate.
- $50 viability card flags companies > $10.
- CSV export downloads.
- Limits editor persists via `/company-usage-limits/update`.

## Technical notes

- Service-role queries in new routes always filter by `tenant_id` explicitly; reads scoped to month via `usage_events.created_at` index.
- `/unassigned-events` excludes rows with `metadata.test=true` unless toggled.
- Plan templates are constants in `src/lib/developer/planTemplates.ts` (reused by Limits editor + recommendations engine).
- Recommendations engine (`getCompanyRecommendations`) is pure client-side from company detail payload — no extra route.
- CSV export is client-side from currently loaded rows (no new route).
- Use shadcn `Sheet` for drawers, `Tabs` for top nav, `Progress` for limit bars, `Badge` for status, `sonner` for toasts.
- All colors via `text-emerald-*` style tokens already wired into the design system; status helpers centralized in `src/components/developer/cost-tracker/status.ts`.

## Out of scope (explicit)

- No production data deletes.
- No destructive rollup wipes.
- No exposure of provider keys or internal secret value (only configured/missing status).
- No changes to billing/Stripe.
- No new cron infra (just guidance card).  
  
The plan is solid, but I would **not approve it exactly as written**. It is 85% right, but it has a few problems that will create rework or false confidence.
  ## What is good
  The plan correctly focuses on the real missing pieces:
  1. **Full UI build-out**  
  It breaks the cost tracker into real tabs, components, drawers, filters, limits, coverage, provider pricing, and unassigned events. That is what you need.
  2. **Backend route expansion**  
  The missing endpoints are the right ones:
    - `/users`
    - `/feature-breakdown`
    - `/provider-breakdown`
    - `/unassigned-events`
    - `/usage-events/assign-company`
    - `/company-usage-limits/update`
  3. **Cost visibility**  
  The $50 plan viability card is critical. That needs to be front and center.
  4. **Access control**  
  It correctly says master-only, no provider-cost exposure, and no client tenant trust.
  5. **Blind spot tracking**  
  It correctly calls out raw AI gateway calls, maps, scraping, roof reports, and heavy edge functions.
  ## What I would change before approving
  ### 1. It says “no client tenant_id trust,” but then allows client-driven assignment
  This part is fine only if tightly controlled:
  ```

  ```
  ```
  POST /usage-events/assign-company
  ```
  But it needs an audit trail. Add this:
  ```

  ```
  ```
  Create usage_event_resolution_audit table or insert audit event whenever a developer manually assigns a tenant_id.
  Track:
  - usage_event_id
  - old_tenant_id
  - new_tenant_id
  - resolved_by_user_id
  - reason
  - created_at
  ```
  Without audit, manual assignment can quietly rewrite financial data.
  ---
  ### 2. The plan should not call the scraper event type `scrape`
  Your seeded cost table likely uses:
  ```

  ```
  ```
  scrape_credit
  search
  ```
  But the plan says:
  ```

  ```
  ```
  event_type:'scrape'
  ```
  That will break costing unless `provider_costs` also has `scrape`.
  Change to:
  ```

  ```
  ```
  Firecrawl:
  provider: firecrawl
  event_type: scrape_credit

  SerpAPI:
  provider: serpapi
  event_type: search
  ```
  This matters because `/track-usage` calculates cost from `provider_costs`. Wrong event type = zero cost.
  ---
  ### 3. Add “zero-cost event warning”
  The UI should flag events where cost calculation failed.
  Add to Coverage or Providers tab:
  ```

  ```
  ```
  Show usage_events where estimated_cost = 0 but provider/event_type should be billable.
  ```
  This will catch:
  -   
  wrong provider names  

  -   
  wrong event types  

  -   
  missing provider_costs rows  

  -   
  inactive cost rows  

  This is a big one.
  ---
  ### 4. The plan says “All colors via text-emerald-* style tokens”
  That contradicts “no raw color classes.”
  Better instruction:
  ```

  ```
  ```
  Use existing semantic theme tokens where available. If status colors already use app-approved utility classes, keep them centralized in status.ts and do not scatter raw color classes across components.
  ```
  Otherwise Lovable may fight your existing design system.
  ---
  ### 5. Add pagination everywhere raw events are used
  Company detail raw events can get huge.
  Add:
  ```

  ```
  ```
  All event tables must be paginated server-side:
  - usage_events
  - users
  - companies
  - unassigned-events
  - raw company events
  ```
  Do not load thousands of events into the browser.
  ---
  ### 6. Add export limits
  CSV export from “currently loaded rows” is fine, but make it explicit:
  ```

  ```
  ```
  CSV export exports currently filtered/loaded rows only.
  For full export, add later as separate backend export route.
  ```
  Otherwise you will think you exported everything when you only exported page 1.
  ---
  ### 7. Add tenant/company terminology consistency
  Your code appears to use `tenant_id`, not `company_id`, in the latest platform-api. The plan switches between both.
  Add:
  ```

  ```
  ```
  Use tenant_id as the canonical database field.
  Accept company_id only as an alias at API boundaries.
  All rollups, joins, filters, and updates should use tenant_id internally.
  ```
  This avoids bugs.
  ---
  ### 8. Add route response contracts
  The plan says “typed responses,” but not the response shapes. Lovable may wing it.
  Add minimum contracts for:
  - `/dashboard`  

  - `/companies`  

  - `/company-detail`  

  - `/users`  

  - `/coverage-checklist`  

  - `/unassigned-events`  

  Even simple shapes are enough.
  ---
  ### 9. Do not add “clear test events” unless it is soft-delete or test-only
  The danger zone says:
  ```

  ```
  ```
  Clear test events only
  ```
  That is okay, but add:
  ```

  ```
  ```
  Only delete or archive events where metadata.test = true.
  Never delete production usage_events.
  Prefer marking test events ignored over hard delete if simple.
  ```
  ---
  ### 10. Add a “data freshness” indicator
  Rollups are not real-time unless recalculated.
  Add to UI:
  ```

  ```
  ```
  Show last rollup recalculation timestamp.
  Show warning if rollups are older than 24 hours.
  ```
  Otherwise you may make pricing decisions from stale totals.
  ---
  ## Revised approval note to send back
  Send this to Lovable:
  ```

  ```
  ```
  Plan approved with required adjustments before build:

  1. Use tenant_id as canonical. company_id is only an API alias.
  2. Add audit logging for manual usage event company assignment.
  3. Firecrawl must use event_type scrape_credit. SerpAPI must use event_type search. Do not use generic scrape unless provider_costs has that row.
  4. Add zero-cost event warnings where estimated_cost = 0 but provider/event_type should be billable.
  5. Raw usage event tables must be server-side paginated.
  6. CSV export only exports currently filtered/loaded rows; label it clearly.
  7. Add last rollup recalculation timestamp and stale-data warning.
  8. “Clear test events” must only affect metadata.test = true events. Never delete production usage.
  9. Keep status color logic centralized in status.ts.
  10. Verify /coverage-checklist returns 200 before marking coverage complete.

  Then proceed with the full UI build exactly as planned.
  ```
  ## My call
  Approve it **after those changes**.
  This is the right direction, but the plan needs those guardrails because this is financial infrastructure. If this dashboard lies by even 20%, your pricing decisions will be wrong.