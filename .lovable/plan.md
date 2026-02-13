

## Wire Territory System End-to-End: Area Filtering, Rep Assignment, GPS Enforcement, Live Counters

### What Already Exists (no changes needed)
- `canvass_areas`, `canvass_area_assignments`, `canvass_area_properties` tables with RLS
- `canvass_area_stats` view joining properties to visits
- `canvass-area-build-membership` edge function (point-in-polygon on `canvassiq_properties`)
- `TerritoryManagerMap.tsx` with draw/save/delete
- `AreaStatsBadge.tsx` presentational component
- `PropertyInfoPanel.tsx` with Score tab

### Changes Required

---

#### 1. Rep Assignment UI in TerritoryManagerMap

**File:** `src/components/storm-canvass/TerritoryManagerMap.tsx` -- UPDATE

Add a multi-select dropdown for each area in the sidebar list. When reps are selected, upsert into `canvass_area_assignments`. Load team members from `profiles` table filtered by tenant.

- Fetch profiles (tenant team members) on mount
- For each area card, show assigned reps as small avatars/badges
- "Assign" button opens a popover with checkboxes for each team member
- On change, upsert/delete `canvass_area_assignments` rows

---

#### 2. Live Area Stats with Realtime Subscription

**File:** `src/components/storm-canvass/LiveAreaStatsBadge.tsx` -- CREATE

A wrapper around `AreaStatsBadge` that:
- Accepts `tenantId` and `areaId`
- Fetches from `canvass_area_stats` view on mount
- Subscribes to Supabase realtime on `canvassiq_visits` table (INSERT events)
- Re-fetches stats when a new visit is logged
- Passes `total` and `contacted` to the existing `AreaStatsBadge`

Replace the inline stats fetch in `TerritoryManagerMap` with this component.

---

#### 3. Area-Filtered Property Loading for Reps

**File:** `src/hooks/useAssignedArea.ts` -- CREATE

A hook that:
- Fetches from `canvass_area_assignments` where `user_id = profile.id` and `is_active = true`
- Loads the matching `canvass_areas` polygon
- Loads `canvass_area_properties` IDs for that area
- Returns `{ assignedArea, areaPolygon, propertyIds, loading }`

**File:** `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` -- UPDATE

Add optional prop `areaPropertyIds?: string[]`. When provided:
- Instead of querying all `canvassiq_properties` in viewport bounds, filter with `.in('id', areaPropertyIds)` (chunked if > 100 IDs)
- This restricts the rep to only see pins within their assigned territory

**File:** `src/components/storm-canvass/GoogleLiveLocationMap.tsx` -- UPDATE

Pass `areaPropertyIds` through to `GooglePropertyMarkersLayer`.

**File:** `src/pages/storm-canvass/LiveCanvassingPage.tsx` -- UPDATE

- Import and use `useAssignedArea` hook
- Pass `areaPropertyIds` to `GoogleLiveLocationMap`
- If no area assigned, show all properties (manager/admin behavior)

---

#### 4. GPS Territory Enforcement

**File:** `src/components/storm-canvass/TerritoryBoundaryAlert.tsx` -- CREATE

A floating banner component that:
- Accepts `userLocation` and `areaPolygon` (GeoJSON)
- Runs client-side point-in-polygon check on user's GPS
- Shows a red alert banner "You are outside your assigned territory" when outside
- Shows a green "In Territory" badge when inside
- Uses the same ray-casting algorithm from the edge function

**File:** `src/pages/storm-canvass/LiveCanvassingPage.tsx` -- UPDATE

- Render `TerritoryBoundaryAlert` in the map overlay area
- Pass `userLocation` and `areaPolygon` from `useAssignedArea`

---

#### 5. Area Polygon Overlay on Live Map

**File:** `src/components/storm-canvass/GoogleLiveLocationMap.tsx` -- UPDATE

Add optional `areaPolygon` prop. When provided, render the assigned territory boundary as a semi-transparent polygon overlay on the Google Map so the rep can see their area visually.

---

### Technical Details

**Point-in-polygon (client-side):**
```text
Reuse ray-casting algorithm from canvass-area-build-membership.
GeoJSON coordinates are [lng, lat] format.
```

**Area property filtering strategy:**
- For areas with < 500 properties: use `.in('id', ids)` filter
- For areas with > 500 properties: use bbox from polygon + viewport intersection (already built into the layer)

**Realtime subscription pattern:**
```text
supabase.channel('area-visits')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'canvassiq_visits' }, refetchStats)
  .subscribe()
```

### Files Created/Modified

| File | Action |
|------|--------|
| `src/hooks/useAssignedArea.ts` | CREATE -- hook for rep's assigned area + property IDs |
| `src/components/storm-canvass/LiveAreaStatsBadge.tsx` | CREATE -- realtime stats wrapper |
| `src/components/storm-canvass/TerritoryBoundaryAlert.tsx` | CREATE -- GPS enforcement banner |
| `src/components/storm-canvass/TerritoryManagerMap.tsx` | UPDATE -- add rep assignment UI |
| `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` | UPDATE -- accept areaPropertyIds filter |
| `src/components/storm-canvass/GoogleLiveLocationMap.tsx` | UPDATE -- pass areaPropertyIds + render area polygon |
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | UPDATE -- integrate useAssignedArea + territory alert |

No database changes needed -- all tables and views already exist.
