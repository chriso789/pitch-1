## Problem

The Settings sidebar (`src/features/settings/components/Settings.tsx`) does not include a "Company Referrals" entry, so users can't reach the B2B referral program UI from Settings. The page exists at `/settings/company-referrals` (`CompanyReferralSettingsPage`) but is only accessible by direct URL.

Settings tabs are DB-driven via the `settings_tabs` table, with a small allowlist of synthetic injections (e.g. `supplier-connections`) appended in `loadTabConfig`. The cleanest minimal fix is to add a synthetic "Company Referrals" tab the same way and render the referrals UI inline via a new `case` in `renderTabContent`.

## Changes

1. **`src/features/settings/components/Settings.tsx`**
   - Add a synthetic Business-category tab `company-referrals` right after the existing `supplier-connections` injection (label: "Company Referrals", icon: `Handshake`, description: "B2B partner referral program").
   - Add `"company-referrals": "business"` to `TAB_TO_CATEGORY`.
   - Import the four panel components already used by `CompanyReferralSettingsPage` (`CompanyReferralSettingsPanel`, partners table, signups, payouts, credits, flags, analytics, and the create-partner dialog), plus `useEffectiveTenantId`, `Tabs`, etc.
   - Add a `case "company-referrals":` in `renderTabContent()` that renders the same Tabs UI as `CompanyReferralSettingsPage` (Program Settings / Partners / Signups / Payouts / Credits / Flags / Analytics), scoped to `useEffectiveTenantId()`.

2. No DB migration, no route changes, no business-logic changes. The standalone `/settings/company-referrals` page keeps working.

### Pseudocode

```ts
// TAB_TO_CATEGORY
"company-referrals": "business",

// after supplier-connections synthetic
if (!groups["business"].some(t => t.tab_key === "company-referrals")) {
  groups["business"].push({
    id: "company-referrals-synthetic",
    tab_key: "company-referrals",
    label: "Company Referrals",
    description: "B2B partner referral program",
    icon_name: "Handshake",
    order_index: 100,
    is_active: true,
    required_role: null,
  });
}

// renderTabContent
case "company-referrals":
  return <CompanyReferralsSettingsSection tenantId={effectiveTenantId} />;
```

Where `CompanyReferralsSettingsSection` is a small inline component (or extracted helper) mirroring `CompanyReferralSettingsPage`'s body.

## Out of Scope

- No relaxation of measurement / DSM / customer-report gates.
- No edits to `start-ai-measurement` or related edge functions.
- No new RLS / DB migrations.