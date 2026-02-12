

## Fix Pipeline Search Autopopulate + Speed Up Pipeline

### 1. Fix Search Autopopulate Bug (PipelineSearch.tsx)

The suggestions filter accesses the wrong field paths. The pipeline entries have contact data nested under `contacts`, but the search looks at the top level.

**File: `src/features/pipeline/components/PipelineSearch.tsx` (lines 54-58)**

Change:
```
entry.first_name -> entry.contacts?.first_name
entry.last_name -> entry.contacts?.last_name
entry.address_street -> entry.contacts?.address_street
entry.address_city -> entry.contacts?.address_city
entry.address_state -> entry.contacts?.address_state
```

Also fix the display (lines 117-120):
```
entry.first_name -> entry.contacts?.first_name
entry.last_name -> entry.contacts?.last_name
entry.address_city -> entry.contacts?.address_city
entry.address_state -> entry.contacts?.address_state
```

### 2. Speed Up Pipeline Loading (Pipeline.tsx)

**Problem**: `fetchPipelineData` runs 4 sequential queries (auth user, profile, reps, locations, then pipeline data). Each waits for the previous one.

**Fix**: Run independent queries in parallel using `Promise.all`:

```text
Before (sequential):
  getUser() -> 300ms
  getProfile() -> 200ms
  getReps() -> 200ms
  getLocations() -> 200ms
  getPipelineEntries() -> 300ms
  Total: ~1200ms

After (parallel where possible):
  getUser() -> 300ms
  getProfile() -> 200ms
  [getReps(), getLocations(), getPipelineEntries()] -> 300ms (parallel)
  Total: ~800ms
```

**File: `src/features/pipeline/components/Pipeline.tsx` (lines 177-360)**

- After getting the profile/tenant ID, run the reps query, locations query, and pipeline entries query in parallel with `Promise.all`
- Cache `effectiveTenantId` so `fetchUserRole` and `fetchPipelineData` don't both query the profile separately

### 3. Throttle Realtime Refetches (Pipeline.tsx)

**Problem**: The realtime subscription (lines 118-138) calls `fetchPipelineData()` on every single `postgres_changes` event with no debounce. If 5 entries change quickly, it fires 5 full refetches.

**Fix**: Debounce the realtime handler to batch rapid changes into a single refetch (500ms window).

### Technical Summary

| File | Change |
|------|--------|
| `PipelineSearch.tsx` | Fix field paths: `entry.first_name` to `entry.contacts?.first_name` (and similar for all contact fields) |
| `Pipeline.tsx` | Parallelize independent queries with `Promise.all` |
| `Pipeline.tsx` | Debounce realtime subscription handler (500ms) |
| `Pipeline.tsx` | Remove duplicate profile fetch (reuse from `fetchUserRole`) |

