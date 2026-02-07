# Plan: Fix Back Button and Add Auto-Collapsed Sidebar to Lead Details Page

## ✅ COMPLETED

### Changes Made

1. **LeadDetails wrapped in GlobalLayout** (`src/pages/LeadDetails.tsx`)
   - Added import for `GlobalLayout`
   - Created wrapper component `LeadDetailsPage` that renders `GlobalLayout > LeadDetails`
   - Export the wrapper as default

2. **Auto-collapse sidebar on /lead/ routes** (`src/components/ui/collapsible-sidebar.tsx`)
   - Added `isLeadDetailsRoute` detection for `/lead/` paths
   - Combined with `isSettingsRoute` into `shouldAutoCollapse`
   - Sidebar now auto-collapses on both Settings and Lead Details pages

3. **Fixed back button reliability** (`src/hooks/useBrowserBackButton.tsx`)
   - Changed from `window.history.length > 2` to `location.key !== 'default'`
   - React Router assigns unique keys to SPA navigation entries
   - Key of "default" means direct page access (no SPA history)
   - More reliable detection of internal navigation history

### Result
- Lead Details page now has collapsed sidebar with navigation icons
- Back button works reliably whether accessing via navigation or direct URL
- Consistent layout with Settings page behavior
