
Do I know what the issue is? Yes.

## What is actually happening

The map is staying at the same spot because the app is often never getting a usable live GPS fix on initial load, so it falls back to the assigned-area/contact centroid and keeps showing that location until a later watch update succeeds.

The console logs show the exact failure chain:
- `Position update is unavailable` (`code: 2`)
- then repeated `Timeout expired` (`code: 3`)
- after 10 seconds the page auto-dismisses GPS loading and centers on the fallback area
- that fallback is what you are seeing “stuck” on the map

There is also a second problem making this worse:
- `GPSTrailService` is starting twice
- two trail sessions are created at the same time
- this comes from React Strict Mode mount behavior plus the current start logic
- that means multiple high-accuracy geolocation watchers are running at once, which can interfere with stability on mobile Safari / iPhone

## Exact problem

This is not mainly a map-rendering bug. It is a GPS acquisition/state-management bug:

1. `LiveCanvassingPage.tsx`
   - initial GPS acquisition is still too fragile for first load
   - after failure, fallback centroid is promoted too early
   - `hasGPS` becomes `true` even when the app is only showing fallback, which hides the real GPS failure state

2. `gpsTrailService.ts`
   - starts a second geolocation watch during page startup
   - duplicate watcher/session behavior is visible in the logs

3. `locationService.ts`
   - watch handling is better than before, but it still has no explicit “recover from code 2 by restarting watch” strategy
   - background geocoding is fine now, but the page still depends too heavily on first-lock success

## Plan

### 1. Separate “real GPS lock” from “fallback map center”
Update `LiveCanvassingPage.tsx` so fallback positioning does not pretend to be GPS:
- keep a separate state for `hasRealGpsLock`
- keep fallback centroid display separate from live GPS state
- do not mark GPS as acquired when only fallback is shown
- keep retrying for a real lock even after fallback map center is displayed

Result: the map can show the work area immediately, but still switch to the real moving user location the moment GPS succeeds.

### 2. Make initial GPS acquisition use the same resilient fallback strategy as recenter
Right now recenter has a better two-stage strategy than first load. I’ll align them:
- first-load GPS attempt: strict fresh fix
- automatic fallback attempt: relaxed cached fix for Safari/mobile recovery
- if both fail, show area center visually but continue silent background retries until a valid moving fix arrives

Result: first page load behaves like the recenter button instead of failing into a static map.

### 3. Prevent duplicate geolocation watchers from GPS trail recording
Update `gpsTrailService.ts` so it cannot start multiple concurrent watch sessions:
- add an idempotent start guard
- ignore duplicate starts for the same user/session mount cycle
- harden cleanup so Strict Mode remounts do not leave overlapping watches behind

Result: only one trail watch and one UI watch run as intended.

### 4. Add watch recovery for `POSITION_UNAVAILABLE`
Update `locationService.ts` / page watch handling to recover from `code: 2`:
- if the watch reports repeated `POSITION_UNAVAILABLE`, restart the watcher after a short backoff
- keep timeout errors non-fatal
- only accept fixes that pass the existing accuracy/jump filters

Result: the app can recover instead of sitting on fallback indefinitely.

### 5. Keep knock mode aggressively locked to the real user once a valid fix exists
After GPS lock is recovered:
- force map follow in knock mode from the real live coordinates
- keep manual interaction pause logic only after a genuine user drag
- if app is currently on fallback and a real GPS fix arrives, immediately snap from fallback center to live user center

Result: once location resolves, the map follows the canvasser instead of lingering on the old fallback point.

## Files to modify

| File | Change |
|---|---|
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Separate fallback vs real GPS state, improve initial acquisition, continue retries after fallback |
| `src/services/gpsTrailService.ts` | Prevent duplicate recording/watch sessions, harden Strict Mode behavior |
| `src/services/locationService.ts` | Add watcher recovery/restart strategy for repeated `code: 2` failures |

## Technical details

- Root cause confirmed from logs: `code: 2` and `code: 3` prevent first GPS lock, then fallback centroid becomes the visible map center.
- Duplicate evidence from logs: two `GPSTrailService` sessions start at the same timestamp.
- The “same location” symptom is therefore mostly the fallback center being shown as if it were live GPS.
- I do not need to change the database for this fix; this is client-side GPS/watch orchestration and map-state handling.
