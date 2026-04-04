
Diagnosis

- This looks like a preview boot problem, not a normal in-app React crash.
- I checked the code and found 3 likely causes working together:
  1. `src/App.tsx` eagerly imports a very large part of the product up front (roughly the entire route tree), so `/` depends on many heavy pages that are unrelated to the landing page.
  2. `vite.config.ts` has no explicit HMR settings, and the preview console shows Vite’s websocket failing against the proxied Lovable URL.
  3. The app registers a service worker in `src/App.tsx` even during preview/dev, and both `public/sw.js` and `public/service-worker.js` use overlapping cache behavior (`pitch-crm-v1`). That can survive refreshes, which explains why refreshing 10 times does not help.

Do I know what the issue is?

- Yes: the app is likely failing before React fully mounts in preview, so you get a blank white shell instead of an error screen. This is why there are no runtime errors from React, but the page still appears empty.

Plan

1. Fix preview websocket/HMR setup
- Update `vite.config.ts` so HMR is configured for the Lovable preview proxy instead of default localhost behavior.
- Keep the current host/port, but add explicit preview-safe HMR settings (`wss` / client port 443 style config).

2. Disable service workers in preview/dev
- In `src/App.tsx`, only register `/sw.js` in production.
- In preview/development, proactively unregister any existing service workers and clear their caches so stale preview shells do not keep winning after refresh.
- Review `public/sw.js` and `public/service-worker.js` so they do not interfere with preview boot.

3. Stop loading the whole app on `/`
- Refactor `src/App.tsx` to lazy-load large route pages instead of statically importing everything.
- Keep the landing/auth pages eager.
- Lazy-load protected/admin/storm-canvass/detail pages behind `React.lazy` + `Suspense`.
- This isolates `/` from unrelated files like `LeadDetails`, `ContactProfile`, etc.

4. Add a real boot fallback
- Wrap lazy routes with a simple fallback/loading screen and a retry path so a failed chunk/module load shows something useful instead of a white page.

Files to change

- `vite.config.ts`
- `src/App.tsx`
- `public/sw.js`
- `public/service-worker.js`
- possibly `src/services/pushNotifications.ts` if push-worker registration also needs production-only gating

Technical details

- `src/App.tsx` currently imports nearly all routes at startup, which is expensive in Vite preview.
- `src/App.tsx` also registers `/sw.js` on mount without checking `import.meta.env.PROD`.
- `public/sw.js` caches documents and static assets broadly, and both service worker files reuse `pitch-crm-v1`.
- Preview console already confirms a Vite websocket problem, while runtime error snapshots show no React crash. That combination points to preview startup/module-loading instability rather than a broken landing page component.

Expected outcome

- The preview root page should render consistently again.
- Hard refreshes should stop getting stuck on a blank white screen.
- Published behavior should remain unchanged.
