
## Upgrade: Wire Per-Rep Property Assignments into Rep Filtering

### What Already Exists (fully built)
- `canvass-area-build-heatmap` edge function with grid cell bucketing
- `canvass-area-auto-split` edge function with k-means clustering + balancing
- `AreaHeatmapOverlay.tsx` rendering heat cells as Google Maps circles (zoom-aware)
- `AutoSplitButton.tsx` with rep selection dialog
- `AreaLeaderboard.tsx` + `AreaROIPanel.tsx` in TerritoryManagerMap sidebar
- `LiveAreaStatsBadge.tsx` with realtime subscription
- `TerritoryManagerMap.tsx` with draw/save/delete/assign/split/heatmap/leaderboard/ROI

### The Gap

After a manager runs "Auto Split", property assignments are written to `canvass_area_property_assignments` (per user_id + property_id). However, the `useAssignedArea` hook currently only queries `canvass_area_properties` (all area properties), so reps still see every property in the area -- not just their assigned slice.

### Change Required

**File: `src/hooks/useAssignedArea.ts`** -- UPDATE

After loading the area assignment, check if `canvass_area_property_assignments` has rows for this user + area. If yes, use those property IDs (the rep's personal split). If no split assignments exist, fall back to `canvass_area_properties` (all area properties).

Logic:
1. Fetch area assignment from `canvass_area_assignments` (unchanged)
2. Load area details from `canvass_areas` (unchanged)
3. NEW: Query `canvass_area_property_assignments` for `(tenant_id, area_id, user_id)`
4. If rows exist, use those property IDs (split mode)
5. If no rows, fall back to `canvass_area_properties` (pre-split / unsplit mode)

This is a single file change (~10 lines added). No other files need modification -- `GooglePropertyMarkersLayer` already accepts `areaPropertyIds` and filters accordingly.

### Files Modified

| File | Action |
|------|--------|
| `src/hooks/useAssignedArea.ts` | UPDATE -- prefer per-rep assignments over all-area membership |
