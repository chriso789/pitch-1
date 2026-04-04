
Diagnosis

- I do know the current issue closely now.
- The repeated refresh is still a preview HMR reconnect loop, not a normal React crash:
  - console shows `[vite] server connection lost. Polling for restart...`
  - network shows repeated `text/x-vite-ping` 204 requests
  - dev-server log stays alive instead of crashing
- The earlier preview-noise work is mostly already done:
  - monitoring/fetch interception are production-only
  - marketing page tracking is production-only
  - service workers are being disabled in preview
- Two blockers remain:
  1. `vite.config.ts` is still forcing a custom HMR transport (`wss` + `clientPort: 443`), and the websocket is still not staying connected.
  2. There is a real lazy-chunk failure now: runtime errors show `Failed to fetch dynamically imported module: /src/routes/adminRoutes.tsx`, which explains why Manage Companies breaks.

What I would change

1. Stabilize preview first
- Simplify `vite.config.ts` and remove the aggressive custom HMR override that is keeping the client in ping/reload mode.
- If the preview proxy still refuses websocket stability, use the safer fallback for preview/dev: prioritize a stable page over HMR convenience.

2. Remove the fragile extra lazy boundary around section-router files
- In `src/App.tsx`, stop lazy-loading the small route-wrapper files that are now becoming their own failing chunks.
- Keep the truly heavy protected app section lazy.
- Make `adminRoutes`, `settingsRoutes`, and likely `publicRoutes` normal imports again, while leaving page-level lazy loading inside them.
- This keeps boot smaller where it matters, but removes the broken `/src/routes/adminRoutes.tsx` dynamic import.

3. Repair the admin route group specifically
- Clean up `src/routes/adminRoutes.tsx` so it only contains admin routes it actually serves.
- Remove unused settings-page lazy imports from that file.
- Verify the admin section can load independently without taking down the whole preview.

4. Reduce public-route boot churn
- In `src/App.tsx` and `src/pages/Login.tsx`, trim duplicate `supabase.auth.getSession()` checks on public boot.
- Keep a single auth-ready path driven by `AuthContext` where possible.
- This won’t fix the websocket by itself, but it will make `/login` less noisy once the preview is stable.

5. Remove the remaining forced reloads that can re-trigger the broken path
- Replace remaining hard reloads in:
  - `src/hooks/useCompanySwitcher.tsx`
  - `src/components/auth/ProtectedRoute.tsx`
- Use router navigation plus context/query refresh instead of `window.location.href`.

Files to update

- `vite.config.ts`
- `src/App.tsx`
- `src/routes/adminRoutes.tsx`
- likely `src/routes/settingsRoutes.tsx`
- likely `src/routes/publicRoutes.tsx`
- `src/pages/Login.tsx`
- `src/components/auth/ProtectedRoute.tsx`
- `src/hooks/useCompanySwitcher.tsx`

Validation

- Open `/login` and confirm it stays stable for at least 60 seconds with no repeated Vite reconnect message.
- Confirm the login form is clickable and does not reset while typing.
- Open `/admin/companies` and confirm the admin section loads without the lazy-module fetch error.
- Sign in and verify `/dashboard` loads without a reload loop.
- Switch company and confirm it stays in SPA navigation instead of hard-refreshing.

Technical details

- The newest evidence shifts the priority:
  - route splitting and preview gating were not enough
  - the remaining root cause is now the preview HMR transport plus one broken lazy section import
- The most important implementation change is to stop making tiny route-wrapper modules into extra dynamic chunks when they do not materially reduce boot cost but can fail independently.
