# Measurement-Mapping Phase 1.6 — Staging Runbook

## Hard rules

- **Production project (`alxelfrbjzkmtnsulcei`) is FORBIDDEN for any write,
  backfill, or rollback test.** Read-only shadow runs against production are
  the only exception, and they MUST use a read-only Postgres role — never the
  production `service_role` key.
- All write/backfill/rollback tasks REQUIRE the env vars
  `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` to point at a
  **separate** Supabase project. The scripts additionally enforce
  `DEPLOY_ENV ∈ {staging, development}`; setting `DEPLOY_ENV=staging` while
  `STAGING_SUPABASE_URL` points at production is an operator error and a
  policy violation, not a workaround.
- No script in this folder may be wired into CI, cron, or an edge function
  trigger. They are operator-only.

## Required env vars

```
export STAGING_SUPABASE_URL="https://<staging-ref>.supabase.co"
export STAGING_SUPABASE_SERVICE_ROLE_KEY="<staging service role>"
export SUPABASE_URL="$STAGING_SUPABASE_URL"
export SUPABASE_SERVICE_ROLE_KEY="$STAGING_SUPABASE_SERVICE_ROLE_KEY"
export DEPLOY_ENV=staging
```

Refuse to proceed if `SUPABASE_URL` resolves to `alxelfrbjzkmtnsulcei`.

## Order of execution (staging only)

From `supabase/functions/_shared/measurement-mapping/`:

1. `deno task measurement-mapping:backfill-dryrun --tenant <uuid> --limit 500`
   Read-only report of what a backfill would do. Safe everywhere.
2. `deno task measurement-backfill:staging --tenant <uuid> --write`
   Staging-only. Hard-fails if `DEPLOY_ENV` is not staging/development.
3. `deno task measurement-mapping:shadow --tenant <uuid> --template <uuid>`
   Dry-run mapper over normalized imports; exits non-zero on safety violation.
4. `deno task measurement-mapping:legacy-compare --tenant <uuid> --template <uuid>`
5. `deno task measurement-mapping:rollout-report --tenant <uuid>`
6. (Only if step 2 needs to be undone) `deno task measurement-backfill:rollback --run-id <uuid>`

## Production read-only shadow (allowed)

Production shadow is allowed ONLY through a read-only role (no service role).
Use `supabase--read_query` or a `pg` role with `SELECT`-only grants. Do not
export the production service role into this environment.

## Schema prerequisites (currently UNMET in production)

Shadow/rollout/legacy-compare expect these tables, which do not yet exist on
`alxelfrbjzkmtnsulcei`:

- `estimate_template_items`
- `estimate_template_section_rules`
- `estimate_template_item_rules`

In production, template items live inside `estimate_templates.template_data`
(JSONB) and `estimate_template_groups`. A staging project must have the
Phase 1 schema applied (the missing tables created and template_data migrated
into rows) before shadow runs will return non-empty results.
