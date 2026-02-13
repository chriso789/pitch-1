

## Canvass Mode, Heatmap, Auto-Split, Leaderboard, Area ROI, and Performance Optimization

### Overview

Six features wired into the existing canvass workflow:

1. **Canvass Mode** -- free-pan map with address search and manual pin drops
2. **Area Heatmap** -- precomputed grid of uncontacted property density for manager view
3. **Auto-Split Area** -- evenly partition area properties among N reps by geography
4. **Rep Performance Leaderboard** -- ranked view per area (contacts, appointments, contracts)
5. **Area ROI per Storm** -- link jobs to canvass properties and track revenue by area
6. **10K+ Property Performance** -- indexes, zoom-dependent rendering, precomputed membership

---

### Database Migration

**ALTER `canvassiq_properties`** -- add 2 columns:
- `manual_pin boolean DEFAULT false`
- `source text DEFAULT 'system'`

(`created_by` already exists.)

**ALTER `jobs`** -- add 2 columns:
- `canvass_property_id uuid` (nullable FK-style reference)
- `storm_event_id text` (nullable, links job to a storm)

**CREATE `canvass_area_heat_cells`** -- precomputed heatmap grid:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto |
| tenant_id | uuid | Tenant |
| area_id | uuid | Area reference |
| cell_key | text | Lat/lng bucket key |
| center_lat / center_lng | double precision | Cell center |
| total_properties / contacted_properties / uncontacted_properties | int | Counts |
| updated_at | timestamptz | Last computed |

Unique on `(tenant_id, area_id, cell_key)`.

**CREATE `canvass_area_property_assignments`** -- per-rep property splits:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto |
| tenant_id | uuid | Tenant |
| area_id | uuid | Area reference |
| user_id | uuid | Assigned rep |
| property_id | uuid | Property reference |

Unique on `(tenant_id, area_id, property_id)`.

**CREATE VIEW `canvass_area_leaderboard`** -- aggregates visits per area per rep:
- `contacted_properties` (distinct property_id count)
- `total_touchpoints` (total visits)
- `appts` (disposition in 'appointment_set', 'inspection_scheduled')
- `contracts` (disposition = 'contract_signed')

**CREATE VIEW `canvass_area_roi`** -- joins `canvass_area_properties` to `jobs` via `canvass_property_id`:
- `jobs_won` (count)
- `revenue` (sum of `estimated_value`)
- Grouped by `tenant_id, area_id, storm_event_id`

**ADD INDEXES:**
- `canvassiq_properties(tenant_id, lat, lng)`
- `canvassiq_properties(tenant_id, normalized_address_key)`

All new tables get RLS for tenant isolation.

---

### New Edge Functions

**`canvass-drop-pin`** -- manual property creation:
- Accepts `{ tenant_id, user_id, lat, lng, label?, run_enrichment? }`
- Reverse-geocodes via the existing `locationResolver`
- Upserts into `canvassiq_properties` with `manual_pin=true, source='manual_pin'`
- Optionally fire-and-forget calls `storm-public-lookup` for enrichment
- Returns the created property

**`canvass-area-build-heatmap`** -- precompute density grid:
- Accepts `{ tenant_id, area_id, cell_size_deg? }`
- Loads area membership from `canvass_area_properties`
- Joins to `canvassiq_visits` for contacted status
- Buckets into grid cells (~0.005 deg, roughly 500m)
- Upserts into `canvass_area_heat_cells`
- Returns cell count

**`canvass-area-auto-split`** -- evenly split among reps:
- Accepts `{ tenant_id, area_id, user_ids: string[] }`
- Loads all area properties with lat/lng
- Runs k-means-style geographic clustering (k = user count)
- Balances property counts across clusters (swap edge points)
- Writes `canvass_area_property_assignments`
- Returns counts per rep

---

### New React Components

**`src/components/storm-canvass/CanvassModeToggle.tsx`**
- A toggle switch in the LiveCanvassingPage header
- When ON: enables map click to drop pin (with confirmation dialog), search is emphasized
- When OFF: reverts to assigned territory filtering

**`src/components/storm-canvass/DropPinDialog.tsx`**
- Confirmation dialog after map click in canvass mode
- Shows reverse-geocoded address
- Option to run enrichment
- Calls `canvass-drop-pin` edge function
- Refreshes markers on success

**`src/components/storm-canvass/AreaHeatmapOverlay.tsx`**
- Renders precomputed heat cells as colored circles/rectangles on Google Map
- Color gradient: green (all contacted) to red (high uncontacted density)
- Only visible at zoom < 16 (individual pins shown at higher zoom)
- Fetches from `canvass_area_heat_cells`

**`src/components/storm-canvass/AreaLeaderboard.tsx`**
- Table/ranked list from `canvass_area_leaderboard` view
- Shows: Rep name, properties contacted, touchpoints, appointments, contracts
- Sortable columns
- Used in manager dashboard and territory manager sidebar

**`src/components/storm-canvass/AreaROIPanel.tsx`**
- Card showing area ROI from `canvass_area_roi` view
- Jobs won, revenue, cost per lead (if batchleads_usage available)
- Per storm breakdown

**`src/components/storm-canvass/AutoSplitButton.tsx`**
- Button in TerritoryManagerMap sidebar per area
- Opens dialog to select which reps to split among
- Calls `canvass-area-auto-split` edge function
- Shows results (counts per rep)

---

### Updated Files

**`src/pages/storm-canvass/LiveCanvassingPage.tsx`**
- Add `canvassMode` state toggle
- When canvass mode ON: pass `onMapClick` handler to GoogleLiveLocationMap
- Remove area filtering when canvass mode is active (show all pins in viewport)
- Render `CanvassModeToggle` in header
- Render `DropPinDialog` when map is clicked

**`src/components/storm-canvass/GoogleLiveLocationMap.tsx`**
- Add optional `onMapClick` prop
- When provided, attach click listener to map that fires with lat/lng

**`src/components/storm-canvass/TerritoryManagerMap.tsx`**
- Add `AutoSplitButton` per area in sidebar
- Add `AreaLeaderboard` expandable section per area
- Add `AreaROIPanel` in sidebar
- Add button to rebuild heatmap per area
- Render `AreaHeatmapOverlay` on map for selected area

**`src/pages/StormCanvassPro.tsx`**
- Add "Territory Manager" card linking to the territory management view

**`supabase/config.toml`**
- Add entries for `canvass-drop-pin`, `canvass-area-build-heatmap`, `canvass-area-auto-split`

---

### Performance Strategy for 10K+ Territories

| Strategy | Implementation |
|----------|---------------|
| Viewport-only loading | Already in place -- bbox query on `canvassiq_properties` |
| DB indexes | Add composite indexes on `(tenant_id, lat, lng)` and `(tenant_id, normalized_address_key)` |
| Precomputed membership | `canvass_area_properties` already avoids runtime point-in-polygon |
| Zoom-dependent rendering | Zoom < 14: heatmap cells only. Zoom 14-16: clustered pins. Zoom > 16: individual pins with street numbers |
| Chunked .in() queries | Already implemented in GooglePropertyMarkersLayer (100-item chunks) |
| Grid cell loading | Already tracks loaded cells to avoid redundant fetches |
| Heatmap precomputation | `canvass_area_heat_cells` computed once per area update, not per request |

---

### Files Summary

| File | Action |
|------|--------|
| Database migration | ALTER 2 tables, CREATE 2 tables + 2 views + 2 indexes, RLS |
| `supabase/functions/canvass-drop-pin/index.ts` | CREATE |
| `supabase/functions/canvass-area-build-heatmap/index.ts` | CREATE |
| `supabase/functions/canvass-area-auto-split/index.ts` | CREATE |
| `src/components/storm-canvass/CanvassModeToggle.tsx` | CREATE |
| `src/components/storm-canvass/DropPinDialog.tsx` | CREATE |
| `src/components/storm-canvass/AreaHeatmapOverlay.tsx` | CREATE |
| `src/components/storm-canvass/AreaLeaderboard.tsx` | CREATE |
| `src/components/storm-canvass/AreaROIPanel.tsx` | CREATE |
| `src/components/storm-canvass/AutoSplitButton.tsx` | CREATE |
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | UPDATE -- canvass mode + drop pin |
| `src/components/storm-canvass/GoogleLiveLocationMap.tsx` | UPDATE -- onMapClick prop |
| `src/components/storm-canvass/TerritoryManagerMap.tsx` | UPDATE -- auto-split + leaderboard + heatmap |
| `src/pages/StormCanvassPro.tsx` | UPDATE -- add Territory Manager card |
| `supabase/config.toml` | ADD 3 function entries |

