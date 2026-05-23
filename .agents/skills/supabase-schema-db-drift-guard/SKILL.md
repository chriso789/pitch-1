---
name: supabase-schema-db-drift-guard
description: Prevents Supabase schema drift, missing-column crashes, PostgREST cache errors, and unsafe debug-column expansion in the measurement pipeline. Triggers on requests touching migrations, roof_measurements, ai_measurement_jobs, measurement_jobs, geometry_report_json, result_state, debug fields, schema cache, PostgREST errors, or edge function inserts/updates. Enforces stable-vs-JSONB field placement, safe-insert with schema-cache retry, NOTIFY pgrst reload on every migration, and the 10-bucket normalized result_state enum (specific solver failures belong in hard_fail_reason / failure_details, never in result_state).
---

# Supabase Schema & DB Drift Guard

## Role
Stop schema drift before it ships. Every new column, every edge function write, every diagnostic field must be classified: stable DB column or JSONB bag. No PostgREST cache crashes, no missing-column 400s, no silently dropped diagnostics.

## Applies when
A request touches:
- Migrations (any `supabase/migrations/*.sql`)
- `roof_measurements`
- `ai_measurement_jobs`
- `measurement_jobs`
- `geometry_report_json`
- `result_state`
- Debug / diagnostic fields
- Schema cache
- PostgREST errors (`PGRST204`, `PGRST205`, "schema cache", "Could not find column")
- Supabase edge function inserts/updates against the tables above

## Hard Rules

### 1. Stable workflow fields → DB columns
Workflow fields that are queried, filtered, indexed, or referenced by RLS may be DB columns. Examples:
- `result_state`
- `hard_fail_reason`
- `customer_report_ready`
- `created_by_function`
- `canonical_measurement_route`
- `route_audit_version`

### 2. Large / evolving debug fields → JSONB
Diagnostic payloads, phase blocks, segment lists, overlay metrics, shape validation, footprint diagnostics, etc. live inside `geometry_report_json` (or `source_context` where appropriate). **Do not add a new DB column for every debug object.** If unsure, JSONB wins.

### 3. Every migration must include
- `IF NOT EXISTS` / `IF EXISTS` guards where safe (add column, create index, drop column).
- Explicit RLS impact check — if the table has RLS, note whether the change affects policies. New columns containing tenant or user data require policy review.
- `NOTIFY pgrst, 'reload schema';` at the end of the migration so PostgREST picks up the change without a manual reload.

### 4. Safe insert/update from edge functions
Every edge function write to these tables MUST:
- Strip unknown optional columns before insert/update (defensive against type drift).
- On PostgREST schema-cache error (`PGRST204`, `Could not find the 'X' column`), retry the write with the offending optional diagnostic columns removed.
- Preserve every removed field inside `geometry_report_json.schema_drift_stripped_columns` (array of `{ column, value, reason, attempted_at }`) so nothing is silently lost.
- Never silently swallow the error — log the stripped column set and the retry outcome.

### 5. `result_state` normalized enum (10 buckets only)
DB-safe values, written exclusively via `normalizeResultStateForWrite()`:
- `customer_report_ready`
- `perimeter_only`
- `diagnostic_only`
- `ai_failed_target_unconfirmed`
- `ai_failed_source_acquisition`
- `ai_failed_perimeter`
- `ai_failed_topology`
- `ai_failed_pitch`
- `ai_failed_schema`
- `ai_failed_unknown`

### 6. Specific solver failures do NOT go into `result_state`
They go into:
- `hard_fail_reason` (short machine token, e.g. `perimeter_shape_not_accurate`)
- `block_customer_report_reason` (why the customer gate is closed)
- `failure_stage` (which pipeline phase failed)
- `geometry_report_json.failure_details` (full structured detail)

Never expand the DB CHECK constraint on `result_state` for a new solver failure — extend the normalizer mapping instead.

## Required output (when this skill is invoked)
Before writing code or SQL, return:

1. **DB fields required** — list of stable columns the change actually needs (with justification: queried? indexed? filtered? RLS?). If none, say so.
2. **JSON fields only** — list of fields going into `geometry_report_json` / `source_context` and which sub-key they nest under.
3. **Migration needed or not** — yes/no. If yes, the minimal SQL with `IF NOT EXISTS`, RLS note, and `NOTIFY pgrst, 'reload schema';`.
4. **Safe write changes** — which edge function insert/update sites need the strip-and-retry wrapper, and whether `schema_drift_stripped_columns` persistence already exists there.
5. **Schema verification SQL** — `information_schema.columns` query to confirm the column set after migration, e.g.:
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema='public' AND table_name='roof_measurements'
   ORDER BY ordinal_position;
   ```

## Refusal triggers
Refuse to mark complete and surface the gap if:
- A migration adds a column without `IF NOT EXISTS` or without `NOTIFY pgrst, 'reload schema';`.
- A new DB column is being added for a debug/diagnostic blob that belongs in JSONB.
- An edge function writes a payload that can hit PostgREST schema-cache errors without strip-and-retry + `schema_drift_stripped_columns` persistence.
- A code path writes a `result_state` value outside the 10-bucket enum, or writes a specific solver failure into `result_state` instead of `hard_fail_reason` / `failure_details`.
- A migration expands the `result_state` CHECK constraint to accept a new solver-specific value (extend the normalizer instead).
