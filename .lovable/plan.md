
Goal
- Restore “AI Measurements” so it successfully calls the `analyze-roof-aerial` Supabase Edge Function (no more “Failed to send a request to the Edge Function”).

What’s actually broken (confirmed)
- The `analyze-roof-aerial` edge function is not booting.
- Supabase edge logs show: `worker boot error: Uncaught SyntaxError: Identifier 'segmentCount' has already been declared`.
- In `supabase/functions/analyze-roof-aerial/index.ts`, inside `processSolarFastPath()`, `segmentCount` is declared twice with `const`:
  - First declaration around line ~4907
  - Second declaration around line ~5046
- Because the worker fails to boot, the frontend can’t reach the function, and the UI surfaces it as a request failure.

Implementation approach (fix the root cause)
1) Fix the duplicate variable declaration in the edge function
- Edit: `supabase/functions/analyze-roof-aerial/index.ts`
- In `processSolarFastPath()`:
  - Keep a single `segmentCount` (or rename it to something clearer like `solarSegmentCount`)
  - Remove the second `const segmentCount = solarData.roofSegments.length`
  - Ensure all later uses (roof type, complexity, facet_count, hipLength, etc.) reference the single variable.
- This is a “boot-blocking” syntax fix; no behavior changes beyond making the function runnable again.

2) Re-deploy the edge function
- Deploy `analyze-roof-aerial` to the Test environment.
- Immediately re-check edge logs to confirm the worker boots cleanly (no “worker boot error”).

3) Verify end-to-end from the app UI
- In the UI, click “AI Measurements” again.
- Confirm:
  - The function request returns a response (no toast saying request failed).
  - The measurement pipeline completes (success toast or “requires review” toast).
  - New measurement row appears in Saved Measurements and/or Measurement History.
- If the function returns an application-level error (different from “failed to send request”), we’ll then debug that specific error message (but we must first get the function booting).

4) Add lightweight guardrails (optional but recommended)
- Improve the frontend error surface in `src/components/measurements/PullMeasurementsButton.tsx`:
  - When `supabase.functions.invoke` returns an `error`, show a more descriptive toast including `error.message` and (when available) the function name so it’s obvious which service failed.
  - This won’t fix the backend error, but it will prevent ambiguous “failed to send request” situations in the future.

Files involved
- Backend (required):
  - `supabase/functions/analyze-roof-aerial/index.ts` (remove/rename duplicate `segmentCount` declaration in `processSolarFastPath`)
- Frontend (optional polish):
  - `src/components/measurements/PullMeasurementsButton.tsx` (more informative toast/error reporting when invoke fails)

Validation checklist (definition of done)
- Edge logs no longer show “worker boot error” for `analyze-roof-aerial`.
- Clicking “AI Measurements” results in a successful function call (network request completes).
- A new measurement is created or a clear application-level error is returned (not a request failure).
- UI updates (Saved Measurements / Measurement History) reflect the new run.

Risks / edge cases
- After the worker boots, there may be additional runtime errors (e.g., missing secrets, upstream provider failure, RLS access). If that happens, we’ll address the next error shown in edge logs—right now the function can’t even start, so we can’t reach those layers yet.
