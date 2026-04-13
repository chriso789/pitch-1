<final-text>What I verified:
- The reports are not gone.
- Your active training lab still has 214 vendor-backed training sessions.
- There are 156 imported vendor report records in `roof_vendor_reports`.
- 107 of those already have extracted diagram evidence.
- 49 have neither a saved source file nor a saved diagram copy.

Why this area shows nothing:
1. The Verification tab is querying a column that does not exist in the database:
   - `roof_training_sessions.verification_status`
   - the frontend and edge function expect it, but the table does not have it
   - that query fails and the UI falls back to showing 0 rows

2. The imported vendor report rows are not tenant-linked:
   - all 156 `roof_vendor_reports` rows currently have `tenant_id = null`
   - tenant-scoped/RLS-safe report queries cannot see them properly in the report UI

3. The importer created duplicate session rows:
   - you have 214 vendor sessions but only 117 distinct linked vendor reports in those sessions
   - `BulkReportImporter` creates a training session, and `roof-report-ingest` also auto-creates one

4. The original PDFs were not persisted for the bulk-import path:
   - bulk import sends base64 PDF data
   - `roof-report-ingest` only saves file references when a bucket/path or lead-linked document flow exists
   - current report rows have 0 saved file references
   - so many imports kept parsed data, but not the actual source PDF needed for page-by-page verification

What I will fix:
1. Repair the schema/UI mismatch
   - add the missing verification workflow columns used by the dashboard and verifier
   - keep the existing verdict/score/notes fields

2. Restore vendor report visibility
   - backfill `roof_vendor_reports.tenant_id` from linked training sessions/import context
   - update `roof-report-ingest` to always write `tenant_id` on insert

3. Stop losing source reports
   - change bulk import so every uploaded PDF is first saved to storage
   - persist `file_bucket`/`file_path` on `roof_vendor_reports`
   - run diagram extraction as a background step instead of skipping it

4. Remove duplicate vendor sessions
   - make import idempotent per `(tenant_id, vendor_report_id)`
   - stop the extra session creation in `BulkReportImporter`
   - dedupe existing session rows so verification shows one row per report

5. Fix the Verification tab
   - query report-backed sessions without referencing missing columns
   - join vendor report metadata into the table
   - show address, provider, source-file availability, diagram availability, and verification state
   - show “missing source file” explicitly instead of pretending there are no reports

6. Rehydrate existing data
   - backfill the 156 imported reports into the correct tenant scope
   - reconnect report metadata to the surviving training session rows
   - mark the 49 source-less reports as needing re-import for true page-by-page verification

7. Re-enable real report verification
   - verify in this order:
     1. original PDF pages
     2. extracted diagram geometry/image
     3. parsed totals only
   - only treat a report as fully verifiable when the source evidence exists
   - persist exact failure reasons instead of silent skips

Files involved:
- `src/components/settings/VendorVerificationDashboard.tsx`
- `src/components/measurements/BulkReportImporter.tsx`
- `supabase/functions/roof-report-ingest/index.ts`
- `supabase/functions/measure/index.ts`
- new migration for verification-state columns and backfill-safe support

Current data summary:
```text
vendor training sessions:              214
distinct linked vendor reports:        117
imported vendor report rows:           156
vendor reports with tenant_id:           0
vendor reports with diagram evidence:  107
vendor reports with saved source file:   0
reports with no file and no diagram:    49
```

Expected result after implementation:
- the Verification tab will show the imported vendor reports again
- the system will know which reports are fully available vs partially recoverable
- “Verify All” will run against all report-backed addresses
- page-by-page verification will only proceed when the actual report source is available</final-text>