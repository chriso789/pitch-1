

# Fix: "Cannot read properties of null (reading 'owner_name')"

## Root Cause

`property` can be `null` when the panel is closing or when the selected property changes. The component has an early return guard at line 287 (`if (!property || !localProperty) return null`) that protects the render path, but several `useEffect` blocks and callback functions access `property.owner_name`, `property.address`, `property.lat`, etc. without null-safe access.

The crash specifically occurs in the auto-enrich `useEffect` (line 232) where `property.owner_name` is read without optional chaining, even though the guard on line 221 uses `property?.id`. A React state update race (property set to null between the guard check and the body execution, or a stale closure) triggers the crash.

## Fix

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

Add optional chaining (`?.`) to all direct `property.xxx` accesses outside the render guard:

1. **Line 232-234** (auto-enrich useEffect): Change `property.owner_name` to `property?.owner_name`
2. **Line 447**: Change `property.owner_name` to `property?.owner_name`  
3. **Line 511**: Change `property.lat` / `property.lng` to `property?.lat` / `property?.lng`
4. **Line 524**: Change `property.owner_name` to `property?.owner_name`
5. **Line 588**: Change `property.address` to `property?.address`
6. **Line 596-598**: Change `property.property_data` to `property?.property_data`

These are all in callbacks or effects that can fire after `property` becomes null due to React re-render timing.

## No other files affected

This is a single-file fix -- only `PropertyInfoPanel.tsx` needs updating.

