
Diagnosis

- Do I know what the issue is? Mostly yes.
- I do not see a current React runtime crash in the available snapshots. The stronger pattern in the code is:
  1. `/` auto-redirects signed-in users to `/dashboard`, so a downstream boot failure can look like a blank home page.
  2. `CompanySwitcher` opens Manage All Companies with `window.location.href = '/admin/companies'`, which forces a full reload into one of the heaviest routes.
  3. `CompanyAdminPage` is route-lazy, but once opened it still pulls a very large admin bundle with multiple heavy management tools.
  4. `App.tsx` still starts monitoring, fetch interception, and global activity tracking immediately on boot, which adds preview overhead.
  5. There is also a real company-management bug: `LocationManagement` creates new locations with the logged-in user's `profile.tenant_id` instead of the company being edited.

Plan

1. Remove hard reloads for normal internal navigation
- Replace the Manage All Companies `window.location.href` navigation with React Router `navigate('/admin/companies')`.
- Audit similar nonessential hard reloads and keep full reloads only for true tenant/location context resets.

2. Break up the company admin route
- Keep the main company list eager.
- Lazy-load the heavy admin sections only when needed:
  - Demo Requests
  - Feature Control
  - Locations tab
  - Emails/Templates tab
  - Website/logo tools
- Add local `Suspense` fallbacks so the page shows a loading state instead of looking blank.

3. Reduce preview boot work
- In preview/dev, defer or disable nonessential startup tasks from `App.tsx`:
  - monitoring initialization
  - fetch interceptor installation
  - global activity tracking
- Start them after first paint or only in production.

4. Fix company management tenant scoping
- Update `LocationManagement` to use `tenantId || activeCompanyId` consistently for inserts/updates.
- This prevents admin actions from writing locations into the wrong company or failing unexpectedly.

5. Harden the admin route
- Add a role-aware guard before loading the heavy company admin UI.
- If admin data fails to load, show an inline recovery state instead of a visually blank page.

Files to update

- `src/components/layout/CompanySwitcher.tsx`
- `src/pages/admin/CompanyAdminPage.tsx`
- `src/components/settings/LocationManagement.tsx`
- `src/App.tsx`
- likely `src/hooks/useGlobalActivityTracking.ts`
- likely `src/lib/MonitoringSelfHealing.ts`

Validation

- Load the app from `/` while signed in and confirm it no longer lands on a white screen.
- Open Manage All Companies from the header and confirm it navigates without a full reload.
- Open a company, switch tabs, and confirm loaders appear while admin sections load.
- Add a location while editing a different company and confirm it saves to that company.
- Refresh on `/admin/companies` and confirm the route still renders.
