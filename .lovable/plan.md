

# Two Fixes: Contact Delete Permissions + Location Filtering

## Issue 1: Delete Button Access Control

Currently the "Delete" action in the contact actions menu is visible to **all users**. It needs to be restricted to only `master` and `owner` roles.

### Changes
**File: `src/features/contacts/components/EnhancedClientList.tsx`**
- Import `useCurrentUser` hook
- In the `renderActions` function (~line 986-994), conditionally include the "Delete" action only when the user's role is `master` or `owner`
- The delete handler and `PermanentDeleteDialog` remain unchanged — just gate the menu item visibility

```tsx
// Only show delete action for master/owner
const userRole = user?.role;
const canDelete = userRole === 'master' || userRole === 'owner';

// In the actions array, conditionally include:
...(canDelete ? [{
  label: "Delete",
  icon: Trash2,
  onClick: () => handleDeleteContact(...),
  variant: 'destructive',
  separator: true
}] : [])
```

## Issue 2: East Coast Contacts Showing in West Coast Board

The contact query (~line 431) filters by `location_id` only when `currentLocationId && locations.length > 0`. If the location context hasn't loaded yet or `currentLocationId` is null, **all contacts across all locations** are returned and passed to the Kanban board.

### Root Cause
The `owner` role (and other admin roles) sees all locations. When they select "West Coast FL" in the location picker, `currentLocationId` should be set. But if for some reason it's null (e.g., on initial load before the saved preference loads), the filter is skipped entirely.

### Fix
**File: `src/features/contacts/components/EnhancedClientList.tsx`**
- When `locations.length > 0` but `currentLocationId` is null, don't fetch any contacts — wait for the location to be selected rather than showing everything unfiltered
- Add an early return in `fetchData` that waits for `currentLocationId` when locations exist

```tsx
// ~line 430: Change the else branch
if (currentLocationId && locations.length > 0) {
  batchQuery = batchQuery.eq('location_id', currentLocationId);
} else if (locations.length > 0) {
  // Locations exist but none selected yet — don't show unfiltered data
  setContacts([]);
  setLoading(false);
  return;
}
// If locations.length === 0 (no locations configured), show all (backward compat)
```

This ensures that when a user has multiple locations, they must have one selected — preventing cross-location data leakage on the Kanban board.

### Files Changed
- `src/features/contacts/components/EnhancedClientList.tsx` — role-gate delete action + fix location filter gap

