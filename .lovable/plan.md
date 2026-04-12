
Issue confirmed. Do I know what the issue is? Yes.

## What is actually wrong
This is not primarily a “valley logic” problem anymore, and it does not look like a simple RLS visibility problem either.

I checked the live data for lead `0e9e4471-3d47-4e1b-b598-148acfcdafad`:

- `measurement_jobs` rows are genuinely completing.
- Example completed job: `72449b2b-7443-4570-91b8-193e7bef8de9`
- It points to measurement id: `a58a31bc-3d04-42e9-96fd-7eecce8d4c7f`
- That id exists in `public.measurements`
- That id does **not** exist in `public.roof_measurements`
- There are **no** `measurement_approvals` rows for this lead

So the app is saying “measurement complete” because the backend did save a result — but it saved it into the wrong data model for the screen you are looking at.

I also verified the saved `measurements` row for that exact id already has:
- `source = google_solar_skeleton`
- `valley_ft = 0`

So for this specific run, the “fake valleys” are not what prevented display. The result exists, but the lead page is reading different tables.

## Current broken sequence
```text
AI Measurements button
-> start-ai-measurement job
-> backend produces a row in public.measurements
-> job marked completed
-> Lead page refreshes roof_measurements + measurement_approvals
-> nothing appears in Saved Measurements
```

## Important code mismatch I found
There is a split-brain system right now:

- The repo version of `start-ai-measurement` still shows a legacy-style handoff
- The live logs show the `measure` function is involved in completed runs
- The UI on `LeadDetails` / `UnifiedMeasurementPanel` is still built around:
  - `roof_measurements`
  - `measurement_approvals`

So the pipeline is not publishing into the same tables the lead page is using.

## Implementation plan

### 1) Unify the AI Measurement button onto one explicit backend path
I will make the job flow explicit and deterministic so there is only one source of truth for this button:

- `AI Measurements` button
- `start-ai-measurement`
- canonical `measure` orchestration
- publish result into the lead-page-visible store(s)
- only then mark the job `completed`

This removes the current ambiguity between `analyze-roof-aerial`, `measure`, `measurements`, and `roof_measurements`.

### 2) Publish the completed result into the tables this lead page actually reads
I will add a publish/bridge step after `measure` succeeds so the lead page can render immediately.

Planned behavior:
- keep the raw/canonical result from `measure`
- create or upsert a matching `roof_measurements` row
- map all needed fields for the existing UI/report/diagram stack:
  - area totals
  - ridge/hip/valley/eave/rake totals
  - imagery URLs
  - footprint/perimeter geometry
  - overlay/report fields
  - confidence / review flags
- use the same UUID when possible so job ids, reports, and viewers stay aligned instead of drifting across tables

This is the real fix for “completed but nothing shows.”

### 3) Tighten the completion gate so “completed” means published, not merely calculated
Right now completion is too optimistic.

I will change the job logic so it only sets:
- `status = completed`
- `measurement_id = ...`

after the UI-facing record is confirmed written successfully.

If calculation succeeds but publish fails, job should become:
- `failed`, or
- a clear partial-publish state via error/progress message

That prevents the false “done” state you’re seeing.

### 4) Fix the lead-page measurement matching bugs
There are a couple of frontend issues that will still bite us even after publish is fixed:

- `UnifiedMeasurementPanel` currently decides an AI result is “already saved” too loosely:
  - it treats any approval with `source = ai_pulled` as matching all future AI runs
- direct save from the AI card is not storing `measurement_id`, which weakens exact matching

I will patch this so:
- AI runs are matched by exact `measurement_id` and/or exact timestamp
- each new run can appear as its own result
- saving to estimates links the saved approval to the correct measurement record

### 5) Preserve the valley/eave fixes in the published row
Because the live `measurements` row for your latest run already shows `valley_ft = 0`, I’ll make sure the bridge/publish step carries over the corrected geometry/totals exactly as produced by the measurement engine.

That means the lead-page diagram/report will use the corrected:
- no-valley result when valley is zero
- footprint-aligned eave/rake geometry
- updated overlay/report payloads

So we do not lose the geometry fixes while fixing publication.

### 6) Fix the build blockers before shipping this
Your preview also has a build/runtime failure:
- dynamic import failure for `LeadDetails.tsx`

That is being caused by TypeScript errors in edge functions. I will clear the current blockers so the measurement fix can actually ship.

Files/errors to clean up:
- `supabase/functions/admin-update-password/index.ts`
  - replace `serve(handler)` with `Deno.serve(handler)`
- `supabase/functions/admin-create-user/index.ts`
  - same `Deno.serve` fix
  - narrow `newUser` typing properly
  - remove nullable access errors around `newUser.user` / `profile`
- `supabase/functions/admin-delete-user/index.ts`
  - narrow `error` from `unknown`
- `supabase/functions/ai-admin-agent/index.ts`
  - remove invalid `.catch()` chained onto Supabase query builder
- `supabase/functions/ai-appointment-scheduler/index.ts`
  - narrow `error`
- `supabase/functions/ai-measurement-analyzer/index.ts`
  - narrow `error`
- `supabase/functions/amb-send/index.ts`
  - guard missing env vars before `fetch`
  - narrow `error`

### 7) Verification after patch
I will verify the exact user path on this lead:

```text
Click AI Measurements
-> job enters queued/processing
-> measure completes
-> roof_measurements row exists for this lead
-> Saved Measurements panel shows latest AI result immediately
-> report dialog opens from that result
-> Save to Estimates creates/updates linked measurement_approval correctly
-> no phantom valleys when latest result says valley = 0
```

## Technical notes
- I do not plan to widen RLS on `roof_measurements`; the live evidence says rows are missing from that table, not merely hidden.
- The live backend currently saved the latest sample into `public.measurements`, which is why the empty state persists.
- The most important architectural fix is to stop letting the measurement button finish in one table while the UI reads another.
