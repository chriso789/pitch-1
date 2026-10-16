# Security warning triage — 2026-10-16

Sources: database linter (268 findings) and the project security scan (90 findings).
Status re-checked against live policies on 2026-10-16. Nothing was weakened to silence a warning.

## Linter (268) by class
| Class | Count | Severity | Subsystem | Exploitability / status |
|---|---|---|---|---|
| Signed-in users can execute SECURITY DEFINER function | 179 | Medium | DB functions | Present. Only exploitable where a function skips its own tenant/role check. Needs per-function review; highest priority: functions touching documents, invoices, user_roles. |
| Public (anon) can execute SECURITY DEFINER function | 71 | High | DB functions | Present. Revoke EXECUTE from anon except functions used by public pages (invoice viewer, closeout portal, webhooks). Needs per-function caller audit before revoking. |
| Function search_path mutable | 14 | Low | DB functions (mostly PostGIS `st_*`) | Present. Extension-owned; low practical risk (no untrusted schema create). |
| Extension in public | 2 | Low | PostGIS | Present; moving PostGIS breaks geometry columns. Accept. |
| RLS disabled (`spatial_ref_sys`) | 1 | Low | PostGIS reference table | Present; static public reference data, owned by extension. Accept. |
| Leaked password protection off | 1 | Medium | Auth | Present; dashboard switch (owner action). |

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
