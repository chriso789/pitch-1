

# Fix: Marketing Assets Page Missing Auth Protection

## Problem
The `/marketing-assets` route is the **only** page not wrapped in `<ProtectedRoute>`, so unauthenticated visitors can access it. The sidebar then shows "User / User" because there's no logged-in profile to display — it's hitting the fallback text, not a ghost account.

## Fix

### `src/App.tsx` (1 line change)
Wrap the route in `<ProtectedRoute>`:
```
// Before
<Route path="/marketing-assets" element={<MarketingAssetsPage />} />

// After
<Route path="/marketing-assets" element={<ProtectedRoute><MarketingAssetsPage /></ProtectedRoute>} />
```

That's it. Once protected, unauthenticated users will be redirected to login, and the sidebar will display the real user's name and role after sign-in.

