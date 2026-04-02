

## Plan: Scope Recent Searches by Active Tenant

### Problem
Recent searches are stored in localStorage under a single key (`pitch-recent-searches`), so when a user switches company profiles (e.g., from Tristate Contracting to O'Brien Contracting), they still see search history from the other company.

### Fix

**File: `src/components/CLJSearchBar.tsx`**

Change the localStorage key to include the active tenant ID, so each company gets its own recent searches history.

1. Update `loadRecents` and `saveRecent` to accept a `tenantId` parameter and use a tenant-scoped key: `pitch-recent-searches-{tenantId}`
2. Update `clearRecents` similarly
3. Update all call sites to pass `activeTenantId`

```typescript
// Before
const RECENT_SEARCHES_KEY = 'pitch-recent-searches';
const loadRecents = (): SearchResult[] => { ... };
const saveRecent = (result: SearchResult) => { ... };

// After
const getRecentsKey = (tenantId: string) => `pitch-recent-searches-${tenantId}`;
const loadRecents = (tenantId: string | null): SearchResult[] => {
  if (!tenantId) return [];
  try {
    return JSON.parse(localStorage.getItem(getRecentsKey(tenantId)) || '[]');
  } catch { return []; }
};
const saveRecent = (result: SearchResult, tenantId: string | null) => {
  if (!tenantId) return;
  const existing = loadRecents(tenantId);
  const filtered = existing.filter(r => r.entity_id !== result.entity_id);
  const updated = [result, ...filtered].slice(0, MAX_RECENTS);
  localStorage.setItem(getRecentsKey(tenantId), JSON.stringify(updated));
};
```

Single-file change, ~10 lines modified.

