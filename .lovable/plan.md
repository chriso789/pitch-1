
# Fix Mobile View, Search Visibility & Pipeline Display Issues

## Problem Summary

Three issues identified:

### Issue 1: Lead 3337-1-0 Not Showing in Pipeline
**Root Cause:** The lead exists with status "project" in "East Coast" location. The user is viewing with a different location selected OR the Pipeline component isn't showing it properly.

**Finding from DB:**
- Lead 3337-1-0 (Paola Shaine) exists with `status: "project"` and `location_id: East Coast`
- 30+ leads exist in the database across East Coast and West Coast locations

**Solution:** Verify location selection and add visual confirmation of which location filter is active in the Pipeline view.

### Issue 2: Mobile Search Bar Visibility
**Root Cause:** The CLJSearchBar on mobile:
- Has `max-w-sm` (384px) constraint which is too narrow
- Header has cramped padding (`px-14 pr-3`) leaving little space
- Dropdown z-index (z-50) may conflict with other overlays

**Solution:** Improve mobile header layout and search bar responsiveness.

### Issue 3: Storm Canvas Mobile View
**Root Cause:** The LiveCanvassingPage address search bar and controls could use better mobile optimization.

---

## Technical Changes

### File 1: `src/shared/components/layout/GlobalLayout.tsx`

**Changes:**
- Give search bar more room on mobile by reducing left padding
- Make search bar expand to full width on mobile
- Ensure proper z-index stacking for dropdown visibility

```typescript
// Current mobile header padding: px-14 pr-3
// Change to give more room for search

<div className={cn(
  "flex h-14 md:h-16 items-center gap-2 md:gap-4 justify-between",
  isMobile ? "pl-14 pr-2" : "px-6"  // Reduced pr from 3 to 2
)}>
```

### File 2: `src/components/CLJSearchBar.tsx`

**Changes:**
- Remove `max-w-sm` constraint on mobile
- Use responsive width classes
- Increase dropdown z-index to z-[60] to ensure it's above all overlays
- Add mobile-friendly positioning

```typescript
// Current: w-full max-w-sm
// Change to: w-full md:max-w-sm

<div className="relative w-full md:max-w-sm">
```

Also update dropdown:
```typescript
// Current: z-50
// Change to: z-[60] for reliable stacking

<div 
  ref={dropdownRef}
  className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-[60] max-h-[400px] overflow-y-auto"
>
```

### File 3: `src/features/pipeline/components/Pipeline.tsx`

**Changes:**
- Add visual indicator showing current location filter
- Add badge showing which location is being viewed
- This helps users understand why certain leads may not appear

```typescript
// In the header section, add location indicator:
<div className="flex items-center gap-2">
  <h1 className="text-3xl font-bold tracking-tight">Jobs Pipeline</h1>
  {currentLocation && (
    <Badge variant="outline" className="text-sm">
      <MapPin className="h-3 w-3 mr-1" />
      {currentLocation.name}
    </Badge>
  )}
</div>
```

### File 4: `src/pages/storm-canvass/LiveCanvassingPage.tsx`

**Changes:**
- Improve mobile header compactness
- Make address search bar more prominent on mobile
- Ensure search suggestions dropdown is fully visible

```typescript
// In the header Card, reduce padding on mobile:
<div className="p-3 md:p-4 flex items-center justify-between">
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/shared/components/layout/GlobalLayout.tsx` | Improve mobile header spacing for search bar |
| `src/components/CLJSearchBar.tsx` | Full width on mobile, higher z-index for dropdown |
| `src/features/pipeline/components/Pipeline.tsx` | Add location indicator badge to clarify filtering |
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Optimize mobile header and search visibility |

---

## Why the Lead Isn't Showing

The lead 3337-1-0 (Paola Shaine) with status "project" in "East Coast" **exists and is valid**. The most likely reasons it's not appearing:

1. **Location Filter Mismatch:** User has "West Coast" selected, not "East Coast"
2. **Cache Issue:** The pipeline data may be stale - adding a location badge will make this clearer

Adding the location indicator badge will help users immediately see which location they're filtering by, reducing confusion about why certain leads don't appear.

---

## Testing Steps

After implementation:
1. Open the Pipeline page on mobile
2. Verify search bar expands to full width
3. Type "paola" and verify dropdown is fully visible and not cut off
4. Verify location badge appears showing current filter
5. Switch to "East Coast" location and confirm lead 3337-1-0 appears in "Approved/Project" column
6. Navigate to Storm Canvas > Live Canvassing
7. Verify search bar is fully visible on mobile
8. Test search suggestions appear without being cut off
