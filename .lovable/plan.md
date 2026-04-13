<final-text>Do I know what the issue is? Yes.

Why it is not doing what you asked:
1. The UI still hardcodes a 3-item run.
   - `src/components/settings/VendorVerificationDashboard.tsx` sends `limit: 3`.
   - `supabase/functions/measure/index.ts` also defaults to 3.
   - That is why the screenshot shows 214 pending but only 3 were attempted.

2. The batch verifier is not actually able to generate the internal AI diagram for pending sessions.
   - Inside `batch-verify-vendor-reports`, it self-calls `measure` with `action: 'pull'`.
   - That call does not pass `propertyId`.
   - But `measure` requires `propertyId` for `pull`, so the generation path fails and the session gets skipped.

3. The fallback lookup for existing measurements is pointed at the wrong columns.
   - The verifier searches `roof_measurements` using `lat` / `lng`.
   - The schema uses `target_lat` / `target_lng`.
   - So it misses existing measurements and falls through to the broken self-call.

4. Even when verification runs, it is not verifying off the paid report diagram/pages.
   - The current code only compares `ai_totals` vs `traced_totals`.
   - It does not inspect the vendor PDF pages, `diagram_image_url`, or `diagram_geometry`.
   - So it is not doing the “build diagram, then verify against the report” workflow you asked for.

What I will change:
1. Fix AI generation first
   - Include `pipeline_entry_id` in the batch query.
   - Pass a valid `propertyId` into the internal `pull` call.
   - Normalize the pull response parsing and persist `ai_measurement_id`, `original_ai_measurement_id`, and `ai_totals`.
   - Look up existing measurements by `target_lat` / `target_lng` instead of `lat` / `lng`.

2. Make it run for all report-backed addresses
   - Remove the hardcoded `limit: 3` from the dashboard.
   - Stop trying to process the whole run synchronously in one request.
   - Convert verification into background processing for all pending vendor sessions.

3. Add real processing state
   - Add `verification_status`, `verification_error`, `verification_started_at`, and `verification_completed_at`.
   - Use `queued / processing / completed / failed` so nothing silently “skips”.

4. Verify against the actual paid report evidence
   - For each house, load vendor evidence from `roof_vendor_reports` (`diagram_image_url`, `diagram_geometry`, PDF/file fallback).
   - Generate the internal AI roof diagram from the measurement result.
   - Compare AI diagram + totals against the vendor report evidence, then persist Confirmed / Denied plus notes.

5. Update the verification UI
   - Show real progress across all addresses.
   - Show per-house failure reasons instead of vague skip messages.
   - Show side-by-side AI vs vendor evidence on each row.
   - Keep manual Confirmed / Denied override.

Technical details:
- Files to patch:
  - `src/components/settings/VendorVerificationDashboard.tsx`
  - `supabase/functions/measure/index.ts`
  - a new migration for verification status/error fields
- Processing model:
  - use the same async background pattern already used by `start-ai-measurement` so 214 addresses can run without timing out.
- QA:
  - add targeted tests/logging for missing `propertyId`, response parsing, `target_lat/target_lng` lookup, and full-batch background execution.

Expected result:
- One click queues all imported report-backed addresses.
- Each address generates an internal AI roof diagram first.
- Then each one is verified against the paid report evidence.
- The dashboard shows actual progress and a real fail reason for any house that cannot be verified.</final-text>