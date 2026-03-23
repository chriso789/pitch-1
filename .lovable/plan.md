

## Plan: Enable Nationwide Address Search

### Problem

The `AddressSearchBar` passes `location` and `radius: '8000'` (5 miles) to the Google Places Autocomplete API. This biases results heavily toward the user's current GPS coordinates (which may be stale/Tampa). Even with correct GPS, the 5-mile radius prevents searching for addresses in other states.

### Fix

**File: `src/components/storm-canvass/AddressSearchBar.tsx`**

Remove the `location` and `radius` parameters from the autocomplete request. This lets Google return results nationwide. The `types: 'address'` filter is sufficient to keep results relevant.

```tsx
params: {
  input: searchQuery,
  types: 'address',
  components: 'country:us',  // Keep results within the US
},
```

- Remove `location: \`${userLocation.lat},${userLocation.lng}\``
- Remove `radius: '8000'`
- Add `components: 'country:us'` to scope to US addresses without geographic bias

### Files to Change

1. `src/components/storm-canvass/AddressSearchBar.tsx` — remove location/radius params, add country component

