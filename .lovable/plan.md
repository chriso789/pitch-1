

## Two Issues: Demo Request Email Delivery + Feature Toggle Enforcement

### 1. Demo Request Emails

**Current state:** Demo requests are saved to the `demo_requests` table and an email is sent via the `send-demo-request` edge function using Resend. The email goes to `demos@pitch-crm.ai` — but there are no edge function logs, which means the function may not be deployed or is failing silently.

**What's in the database:** 2 demo requests exist — one from Maria Hartley (Cox Roofing, converted) and one from Jared Janacek (O'Brien Contracting, still "new" status). Both show `email_sent: true`, so the emails were sent at some point.

**The problem:** The recipient address is `demos@pitch-crm.ai`, which is a domain you'd need to have configured to actually receive mail. If that inbox isn't set up, emails are being sent into the void. Additionally, there's no in-app notification system — you only find out about demo requests by checking the Demo Requests tab in the admin panel or checking that email inbox.

**What I'll build:**
- Add a real-time notification to the admin dashboard when new demo requests come in
- Update the `send-demo-request` edge function to also send a copy to your actual email (e.g. `chrisobrien91@gmail.com` as BCC or primary recipient)
- Add an in-app notification badge on the Demo Requests tab so you can see new requests at a glance
- Redeploy the edge function to ensure it's active

### 2. Feature Toggle Buttons — Already Working, But Not Enforced

**Current state:** The `CompanyFeatureControl` component already has working toggle switches. They correctly read/write the `features_enabled` array on the `tenants` table. The database shows some companies have features set (e.g., East Coast Roofing has all 10 enabled) while others have empty arrays (e.g., C-Side Roofing, Coating Kingz, The Roof Panda, Tristate).

**The real problem:** The feature toggles save to the database, but **nothing in the app actually checks `features_enabled`**. There is no hook, context, or gate that reads a tenant's enabled features and hides/shows sidebar items, routes, or page sections. The toggles are cosmetic right now.

**What I'll build:**
- Create a `useFeatureAccess` hook that fetches the current tenant's `features_enabled` and exposes a `hasFeature(key)` check
- Wire it into the sidebar navigation to hide/show menu items based on enabled features
- Add route-level guards so disabled features show a "Feature not available" page instead of the full UI
- Map each sidebar item and route to its feature key (pipeline, estimates, dialer, etc.)

### Files to create/modify

| File | Change |
|------|--------|
| `src/hooks/useFeatureAccess.ts` | New — hook to check tenant feature access |
| `src/components/layout/Sidebar.tsx` (or equivalent) | Gate menu items by feature |
| `src/components/admin/FeatureGate.tsx` | New — wrapper component for feature-gated content |
| `supabase/functions/send-demo-request/index.ts` | Add your email as BCC, redeploy |
| `src/components/settings/DemoRequestsPanel.tsx` | Add notification badge for new/unread count |
| `src/pages/admin/CompanyAdminPage.tsx` | Show badge on Demo Requests tab |

### Technical details

- The `useFeatureAccess` hook will query `tenants.features_enabled` for the active tenant and cache it with React Query
- Sidebar items will be filtered: if the tenant doesn't have `dialer` in their features, the Power Dialer link disappears
- Feature keys map: `pipeline` → Pipeline, `estimates` → Estimates, `dialer` → Power Dialer, `smart_docs` → Smart Docs, `measurements` → AI Measurements, `projects` → Projects, `storm_canvass` → Storm Canvass, `territory` → Territory, `photos` → Photos, `payments` → Payments
- Demo notification email will BCC your master account email so you get notified immediately when someone requests a demo

