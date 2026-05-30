# Phase 1.6 — Staging Readiness Checklist

This is the gate that must be cleared **before** any measurement-mapping
write/backfill/rollback runs. Production (`alxelfrbjzkmtnsulcei`) is forbidden
for mutations — the scripts will hard-refuse via `guards.ts`.

## 0. Forbidden

- Do **not** run any task with `--write` against `SUPABASE_URL` containing
  `alxelfrbjzkmtnsulcei`. The guard exits 2.
- Do **not** set `DEPLOY_ENV=staging` against the production project URL to
  "trick" the guard. The URL check fires first.
- Do **not** export `STAGING_SUPABASE_*` from the production project.

## 1. Provision staging Supabase project

- [ ] Create a separate Supabase project (e.g. `pitch-staging`). Record its
      project ref and API URL.
- [ ] Project ref MUST NOT be `alxelfrbjzkmtnsulcei`.

## 2. Apply migrations on staging

- [ ] Phase 1 migrations (section-mapping tables + `use_section_mapping`).
- [ ] Phase 1.5 migrations (mapping debug + backfill dry-run columns).
- [ ] Phase 1.6 migrations (`source`, `backfill_run_id`, `backfill_status`,
      `voided_at`, `aggregate_only`, `total_area_sqft`).

## 3. Confirm schema (run validator)

```bash
export SUPABASE_URL="$STAGING_SUPABASE_URL"
export SUPABASE_SERVICE_ROLE_KEY="$STAGING_SUPABASE_SERVICE_ROLE_KEY"
export DEPLOY_ENV=staging
cd supabase/functions/_shared/measurement-mapping
deno task measurement-mapping:validate-schema
```

The validator is read-only. It must report `"ok": true`. Required objects:

- [ ] table `measurement_imports`
- [ ] table `measurement_segments`
- [ ] table `measurement_features`
- [ ] table `estimate_templates`
- [ ] table `estimate_template_groups`
- [ ] **table `estimate_template_items`**
- [ ] **table `estimate_template_section_rules`**
- [ ] **table `estimate_template_item_rules`**
- [ ] table `estimate_measurement_assignments`
- [ ] **column `estimate_templates.use_section_mapping`**
- [ ] columns `measurement_imports.{source, backfill_run_id, backfill_status, voided_at, aggregate_only, total_area_sqft}`
- [ ] columns `measurement_segments.{source, backfill_run_id}`
- [ ] columns `measurement_features.{source, backfill_run_id}`

## 4. Clone tenants into staging

- [ ] Clone the **O'Brien Contracting** tenant
      (`14de934e-7964-4afd-940a-620d2ace125d`) — exercises the
      `aggregate_only` safety path.
- [ ] Clone at least **one rich-measurement tenant** (with class-scoped
      flat + sloped + features) — exercises the assigned path.

## 5. Local environment for the operator

- [ ] `STAGING_SUPABASE_URL` set (NOT the production URL).
- [ ] `STAGING_SUPABASE_SERVICE_ROLE_KEY` set (NOT the production key).
- [ ] Before each session: `export SUPABASE_URL=$STAGING_SUPABASE_URL` and
      `export SUPABASE_SERVICE_ROLE_KEY=$STAGING_SUPABASE_SERVICE_ROLE_KEY`.
- [ ] `export DEPLOY_ENV=staging`.

## 6. Execute the validation pass (in order)

For each cloned tenant, save outputs under
`reports/measurement-mapping/<tenant_id>/`.

1. [ ] **Shadow** (read-only):
       `deno task measurement-mapping:shadow --tenant-id <uuid>`
2. [ ] **Legacy compare** (read-only):
       `deno task measurement-mapping:legacy-compare --tenant-id <uuid>`
3. [ ] **Backfill** (mutates staging only — requires explicit flags):
       `deno task measurement-backfill:staging --tenant-id <uuid> --limit 25 --write --allow-staging-write`
4. [ ] **Rollout read** (read-only):
       `deno task measurement-mapping:rollout-report --tenant-id <uuid>`
5. [ ] **Rollback proof** (mutates staging only):
       `deno task measurement-backfill:rollback --backfill-run-id <uuid> --allow-staging-write`

## 7. GO/NO-GO

- [ ] Zero safety violations in shadow output.
- [ ] Legacy comparison drift within configured tolerance.
- [ ] Backfill produced rows tagged with the run id and `source=backfill`.
- [ ] Rollback removed exactly the tagged rows; original `roof_measurements`
      rows untouched.
- [ ] Rollout report identifies `safe_to_enable` templates.

Only after every box is checked is the tenant/template eligible for a tiny
allowlist rollout — **never** before.
