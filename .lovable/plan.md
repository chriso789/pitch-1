

## Plan: Two Fixes

### 1. Move Dashboard button from sidebar to top header bar

**What changes:**
- Remove the "Dashboard" entry from the `navigation` array in `Sidebar.tsx`
- Add a Dashboard icon-button in `GlobalLayout.tsx` header, positioned between the search bar (`CLJSearchBar`) and the notification bell (`NotificationCenter`)
- The button navigates to `/dashboard` and highlights when on that route
- Works on both desktop (single-row header) and mobile (row 1, between location switcher and notifications)

**Files:**
- `src/shared/components/layout/Sidebar.tsx` — remove Dashboard from navigation array (lines 209-217)
- `src/shared/components/layout/GlobalLayout.tsx` — add Dashboard icon-button in header between search and notifications (desktop and mobile layouts)

### 2. Fix Estimates page not showing Tristate estimates

**Root cause:** The Estimates page derives `tenantId` from `user?.active_tenant_id || user?.tenant_id` via `useCurrentUser`. This does NOT check the company switcher's active company (`useCompanySwitcher` / `useEffectiveTenantId`), which is the source of truth when a user switches companies. The pipeline and other pages were already fixed to use the unified tenant hook — the Estimates page was missed.

Tristate has 8 estimates in the database (tenant `76ee42a0-...`), but the page queries with the wrong tenant ID.

**Fix:**
- Replace the manual `user?.active_tenant_id || user?.tenant_id` derivation with `useEffectiveTenantId()` hook
- Gate the fetch on `effectiveTenantId` being resolved (not null)
- Keep all existing filters and role-based scoping unchanged

**File:**
- `src/features/estimates/components/Estimates.tsx` — import and use `useEffectiveTenantId`, replace line 55's manual derivation

### Technical detail

```typescript
// Estimates.tsx — before
const tenantId = user?.active_tenant_id || user?.tenant_id;

// Estimates.tsx — after
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
const effectiveTenantId = useEffectiveTenantId();
// Use effectiveTenantId in the query instead of tenantId
```

