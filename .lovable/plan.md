

# Fix: Saved Estimates Not Appearing After Creation

## Root Cause

The global React Query config (`src/lib/queryClient.ts`) sets `refetchOnMount: false` and `staleTime: 5 minutes`. Here's what happens:

1. User opens lead detail page → `SavedEstimatesList` mounts, queries `['saved-estimates', pipelineEntryId]`, gets empty array
2. User scrolls down to estimate builder, creates estimate → `invalidateQueries` marks the cache as stale
3. If `SavedEstimatesList` is not actively mounted (scrolled off screen or during state transitions), invalidation marks data stale but no active observer triggers refetch
4. When `SavedEstimatesList` re-renders, `refetchOnMount: false` prevents it from refetching the stale/invalidated data — it shows the cached empty array

The estimate **is** in the database (confirmed: `OBR-00038-zlvg`, $16,000, created by Chris O'Brien) but the UI query never re-fetches.

## Fix

**File: `src/components/estimates/SavedEstimatesList.tsx`** (~line 105)

Override the global `refetchOnMount` setting for this specific query to ensure it always refetches when the component mounts or when data is stale:

```typescript
const { data: estimates, isLoading } = useQuery({
  queryKey: ['saved-estimates', pipelineEntryId],
  queryFn: async () => { ... },
  enabled: !!pipelineEntryId,
  refetchOnMount: 'always',  // Override global setting — always refetch on mount
  staleTime: 30_000,         // 30s stale time (shorter than global 5min)
});
```

This ensures that every time the user scrolls back up or the tab re-renders, the estimates list reflects the latest data. The 30-second stale time still prevents excessive API calls during normal browsing.

