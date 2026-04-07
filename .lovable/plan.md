
Problem found
- The AI measurement did complete for this lead, but far too slowly: the latest `analyze-roof-aerial` run took about 126 seconds and saved `roof_measurements.id = 7b2ffeaa-6604-44ad-94f9-6dad269a1784`.
- No `measurement_approvals` row was created, so “Saved Measurements” still shows empty.
- The current UI waits synchronously for the full edge function to finish, so users only see `AI Analyzing...` for a long time and it feels broken.

Plan

1. Ship the immediate UX fix first
- Update the lead measurement panel to show completed AI results from `roof_measurements` prominently, not only from `measurement_approvals`.
- If an AI result exists but is not yet approved, show it as “Latest AI Measurement” with clear actions like `Review`, `Apply`, and `Save`.
- Replace the empty state with a smarter state:
  - `analysis in progress`
  - `result ready but not saved`
  - `saved measurement available`

2. Stop making users wait on one long request
- Move AI measurement generation to an async job flow.
- Add a `measurement_jobs` table with fields like `status`, `progress_message`, `measurement_id`, `error`, `pipeline_entry_id`, and timestamps.
- Split the flow into:
  - `start-ai-measurement` → creates a job and returns immediately
  - background processor → runs the current analysis logic and updates the job row as it progresses

3. Make progress visible and persistent
- Update `PullMeasurementsButton` to start a job instead of blocking on the full analysis.
- Show status like `Fetching imagery`, `Detecting outline`, `Calculating facets`, `Saving measurement`.
- Subscribe/poll job status so the user can leave and return without losing visibility into the run.

4. Remove the “hidden result” trap
- Right now the result is effectively hidden behind manual confirmation or collapsed history.
- Auto-surface the completed measurement when the job finishes:
  - open the review panel automatically, or
  - insert a visible unsaved measurement card at the top of the section
- Keep `measurement_approvals` for approved/saved measurements, but do not use it as the only signal that AI succeeded.

5. Harden completion behavior
- Ensure loading state clears from job completion, timeout, or failure state consistently.
- If the review dialog is closed, the result must still remain accessible on the lead screen.
- Add clearer completion toasts tied to the job/result, not just the dialog flow.

Files likely involved
- `src/components/measurements/PullMeasurementsButton.tsx`
- `src/components/measurements/UnifiedMeasurementPanel.tsx`
- `src/components/measurements/RoofrStyleReportPreview.tsx`
- `supabase/functions/analyze-roof-aerial/index.ts`
- new migration for `measurement_jobs`
- new edge function(s) for async measurement start/status processing

Technical details
- Verified in DB: the lead already has a fresh `roof_measurements` record.
- Verified in DB: the lead has no `measurement_approvals` records.
- So the core issue is not “no measurement was produced”; it is:
  1. the run takes too long synchronously, and
  2. the completed result is not surfaced clearly unless it is manually saved.

Validation after implementation
- Start AI measurement and confirm the UI returns immediately with visible progress
- Confirm a completed result appears on the lead even before manual save
- Confirm saved measurements populate correctly after apply/save
- Test leaving and returning mid-run
- Test the full flow on desktop and mobile with a slow 2+ minute analysis
