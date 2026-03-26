

## Plan: Fix Canvasser Dashboard Tracking + Disposition Persistence

### Problems Found

**1. Activity log insert uses wrong column name (`metadata` instead of `activity_data`)**
In `PropertyInfoPanel.tsx` line 479, the door knock insert uses `metadata: { ... }` but the DB column is `activity_data`. Supabase silently ignores unknown columns, so the activity data (disposition, property_id, etc.) is lost. The row still inserts but with `activity_data: null`.

**2. `contact_id` not set on activity log inserts**
The `PropertyInfoPanel` door knock insert doesn't include `contact_id`, `latitude`, or `longitude`. The dashboard's disposition breakdown reads `activity.contact?.qualification_status` — but since `contact_id` is null, it can never join to contacts, so disposition breakdown is always empty.

**3. `updateDisposition` doesn't log a `canvass_activity_log` entry**
When a disposition is set via the DispositionPanel or MobileDispositionPanel (which call `updateDisposition` in `useStormCanvass.ts`), no activity log row is created. The dashboard counts entirely depend on `canvass_activity_log` entries, so these interactions are invisible.

**4. `getActivities` has no `tenant_id` filter**
The query fetches all activities across all tenants. With RLS this may be silently filtered, but if RLS is permissive, it returns cross-tenant data.

**5. Disposition status gets overwritten**
The `updateDisposition` function maps any positive disposition to `qualified` and any negative to `not_interested` — a simple binary. There's no protection against overwriting a more advanced status (e.g., a contact already in `project` status being reset to `qualified`). The user wants dispositions to "stay set until moved internally through the statuses."

### Changes

#### 1. `src/components/storm-canvass/PropertyInfoPanel.tsx`
- Fix `metadata` → `activity_data` in the canvass_activity_log insert
- Add `contact_id`, `latitude`, `longitude` fields to the insert (use the created contact ID when available, or look up existing contact for the property)

#### 2. `src/hooks/useStormCanvass.ts`
- **`updateDisposition`**: Add a `canvass_activity_log` insert with `activity_type: 'disposition_set'`, the `contact_id`, and disposition details in `activity_data`
- **`updateDisposition`**: Before overwriting `qualification_status`, check current status — if the contact is already at a later lifecycle stage (`project`, `closed`, `past_customer`), skip the status downgrade
- **`getActivities`**: Add `tenant_id` filter using the user's profile
- **`getDetailedStats`**: Count `disposition_set` activity types alongside `door_knock` for disposition breakdown; also count door knocks that have a disposition in `activity_data`

#### 3. `src/pages/storm-canvass/CanvasserDashboard.tsx`
- Include `disposition_set` activities in the "Leads Generated" count (currently only counts `lead_created`)
- Ensure the disposition breakdown chart pulls from `activity_data.disposition` rather than relying solely on the contact's current `qualification_status`

### Status Protection Logic

```text
Protected statuses (cannot be overwritten by field disposition):
  project, closed, past_customer, completed

Allowed overwrites:
  null, new, qualified, not_interested, follow_up → can be changed by field reps
```

### Files to Modify

| File | Change |
|------|--------|
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | Fix column name, add contact_id/lat/lng to activity insert |
| `src/hooks/useStormCanvass.ts` | Add activity logging to updateDisposition, add tenant filter, add status protection |
| `src/pages/storm-canvass/CanvasserDashboard.tsx` | Fix stats counting to include disposition activities |

