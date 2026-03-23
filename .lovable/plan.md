
Goal: stop the live canvassing map from opening in Tampa after Chris has already allowed location, and only center the map when we have a trustworthy position.

Plan

1. Harden the initial location flow in `src/pages/storm-canvass/LiveCanvassingPage.tsx`
- Stop treating the hardcoded Tampa coordinates as a real starting location.
- Keep the map usable, but avoid locking the first visible center to Tampa when GPS is still unresolved.
- Add a “waiting for reliable fix” state so the first accepted location comes from an actual geolocation result, not the fallback.

2. Add location quality rules in `src/services/locationService.ts`
- Preserve the original geolocation error codes on `getCurrentLocation`, just like `watchLocation` already does.
- Reject obviously poor fixes for initial centering (for example, very low-confidence / very high-accuracy-radius results).
- Prefer a fresh GPS result over coarse network/IP fallback, even when permission is granted.
- Continue using the location watch to refine the position after load, but only promote a reading to the map when it passes the confidence threshold.

3. Improve live recovery when the browser first returns a bad fix
- If the first result is still coarse or wrong, keep retrying in the background instead of accepting it as the map center.
- Once a better fix arrives, immediately recenter the map and update the address.
- Do not let a single bad first reading “win” for the whole session.

4. Remove the misleading Tampa fallback behavior
- Replace the current hardcoded Tampa startup experience with a safer fallback:
  - either a neutral/non-user-specific map state, or
  - the assigned area view when available.
- This prevents the app from implying Chris is in Tampa before real GPS is confirmed.

5. Add a manual recovery control in the canvassing UI
- Add a “Center on My Location” / “Retry GPS” action so Chris can force another recenter attempt if mobile Safari/Chrome gives a bad first fix.
- This gives field reps a fast way to recover without reloading the whole page.

Likely root cause
- The app still boots from a hardcoded Tampa default.
- The first geolocation result can still be a coarse or wrong browser/network-based position.
- The current code accepts that first result too easily and doesn’t distinguish “permission granted” from “location accurate enough to trust.”

Files to update
- `src/pages/storm-canvass/LiveCanvassingPage.tsx`
- `src/services/locationService.ts`
- likely `src/components/storm-canvass/GoogleLiveLocationMap.tsx` if we add a recenter control or improve first-center behavior

Expected result
- Chris no longer sees Tampa as his apparent live location after granting location access.
- The map waits for a trustworthy fix before treating it as “his location.”
- If the browser gives a bad first fix, the app self-corrects and also provides a manual retry/recenter option.
