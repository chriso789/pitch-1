

## Plan: Fix Address Search Not Showing Results in Canvassing

### Root Cause

The `AddressSearchBar` uses the `Command` component from `cmdk`, which has **built-in client-side filtering enabled by default**. When Chris types an address, two things happen simultaneously:

1. The Google Places API returns matching addresses (this works -- verified by testing the edge function directly)
2. `cmdk` internally tries to filter the `CommandItem` list using its own fuzzy matching against the typed text

The problem: `cmdk`'s internal filter compares the typed input against each `CommandItem`'s `value` prop (the full `description` like "123 Main Street, Queens, NY, USA"). Its matching algorithm often rejects valid results, so users see "No results found" even though Google returned addresses.

### Fix

**File: `src/components/storm-canvass/AddressSearchBar.tsx`**

Add `shouldFilter={false}` to the `<Command>` component (line 122). This disables cmdk's internal filtering and lets the Google Places API handle all search logic — which is the correct behavior for an async autocomplete.

One-line change:
```tsx
<Command shouldFilter={false} className="relative rounded-lg border shadow-md bg-background">
```

### Files to Change

1. `src/components/storm-canvass/AddressSearchBar.tsx` — add `shouldFilter={false}` to `Command`

