# Phase 1.6 — Read-Only Evidence (Option B)

**Tenant:** O'Brien Contracting — `14de934e-7964-4afd-940a-620d2ace125d`
**Project:** `alxelfrbjzkmtnsulcei` (production)
**Mode:** Read-only shadow against production. No writes, no backfill, no rollback.

## Verdict: **NO-GO** for Phase 1.6 validation as designed

The Phase 1.6 scripts cannot produce meaningful evidence against production
because two preconditions fail. This is a tooling/schema gap, not a mapper
defect — but it blocks every step that depends on normalized imports.

## What was actually executed

Only read-only SQL via `supabase--read_query`. No Deno scripts were run, no
service-role keys were used, no rows were written.

| # | Action | Tool | Writes? |
|---|---|---|---|
| 1 | Resolve tenant id by name | `read_query` | no |
| 2 | Count source/normalized rows for tenant | `read_query` | no |
| 3 | Classify roof_measurements rows (preview of step 3) | `read_query` | no |
| 4 | Inspect template schema (preview of step 9) | `read_query` | no |

Steps 4 (staging backfill), 7 (rollback test), and 8 (full backfill) were not
executed, as instructed.

## Evidence

### A. Tenant snapshot
- `roof_measurements`: **32**
- `measurement_imports`: **0**
- `measurement_segments`: **0**
- `measurement_features`: **0**
- `estimate_templates`: **3**

### B. Source classification (read-only preview of step 3)
Of the 32 `roof_measurements` rows for O'Brien:
- **30** have no pitch and no flat-area split → would be tagged
  `aggregate_only` and **must not** feed flat/sloped quantities.
- **30** have no `total_area_adjusted_sqft` → missing the primary area field.
- **2** classify as low-slope-or-flat by `pitch_degrees`.
- **0** classify as sloped.

### C. Template / mapping schema (preview of step 9)
The shadow/legacy/rollout scripts query these tables:
- `estimate_template_items`
- `estimate_template_section_rules`
- `estimate_template_item_rules`

**None of them exist in production.** Production stores template items inside
`estimate_templates.template_data` (jsonb) plus `estimate_template_groups`.
Running shadow against production would crash on the first SELECT.

## Mapping gaps (blockers for Phase 1.6 sign-off)

1. **No normalized imports for O'Brien.** Without `measurement_imports` rows,
   shadow/legacy/rollout return empty. The only way to populate them is the
   staging backfill, which is correctly forbidden on production.
2. **Section-mapping schema missing in production.** The Phase 1 migration
   that adds `estimate_template_items`, `estimate_template_section_rules`,
   `estimate_template_item_rules` has not been applied here. It must be
   applied on the staging project before any shadow run will produce data.
3. **Source data is mostly aggregate-only.** 30/32 O'Brien measurements lack
   pitch and flat-area information. Even after backfill, they would be
   classified `aggregate_only` and intentionally left out of class-scoped
   assignments — which is the correct safety behavior, but it also means
   O'Brien is a weak validation tenant. A second tenant with richer
   class-scoped measurements is needed to exercise the assigned path.
4. **No `use_section_mapping` flag on `estimate_templates`.** Phase 1 assumes
   per-template opt-in; the column does not exist in production.

## Confirmation: no writes occurred

- No `INSERT`, `UPDATE`, `DELETE`, `COPY`, `TRUNCATE`, or DDL was issued.
- The production `SUPABASE_SERVICE_ROLE_KEY` was never read or exported.
- No Deno script in `supabase/functions/_shared/measurement-mapping/` was
  invoked.
- `DEPLOY_ENV` was not set; backfill scripts would have refused to run.

## Recommended staging setup for a full Phase 1.6 pass

1. Provision a separate Supabase project (call it `pitch-staging`). Do NOT
   reuse `alxelfrbjzkmtnsulcei`.
2. Apply all migrations, including the Phase 1 section-mapping tables and
   the Phase 1.5 / 1.6 measurement-mapping migrations.
3. Clone a representative subset of production data into staging — at least:
   - One tenant with rich class-scoped measurements (flat + sloped + features).
   - O'Brien-style aggregate-only tenant to prove the safety path.
4. Add the secrets `STAGING_SUPABASE_URL` and
   `STAGING_SUPABASE_SERVICE_ROLE_KEY` to the operator's local environment
   (NOT to Lovable Cloud secrets, NOT to CI).
5. Run the 6-step staging sequence in
   `supabase/functions/_shared/measurement-mapping/RUNBOOK.md`.
6. Save the resulting reports under
   `reports/measurement-mapping/<tenant_id>/` and re-evaluate GO/NO-GO.

## Option C deliverables (prepared, not executed)

- `supabase/functions/_shared/measurement-mapping/deno.json` — task aliases
  only. No task runs automatically.
- `supabase/functions/_shared/measurement-mapping/RUNBOOK.md` — staging
  runbook. Requires `STAGING_SUPABASE_URL` /
  `STAGING_SUPABASE_SERVICE_ROLE_KEY`; production is marked forbidden for
  write/backfill/rollback.
