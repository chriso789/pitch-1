

# Plan: Fix Back Button and Add Auto-Collapsed Sidebar to Lead Details Page

## Problems Identified

### 1. Missing Sidebar
The Lead Details page (`/lead/:id`) does **not** use `GlobalLayout`, which means there's no sidebar navigation at all. Users have to use browser navigation to get back to the main app.

### 2. Back Button Not Working
The `BackButton` component uses `window.history.length > 2` to detect if there's navigation history. This can fail when:
- User accesses the page directly via URL
- Browser pre-populates history on page load
- SPA routing doesn't increment history as expected

---

## Solution

### Part 1: Wrap LeadDetails in GlobalLayout

Update `src/pages/LeadDetails.tsx` to use `GlobalLayout` wrapper, matching the pattern used by Dashboard, Pipeline, and Settings pages.

**Before:**
```tsx
const LeadDetails = () => {
  // ... component logic
  return (
    <div className="max-w-7xl mx-auto space-y-6 p-3 md:p-6 pb-32 md:pb-16">
      {/* content */}
    </div>
  );
};
```

**After:**
```tsx
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";

const LeadDetailsPage = () => {
  return (
    <GlobalLayout>
      <LeadDetailsContent />
    </GlobalLayout>
  );
};
```

### Part 2: Auto-Collapse Sidebar on Lead Details (Like Settings)

Update `src/components/ui/collapsible-sidebar.tsx` to auto-collapse on `/lead/:id` routes, following the same pattern as the `/settings` route.

**Current (only Settings):**
```typescript
const isSettingsRoute = location.pathname === '/settings' || 
                        location.pathname.startsWith('/settings/');

useEffect(() => {
  if (isSettingsRoute && !isCollapsed) {
    setIsCollapsed(true);
  }
}, [location.pathname, isSettingsRoute]);
```

**Updated (Settings + Lead Details):**
```typescript
const isSettingsRoute = location.pathname === '/settings' || 
                        location.pathname.startsWith('/settings/');
const isLeadDetailsRoute = location.pathname.startsWith('/lead/');

// Auto-collapse on detail pages that need more screen space
const shouldAutoCollapse = isSettingsRoute || isLeadDetailsRoute;

useEffect(() => {
  if (shouldAutoCollapse && !isCollapsed) {
    setIsCollapsed(true);
  }
}, [location.pathname, shouldAutoCollapse]);
```

### Part 3: Fix Back Button Reliability

Update `src/hooks/useBrowserBackButton.tsx` to use a more reliable detection method that doesn't depend solely on `window.history.length`:

**Improved Logic:**
```typescript
const goBack = useCallback(() => {
  // Priority 1: Use explicit navigation state if provided
  if (location.state?.from) {
    navigate(location.state.from);
    return;
  }
  
  // Priority 2: Check if we have any navigation key (React Router assigns these)
  // A key that's not "default" means we navigated here within the SPA
  const hasInternalNavigation = location.key && location.key !== 'default';
  
  if (hasInternalNavigation) {
    navigate(-1);
    return;
  }
  
  // Priority 3: Fall back to explicit path
  navigate(fallbackPath, { replace: true });
}, [navigate, fallbackPath, location.state, location.key]);
```

The `location.key` check is more reliable because React Router assigns a unique key to each navigation entry. If the key is "default", it means the user accessed the page directly (no internal navigation history).

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/LeadDetails.tsx` | Wrap content with `GlobalLayout`, remove padding from outer div (handled by layout) |
| `src/components/ui/collapsible-sidebar.tsx` | Add `/lead/` route to auto-collapse detection |
| `src/hooks/useBrowserBackButton.tsx` | Use `location.key` for more reliable history detection |

---

## Visual Result

**Before:**
- No sidebar on lead details page
- Back button sometimes doesn't work

**After:**
- Collapsed sidebar (minimized icons) on lead details page
- User can expand sidebar to navigate if needed
- Back button reliably navigates to pipeline or previous page

```
┌────────────────────────────────────────────────────────────────┐
│ [≡]     ┌──────────────────────────────────────────────────────┤
│ [📊]    │  ← Back                                              │
│ [📋]    │                                                      │
│ [📞]    │  Nicole Walker      ● Ready For Approval            │
│ [⚙️]    │  1982 Longhorn St, Eustis, FL 32726                  │
│         │                                                      │
│ Icons   │  [Lead content continues...]                         │
│ only    │                                                      │
└────────────────────────────────────────────────────────────────┘
  16px                         Full content area
```

---

## Technical Notes

- The `GlobalLayout` wrapper provides consistent header (search bar, notifications) across all pages
- Auto-collapse gives lead details maximum screen space for estimate work
- Users can manually expand the sidebar at any time using the toggle button
- The `location.key` approach is a documented React Router feature for detecting navigation source

