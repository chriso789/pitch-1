# Security warning triage — 2026-10-16 (updated same day)

Sources: database linter (268 findings) and the project security scan (90 findings).
Status re-checked against live policies on 2026-10-16. Nothing was weakened to silence a warning.

## Linter (268 → 239) by class
| Class | Count | Severity | Subsystem | Exploitability / status |
|---|---|---|---|---|
| Signed-in users can execute SECURITY DEFINER function | 179 | Medium | DB functions | Present. Only exploitable where a function skips its own tenant/role check. Needs per-function review; highest priority: functions touching documents, invoices, user_roles. |
| Public (anon) can execute SECURITY DEFINER function | 71 → 42 | High | DB functions | **Reduced 2026-10-16.** Revoked PUBLIC/anon EXECUTE on 29 internal functions (number generators, emit_domain_event, log_function_error, check_rate_limit, increment_estimate_views, get_workspace_bootstrap, resolve_request_tenant_id, crew portal helpers). Remaining 42 are intentional: RLS policy helpers (has_role, get_user_tenant_id, …) and public-page functions (demo requests, referral links, invoice portal tokens, presentation/signature sessions). |
| Function search_path mutable | 14 | Low | DB functions (mostly PostGIS `st_*`) | Present. Extension-owned; low practical risk (no untrusted schema create). |
| Extension in public | 2 | Low | PostGIS | Present; moving PostGIS breaks geometry columns. Accept. |
| RLS disabled (`spatial_ref_sys`) | 1 | Low | PostGIS reference table | Present; static public reference data, owned by extension. Accept. |
| Leaked password protection off | 1 | Medium | Auth | Present; dashboard switch (owner action). |

## Fixed 2026-10-16 (second pass)
- `admin-update-password`: removed hardcoded name-based ("Chris O'Brien") authorization exception; roles now read from `user_roles` scoped to the target user's company; hierarchy enforced (office_admin < corporate < owner < master); self-update allowed; errors sanitized (401/403/404/400, no internal messages); min password length raised to 8.
- `Settings.tsx`: platform tabs no longer gated on a hardcoded email address; server-verified `has_role('master')` check instead.
- Insert policies tightened (were `WITH CHECK (true)`, anyone could forge rows): `ai_call_transcripts` (now tenant-scoped), `material_import_batches` (tenant required + tenant-less rows no longer visible to all), `training_pairs` (tenant-scoped). Edge functions use the service role and are unaffected.
- `MaterialImportAuditDialog` now saves `tenant_id` on import batch rows.
- `.env` added to `.gitignore` (history scan: only public VITE_ publishable keys were ever committed; no service-role or secret keys found).
- Address validation classifier: premise addresses with inferred/replaced/spell-corrected components were marked `valid`; now correctly `needs_review` (test was failing before this fix).

## Scan (90) — critical/high items
| Finding | Severity | Subsystem | Status |
|---|---|---|---|
| satellite-cache / satellite-imagery: anyone could insert/update/delete files | High | Storage | **Fixed 2026-10-16** — writes restricted to service role; imagery read requires sign-in; cache stays publicly readable (non-customer aerial tiles). |
| pdf-originals/-compiled/-renders/-thumbnails/-cache "not tied to uploader" | Medium (reclassified) | Storage / customer documents | Policies ARE tenant-bound (`foldername[1] = jwt.app_metadata.tenant_id`). Residual risk: bound to home tenant in JWT, not per-tab company; multi-company users cannot reach other companies' PDF Studio files (availability, not leak). |
| `USING (true)` reads: abc_item_family_members, measurement_benchmark_*, mskill_workers, mskill_provider_sync_logs, insurance_network_contributions | Medium | Catalog / measurement ops | Present. Non-customer data except insurance_network_contributions (review next). |
| `WITH CHECK (true)` inserts: ai_call_transcripts, material_import_batches, training_pairs | High | Calls / imports | Present. ai_call_transcripts allows forged transcript rows — next to fix (needs caller audit of Telnyx function). |
| Scanner `documents` bucket | — | UltraScan | Not flagged; tenant-folder policies verified in earlier phase. Live two-company test still **pending** (see tests/scanner/security-harness.test.ts). |

## Not verifiable here
Authenticated exploitation attempts (requires isolated test companies + accounts).

## review_reference_candidate (Photo Intelligence) — 2026-10-19
- Privileges: SECURITY DEFINER, `search_path=public`; EXECUTE revoked from PUBLIC/anon, granted to `authenticated` only. Flagged by the linter as "signed-in users can execute SECURITY DEFINER".
- Internal checks: caller must have `user_company_access` to the label's company; labeler cannot review; only `pending` labels can be reviewed (row locked `FOR UPDATE`); reject/correction need a reason; every action logged to `photo_reference_reviews`. DB CHECK also forbids reviewer = labeler.
- Bypass found and fixed: a direct UPDATE policy (`prc_approve`) let a company member set `review_status='approved'` on rejected rows without the function. Policy dropped and UPDATE revoked; the function is now the only write path.
- Tested live (`tests/database/review-reference-candidate.sql`, rolled back): no-session, self-review, cross-company, direct table update, repeat review, reasonless rejection all refused; rejected label carries no approval. Verdict: warning accepted, no further remediation needed.
