

## Diagnosis: HMR Reconnection Loop Causing Constant Refresh

**What is happening:** The Vite dev server is running fine (no crashes in logs), but the HMR WebSocket connection keeps dropping and reconnecting. Each reconnection triggers a full page reload, creating the "constant refresh" loop you see. The login page briefly appears, then the connection drops, and the cycle repeats.

**Root cause:** The module graph is enormous — 119 `React.lazy()` calls plus ~25 eager imports plus all context providers. Vite's HMR client has to track all of these, and the preview proxy connection is unstable under this load. Additionally, `ErrorTrackingProvider` fires a `scrub-merged.json` fetch on every mount (always 404), adding noise to every reload cycle.

**Why previous fixes didn't fully work:** The lazy loading reduced the *initial transform* load but didn't reduce the *HMR tracking* load — Vite still registers all 119 lazy entry points in its module graph.

## Plan

### 1. Group lazy routes into chunked barrel files
Instead of 119 individual `React.lazy()` calls in App.tsx, create 4-5 route group files that each export their routes as a single lazy unit:
- `src/routes/publicRoutes.tsx` — public/portal pages (~15 routes)
- `src/routes/protectedRoutes.tsx` — main app pages (~40 routes)  
- `src/routes/adminRoutes.tsx` — admin pages (~20 routes)
- `src/routes/mobileRoutes.tsx` — mobile pages (~5 routes)
- `src/routes/settingsRoutes.tsx` — settings pages (~20 routes)

App.tsx then has ~5 lazy imports instead of 119, drastically reducing HMR pressure.

### 2. Stop scrubber polling on mount
Gate the `scrubberReportService.loadScrubberReport()` call in `useErrorTracking.tsx` behind `import.meta.env.PROD` so it doesn't fire 404 requests on every preview reload cycle.

### 3. Add HMR timeout configuration
In `vite.config.ts`, add `hmr.timeout: 60000` to give the WebSocket more time before declaring the connection lost.

### Files to change

| File | Change |
|------|--------|
| `src/routes/publicRoutes.tsx` | New — exports public `<Route>` elements |
| `src/routes/protectedRoutes.tsx` | New — exports protected `<Route>` elements |
| `src/routes/adminRoutes.tsx` | New — exports admin `<Route>` elements |
| `src/routes/mobileRoutes.tsx` | New — exports mobile `<Route>` elements |
| `src/routes/settingsRoutes.tsx` | New — exports settings `<Route>` elements |
| `src/App.tsx` | Replace 119 lazy imports with 5 grouped route imports |
| `src/hooks/useErrorTracking.tsx` | Gate scrubber report loading to production only |
| `vite.config.ts` | Add `hmr.timeout: 60000` |

### Expected outcome
- App.tsx shrinks from 427 lines to ~80 lines
- HMR tracks ~5 lazy modules instead of 119
- Preview stops the constant refresh loop
- No scrubber 404 noise in dev

