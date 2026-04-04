
Do I know what the issue is? Yes.

What is actually happening
- This is not a real dev-server crash loop. The dev-server log stays stable, while the browser logs repeatedly show `[vite] server connection lost. Polling for restart...` and the network shows repeated `text/x-vite-ping` 204 responses.
- That means the HMR websocket is dropping, Vite falls back to ping mode, sees the server is alive, and reloads the page over and over.
- The current route “grouping” did not actually make boot light: `src/App.tsx` still imports `publicRoutes`, `mobileRoutes`, `protectedRoutes`, and `adminRoutes` synchronously, and those files still evaluate about 135 `React.lazy()` declarations up front.
- So `/` and `/login` are still paying for almost the entire app graph.
- Public boot is also doing extra work every remount: `LandingPage` and `Login` both run their own session-check/redirect effects, and public tracking still runs on the landing page.
- Several critical flows still use hard reloads (`window.location.href`), which can re-trigger the unstable path once the user gets into the app.

Implementation plan
1. Make app boot truly small
- Refactor `src/App.tsx` so only landing/auth pages stay eager.
- Replace imported route fragments with lazily loaded section router components:
  - public portal/report routes
  - protected app routes
  - admin routes
  - mobile routes
- Load each section only when its path prefix matches, so `/` and `/login` stop importing the rest of the product.

2. Simplify public auth flow
- Update `src/pages/LandingPage.tsx` and `src/pages/Login.tsx` to rely on `AuthContext` instead of separate `supabase.auth.getSession()` boot effects.
- Remove duplicate redirect logic and only redirect after auth state is settled once.
- Keep password-setup behavior, but move it into one consistent path.

3. Remove forced reloads from auth/company/location flows
- Replace hard redirects in:
  - `src/components/auth/LocationSelectionDialog.tsx`
  - `src/components/auth/ProtectedRoute.tsx`
  - `src/hooks/useCompanySwitcher.tsx`
  - `src/components/layout/QuickLocationSwitcher.tsx`
  - `src/shared/components/LocationSwitcher.tsx`
- Use router navigation plus targeted cache/context refresh instead of `window.location.href`.

4. Reduce preview-only boot noise
- Gate public marketing/page tracking in preview/dev (`src/lib/analytics/usePageTracking.ts` and `src/lib/analytics/trackingService.ts`).
- Keep service workers disabled in preview/dev, and make sure push worker registration remains opt-in only.
- Leave production behavior unchanged.

5. Tighten preview HMR behavior
- Keep the preview-safe Vite websocket settings, but simplify/tighten `vite.config.ts` so the client does not keep bouncing between websocket failure and ping-reload fallback.
- If needed after the route split, use a preview-only stability fallback that prioritizes a usable preview over aggressive hot reload behavior.

Files to update
- `src/App.tsx`
- `vite.config.ts`
- `src/pages/LandingPage.tsx`
- `src/pages/Login.tsx`
- `src/routes/*` (restructure from eager route fragments to lazy section routers)
- `src/components/auth/LocationSelectionDialog.tsx`
- `src/components/auth/ProtectedRoute.tsx`
- `src/hooks/useCompanySwitcher.tsx`
- `src/components/layout/QuickLocationSwitcher.tsx`
- `src/shared/components/LocationSwitcher.tsx`
- `src/lib/analytics/usePageTracking.ts`
- `src/lib/analytics/trackingService.ts`

Validation
- Open `/` and confirm it stays stable for at least 60 seconds with no recurring Vite reconnect message.
- Confirm the login form stays clickable and does not reset.
- Sign in and verify `/dashboard` loads without a reload loop.
- Open Manage Companies and confirm it stays in SPA navigation instead of hard-refreshing.

Technical details
- The key fix is not “more lazy imports.” It is changing where route modules are imported. Right now the heavy route files are still imported on first paint, so the preview never gets a truly lightweight boot path.
