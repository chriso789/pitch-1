

# Vendor Verification — Stuck Sessions Diagnosis & Fix

## Current State (from DB)
- **69 confirmed** (with scores + diagrams) — working correctly
- **2 denied** — working correctly  
- **31 pending** (NULL status/verdict) — stuck, never got picked up
- **12 skipped** — no valid vendor totals (correct)
- **7 failed** — geocoding failures or Google Solar 404s
- **1 processing** — orphaned mid-run

The 31 pending sessions have valid `traced_totals` and coordinates, so they should be eligible. The batch processor IS capable of handling them — it just stopped after earlier runs (the auto-start fires once, processes a chunk, then the `consecutiveEmpty` logic or timeout stops it).

The "Verifying 3 in progress" button text is cosmetic — it shows the count of `processing`/`queued` status rows, which are stale from a previous interrupted run.

## Root Causes

1. **Auto-start runs once only** — `autoStarted.current` is set to `true` on first load and never resets, so revisiting the page doesn't retry the remaining 31.

2. **The batch loop stops too early** — If the edge function times out or returns 0 processed (e.g., all 5 in a chunk needed AI measurements which timed out), `consecutiveEmpty` hits 3 and the loop exits with 31 still pending.

3. **1 orphaned "processing" session** — A session got marked `processing` but the edge function crashed/timed out before completing it. The batch query filters for `verification_status IS NULL`, so this session is now invisible to future batches.

4. **Failed sessions need better retry** — 3 of the 7 failures are "AI measurement engine returned no data" (Google Solar 404 for that address). These are legitimate — some addresses don't have Solar API coverage. But 2 have no address at all.

## Plan (3 changes)

### 1. Fix orphaned sessions — reset stale "processing"/"queued" statuses
In `handleRunBatch`, before starting the batch loop, reset any sessions stuck in `processing` or `queued` status (stale from a previous crashed run) back to NULL so they get picked up.

### 2. Remove auto-start, make the batch loop more resilient
- Remove the `autoStarted` ref and the auto-start `useEffect` — it causes confusion and runs verification without explicit user action.
- Increase `consecutiveEmpty` tolerance from 3 to 5.
- Add a "Retry Failed" button that resets failed sessions and re-runs the batch.

### 3. Fix the "in progress" display when nothing is actually running
The button shows "Verifying X in progress" based on `stats.processing` even when `isRunning` is false. Only show the spinner text when `isRunning` is true. When not running but there are stale processing rows, show "Resume Verification" instead.

## Technical Details
- All changes in `src/components/settings/VendorVerificationDashboard.tsx`
- Edge function reset call already exists (`resetFailed: true`) — extend it to also reset `processing`/`queued` statuses
- Add a pre-batch reset in the edge function's `batch-verify-vendor-reports` action to clear stale `processing`/`queued` rows older than 5 minutes

