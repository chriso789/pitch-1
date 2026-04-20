# PITCH Automation Engine — Phase 1 Foundation Plan

## Audit of existing schema (relevant tables)

| Existing table | Role | Decision |
|---|---|---|
| `tenants` | Tenant root (uses `tenant_id` everywhere) | New tables use `company_id uuid` FK → `tenants(id)`. "company" = "tenant" in this codebase. |
| `automations` (id, tenant_id, name, trigger_type, trigger_conditions, actions jsonb, is_active) | Old simple engine | Keep, untouched. |
| `automation_rules` (id, tenant_id, trigger_event, trigger_conditions, template_id, recipient_rules, delay_minutes…) | Newer template-based rules | **Do NOT extend.** Naming collides. New table: `automation_rules_v2`. |
| `automation_logs` (id, tenant_id, automation_id, trigger_data, execution_result, status, error_message) | Per-rule run log | Keep. New engine writes to `automation_runs` + `automation_action_runs` (richer, per-action). |
| `smart_tag_definitions` | Already exists | **Inspect columns first.** Likely augment by adding `smart_tag_cache` only. If shape is incompatible, create `smart_tag_definitions_v2`. |
| `communication_history` (tenant_id, contact_id, pipeline_entry_id, project_id, rep_id, communication_type, direction, content, sentiment, delivery_status…) | System of record for comms | **Keep.** Skip new `communications` table in Phase 1 to avoid double-write. Phase 2 trigger emits domain events from this table. |
| `outbox_events` | Existing outbox pattern | Untouched in Phase 1. New `domain_events` is purpose-built for the automation engine + AI memory, not a replacement for the outbox. |
| `workflow_tasks`, `workflow_phase_history`, `pipeline_automation_rules` | Different domains | Untouched. |

### Naming decisions
- `company_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` everywhere (per user choice).
- RLS uses existing `public.get_user_tenant_ids()` helper, treating company_id as tenant_id.

---

## Phase 1 — Tables to create (9 total)

1. **`event_types`** (lookup, no tenant scope, public read) — seeded with canonical event keys.
2. **`domain_events`** — append-only event bus. Unique partial index on `(company_id, dedupe_key) WHERE dedupe_key IS NOT NULL`.
3. **`automation_rules_v2`** — cooldown_seconds, max_runs_per_entity_per_day, trigger_scope, stop_processing_on_match, conditions/actions JSONB.
4. **`automation_runs`** — one row per (rule × event). Unique on `(automation_rule_id, domain_event_id)`.
5. **`automation_action_runs`** — per-action execution rows.
6. **`smart_tag_cache`** — resolved tag values per entity, unique on `(company_id, entity_type, entity_id, tag_key)`.
7. **`ai_context_profiles`** — per-scope (company/contact/lead/job) memory snapshot, unique on `(company_id, scope_type, scope_id)`.
8. **`ai_context_refresh_queue`** — dirty queue for memory rebuilds (status, attempts, priority).
9. **`automation_generated_records`** — links runs to rows they created (dedupe + traceability).

## Phase 1 — RLS pattern (every tenant-scoped table)

- `SELECT/INSERT/UPDATE/DELETE` restricted to authenticated users where `company_id IN (SELECT public.get_user_tenant_ids())`.
- `master` role: SELECT bypass via `public.has_role(auth.uid(),'master')` for cross-tenant audit. Writes still scoped to their own tenant.
- Service role implicit bypass (workers run as service role).
- `event_types`: public read, service-role write.

## Phase 1 — Indexes (per spec)

- `domain_events(company_id, event_type, occurred_at desc)`
- `domain_events(company_id, entity_type, entity_id, occurred_at desc)`
- unique partial `domain_events(company_id, dedupe_key) WHERE dedupe_key IS NOT NULL`
- `automation_rules_v2(company_id, trigger_event, is_active)`
- unique `automation_runs(automation_rule_id, domain_event_id)`
- unique `smart_tag_cache(company_id, entity_type, entity_id, tag_key)`
- unique `ai_context_profiles(company_id, scope_type, scope_id)`
- `ai_context_refresh_queue(company_id, status, priority)`

## Phase 1 — `event_types` seed (canonical keys)

`lead.created, lead.assigned, lead.status_changed, job.created, job.status_changed, job.complete, job.closed, estimate.sent, estimate.approved, estimate.rejected, contract.signed, permit.submitted, permit.approved, materials.ordered, materials.delivered, invoice.created, invoice.overdue, payment.received, inspection.scheduled, inspection.failed, inspection.passed, communication.inbound_sms, communication.outbound_sms, communication.inbound_email, communication.outbound_email, communication.call_completed, document.uploaded, task.overdue, note.added, ai.summary_requested`

---

## Out of scope for Phase 1

- Edge function workers (`automation-dispatcher`, `automation-worker`, `smart-tag-resolver`, `ai-context-builder`, `communication-ingest`).
- Triggers on `jobs` / `pipeline_entries` / `estimates` / `communication_history` to emit events.
- Materialized views and rollups (`job_comms_rollup` etc.).
- Seeding any `automation_rules_v2` rows.
- Touching `outbox_events` or migrating from old `automations` / `automation_rules`.
- Any frontend UI.

## Open question before migration

Inspect `public.smart_tag_definitions` columns to decide reuse vs v2 — done immediately before writing the migration.

## Next steps

1. Inspect `smart_tag_definitions` schema.
2. Write a single migration creating all 9 tables + RLS + indexes + event_types seed.
3. Stop. Phase 2 (workers + triggers) waits for explicit go-ahead.
