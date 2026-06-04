# Blueprint Importer v2 — Phase 2: DB Schema Promotion + Verification

**Status:** Phase 2 complete. Draft migration promoted to a real, applied
Supabase migration. Tenant helper verified. Schema, constraints, indexes,
and RLS policies confirmed. **No runtime, endpoint, worker, or UI behavior
was changed.**

## Scope

Phase 2 is limited to:

- Re-reading Phase 0 + Phase 1 docs and contracts.
- Verifying that `public.get_user_tenant_id()` is the canonical tenant
  helper used by existing tenant-scoped tables.
- Promoting `docs/migrations-draft/blueprint-importer-v2-phase1.sql` into
  the approved Supabase migration flow.
- Applying the migration and inspecting the resulting schema.
- Documenting deviations and implementation gaps.

Phase 2 does **not** include:

- Scraping / parsing
- Trade detection
- Material rule population
- Labor pricing
- Endpoint wiring
- `document-worker` or geometry worker changes
- New standalone edge functions
- UI changes
- Seed data
- Backfill

## Tenant helper verification

The draft migration assumed `public.get_user_tenant_id()` (no-arg overload).

Inspected `pg_proc` and confirmed two overloads exist in `public`:

| Function | Args | Returns |
|---|---|---|
| `public.get_user_tenant_id` | _none_ | `uuid` |
| `public.get_user_tenant_id` | `_user_id uuid` | `uuid` |

Cross-checked against `pg_policies` for `public.contacts` (representative
tenant-scoped table). All existing policies use the no-arg form
(`tenant_id = get_user_tenant_id()`) or the explicit
`get_user_tenant_id(auth.uid())` form. The draft's use of the no-arg form
matches project convention. **Verdict: helper verified, no SQL change
required.**

## Promoted migration

- Source draft: `docs/migrations-draft/blueprint-importer-v2-phase1.sql`
- Promoted via the platform's Supabase migration tool (timestamped file
  created under `supabase/migrations/` by the tool; SQL body identical to
  the draft except for trivial whitespace collapse).
- Applied successfully.

## Tables created (10)

All in schema `public`, RLS enabled, tenant-scoped:

| Table | Policies | RLS |
|---|---|---|
| `blueprint_import_sessions` | 4 (split SELECT/INSERT/UPDATE/DELETE) | ✅ |
| `blueprint_source_documents` | 1 (`FOR ALL`) | ✅ |
| `blueprint_detected_trades` | 1 (`FOR ALL`) | ✅ |
| `blueprint_accepted_trades` | 1 (`FOR ALL`) | ✅ |
| `blueprint_plan_paths` | 1 (`FOR ALL`) | ✅ |
| `blueprint_measurement_objects` | 1 (`FOR ALL`) | ✅ |
| `blueprint_review_flags` | 1 (`FOR ALL`) | ✅ |
| `blueprint_template_bindings` | 1 (`FOR ALL`) | ✅ |
| `blueprint_material_draft_lines` | 1 (`FOR ALL`) | ✅ |
| `blueprint_labor_draft_lines` | 1 (`FOR ALL`) | ✅ |

Every policy uses `tenant_id = public.get_user_tenant_id()` in both
`USING` and `WITH CHECK`. Grants applied per project convention:
`authenticated` → SELECT/INSERT/UPDATE/DELETE, `service_role` → ALL.
No `anon` grants (tenant-scoped data).

`NOTIFY pgrst, 'reload schema';` was issued at the end of the migration.

## Constraints verified

Confirmed against `pg_constraint` for `blueprint_accepted_trades`
(strictest table):

- `bp_acc_status_chk` — status ∈ {accepted, rejected, superseded}
- `bp_acc_review_state_chk` — review_state ∈ {pending_review, blocked, cleared, manual_only}
- `bp_acc_windows_doors_chk` — `trade_id <> 'windows_doors'`
- `bp_acc_future_manual_only_chk` — future trades only with
  `review_state = 'manual_only'`

Other notable DB-enforced checks (created with the migration):

- `bp_det_support_chk` — 4-state TradeSupportStatus enum
- `bp_det_confidence_chk`, `bp_pp_confidence_chk`, `bp_mo_confidence_chk` — confidence ∈ [0, 1]
- `bp_rf_severity_chk` — severity ∈ {info, warning, error, blocker}
- `bp_rf_entity_type_chk` — review-flag entity types
- `bp_pp_path_type_chk` — plan-path types
- `bp_src_doc_type_chk` — DocumentType enum
- `bp_src_provider_chk` — SourceProvider enum
- `bp_src_extraction_status_chk` — extraction-status enum
- `bp_tb_binding_status_chk` — binding-status enum
- `bp_mdl_status_chk`, `bp_ldl_status_chk` — draft-line status enum
- `bp_mdl_catalog_status_chk` — catalog resolution enum

## Indexes verified

Per-table indexes created (all `IF NOT EXISTS`):

- Sessions: tenant, context, status
- Source documents: session, tenant, (document_type, provider)
- Detected trades: session, trade
- Accepted trades: session, trade
- Plan paths: session, source
- Measurement objects: session, trade, key
- Review flags: session, (entity_type, entity_id), partial index on `blocking=true AND resolved=false`
- Template bindings: session, accepted_trade
- Material draft lines: session, accepted_trade
- Labor draft lines: session, accepted_trade

## Triggers

`set_updated_at` trigger attached (via `DO $$ … END$$` block) on the five
tables that carry `updated_at`: sessions, source documents, detected,
accepted, template bindings. Trigger calls existing
`public.update_updated_at_column()` (verified present).

## Contract parity check

| Group | Phase 0 docs | Phase 1 docs | TS contracts | Python contracts | JSON schemas | DB constraints |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| TradeSupportStatus (4) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| TradeId (13) | ✅ | ✅ | ✅ | ✅ | ✅ | n/a (TEXT) |
| DocumentType (6) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SourceProvider (5) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session status (8) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Detected trade status (4) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Accepted trade status (3) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Review state (4) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Binding status (5) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Draft-line status (5) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Review severity (4) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Related entity type (9) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Plan-path type (5) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Implementation gaps (DB-vs-contract — honest)

These rules are **enforced in TS/Python helpers and JSON schemas**, but
are **not DB-enforced**. They are intentional gaps for Phase 2; they will
be re-checked in Phase 3 when runtime detection / acceptance writes
begin.

1. **`paint_coatings` must not stand alone without `exterior_walls_siding`
   in the same session.** Enforced only by `assertCanAcceptTradeForMvp` in
   TS and the Python twin. No DB CHECK or trigger yet.

2. **Material + labor draft lines must reference at least one PlanPath.**
   JSON schemas require non-empty `plan_path_ids`, but the DB columns
   default to `'{}'` and have no `array_length(…) >= 1` CHECK. Because
   these tables are not written in Phase 1 or Phase 2, this gap has no
   live impact.

3. **`future_supported` trades cannot auto-populate MVP draft outputs.**
   DB enforces that `blueprint_accepted_trades` for future trades require
   `review_state = 'manual_only'`. The downstream rule — that draft
   lines must not be generated for those rows — is enforced only by
   helpers, since draft generation is not wired.

4. **`blueprint_measurement_objects.measurement_key` is a free TEXT** —
   canonical keys (`roof_area_sqft`, `wall_area_sqft`, etc.) live in TS
   `MEASUREMENT_OBJECT_KEYS` and the Python twin; no DB enum.

These will be revisited (and either promoted to DB-enforcement, or
explicitly accepted as helper-only) in Phase 3 when the first writers are
introduced.

## RLS strategy review

- Every blueprint table has a direct `tenant_id UUID NOT NULL` column.
- Every policy filters by `tenant_id = public.get_user_tenant_id()` in
  both `USING` and `WITH CHECK` (no joins, no expensive subqueries).
- Foreign keys still enforce session integrity: every child row
  references `blueprint_import_sessions(id) ON DELETE CASCADE`, and rows
  cannot have mismatched tenant_id without also failing the policy.
- Consistent with the project's existing tenant-scoped table style
  (`contacts`, `jobs`, etc.), aside from those tables' additional
  location-scoping which does not apply here.
- No `USING (true)` policies, no anon grants, no cross-tenant reads
  possible through these policies.

## Verification report

- Phase 0 docs re-read: **yes**
- Phase 1 contracts re-read: **yes**
- Draft migration source: `docs/migrations-draft/blueprint-importer-v2-phase1.sql`
- Promoted migration path: `supabase/migrations/` (timestamped file created by the migration tool; identical SQL body)
- Migration applied: **yes**
- Tenant helper verified: **yes** — `public.get_user_tenant_id()` (no-arg overload, matches existing tables)
- RLS enabled on all 10 new tables: **yes**
- RLS policies verified: **yes** (1 `FOR ALL` policy on 9 tables; 4 split policies on `blueprint_import_sessions`)
- Tables created: 10 (see table above)
- Constraints verified: status / support / confidence / severity / entity-type / path-type / document-type / provider / extraction-status / binding-status / draft-line status / catalog-resolution / windows_doors block / future-manual-only
- Indexes verified: per table list above
- DB enum/check parity with TS/Python/JSON schema: **yes** (see parity matrix)
- Endpoint behavior changed: **no**
- Worker behavior changed: **no**
- UI changed: **no**
- New standalone edge functions: **no**
- Runtime extraction added: **no**
- Draft material/labor rows inserted: **no**
- Deviations: see "Implementation gaps" above (4 helper-only rules, all
  intentionally deferred to Phase 3)
- Recommended next phase: **Phase 3 only after review**

## Stop conditions

Lovable stops after Phase 2 and waits for explicit approval before any
Phase 3 work (detection, parsing into these tables, or UI surfacing).
