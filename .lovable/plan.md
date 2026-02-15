

# Fix Three Issues: Post-Logout Buttons, Storm Canvas Mobile, Territory 404

## Issue 1: Buttons Not Working After Logout on Landing Page

**Root Cause:** The `clearAllSessionData()` function in `src/services/sessionManager.ts` wipes ALL `pitch_*` prefixed localStorage keys (line 132). This deletes `pitch_consent` (the cookie consent preference), causing the ConsentBanner to reappear every time the user logs out. Additionally, it clears `sb-*` keys (Supabase auth tokens) BEFORE `supabase.auth.signOut()` completes in the Sidebar handler, which can cause the signOut call to fail silently and leave the app in a broken state where event handlers stop working.

**Fix in `src/services/sessionManager.ts`:**
- Preserve the `pitch_consent` key during cleanup (it's a site-wide preference, not a session artifact)
- Preserve `pitch_remember_me` as it's also a UI preference

**Fix in `src/shared/components/layout/Sidebar.tsx`:**
- Reorder: call `supabase.auth.signOut()` FIRST, then `clearAllSessionData()` after, so the sign-out API call completes before tokens are destroyed
- Add navigation to `/login` instead of `/` to avoid the landing page auth-check redirect loop

## Issue 2: Storm Canvas Stat Cards Too Large on Mobile

**Root Cause:** The stat cards in `src/pages/StormCanvassPro.tsx` use a `md:grid-cols-4` grid, so on mobile they stack into a full-width vertical list with large `text-2xl` numbers, causing excessive scrolling before reaching the action buttons (Live Canvassing, Manage Territories, etc.).

**Fix in `src/pages/StormCanvassPro.tsx`:**
- Change the stats grid to `grid-cols-2 md:grid-cols-4` so stats show in a 2x2 grid on mobile
- Reduce stat number size to `text-lg` on mobile (`text-lg md:text-2xl`)
- Reduce card padding on mobile with `pb-1 md:pb-2` on CardHeader and compact CardContent
- Make the header and badge more compact on mobile

## Issue 3: "Manage Territories" Button Returns 404

**Root Cause:** The button in `StormCanvassPro.tsx` navigates to `/storm-canvass/territories` (line 232), but no such route exists in `App.tsx`. The Territory Map page is registered at `/storm-canvass/map` (line 253).

**Fix in `src/pages/StormCanvassPro.tsx`:**
- Change the navigate path from `/storm-canvass/territories` to `/storm-canvass/map`

## Summary of All File Changes

| File | Change |
|------|--------|
| `src/services/sessionManager.ts` | Preserve `pitch_consent` and `pitch_remember_me` during session cleanup |
| `src/shared/components/layout/Sidebar.tsx` | Reorder signOut before clearAllSessionData; navigate to `/login` |
| `src/pages/StormCanvassPro.tsx` | Fix territory route to `/storm-canvass/map`; make stat cards compact on mobile (2-col grid, smaller text) |

