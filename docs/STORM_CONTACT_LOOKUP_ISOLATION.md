# Tenant Isolation Audit — Storm contact lookup (2026-10-18)

## Gate 1 — Schema
- Four tables reviewed: canvassiq_properties, canvass_property_contacts, dnc_scrub_results, canvassiq_enrichment_logs.
- Three have non-null tenant_id. Contact cache has only property_id: schema hard fail under the strict auditor; ownership is inherited through the property FK.

## Gate 2 — RLS
- All four tables have RLS enabled. Property, cache and log policies filter company directly or through property ownership. Cache/log policies still resolve the home company, so switched-company cache writes may be refused.
- DNC USING(true) is service_role only, not public. No master-only policies in these four tables.
- No policy changes approved or planned in this repair.

## Gate 3 — Storage
- No buckets or storage operations in this workflow. Not applicable.

## Gate 4 — Telnyx
- No calls/messages sent by lookup. Not applicable; DNC flags are persisted, not outbound authorization.

## Gate 5 — Integration credentials
- BatchData and Firecrawl read server-side secrets only, never return credentials. No credential tables.

## Gate 6 — Code-level
- Original legacy route bypasses auth/tenant middleware; handler trusts body tenant and service-role reads/writes by property_id only: FAIL.
- Frontend uses profile home company instead of selected company: FAIL.
- Live target function missing (NOT_FOUND_FUNCTION_BLOB), and its entry point does not dispatch shim x-route: confirmed availability failure.

## Verdict before repair — FAIL
- Restore dispatcher and verify JWT, active membership and property ownership before provider calls.
- Resolve tenant from validated selected-company header; never accept body tenant as authorization.
- Scope service property reads/updates to tenant; use authenticated RLS client for contact cache, scope DNC/log inserts to resolved tenant.
- Remove speculative API-key warning and duplicate display; stop success handling after failures.
- Remaining schema/cache policy issues need staging verification before any live migration; no clean six-gate claim.

## Repair verification
- Restored and deployed `property-data-api`; legacy shim now reaches the handler (invalid-token POST returns 401, not missing-service 404).
- Handler validates JWT, active membership/company and tenant-owned property before provider calls. Body company/address no longer authorize or override stored property data.
- Property service-role queries explicitly filter tenant; cache uses authenticated RLS client. Browser uses selected company and displays one retry error, without speculative key claims or false success handling.
- Five concrete authorization tests pass: signed out, missing membership, cross-company property, inactive company, authorized switched-company property. Preview build is OK.
- Verdict remains FAIL for strict Gate 1/cache schema and existing switched-company cache policies. No live migrations or policy changes performed. Authenticated provider-result/cache checks remain pending because this external backend has no test session available.