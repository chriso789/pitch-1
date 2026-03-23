
Fix this as a frontend marker-state bug, not a database bug.

What I verified
- The database currently has one `canvassiq_properties` row for each of the addresses visible in your screenshot (`4052, 4063, 4083, 4102, 4103, 4122, 4123` on Fonsica).
- So the repeated numbered circles are being rendered by the map layer itself.
- The current marker code still has two likely causes:
  1. overlapping async loads can apply stale marker snapshots out of order
  2. existing markers are not repositioned when the same address gets improved coordinates later

Implementation plan

1. Make markers number-only again
- Update `GooglePropertyMarkersLayer.tsx` so pins always display just the house number.
- Remove the high-zoom street hint logic entirely.

2. Lock marker identity to one canonical address key
- Keep one marker per canonical address key only.
- Prefer `normalized_address_key`; if missing, derive it from `address.street` / `address.formatted`.
- Avoid falling back to raw row id when an address-derived key can be built, because id-based fallback can let the same home render twice.

3. Prevent stale async loads from creating duplicate pins
- Add a request/version guard inside `GooglePropertyMarkersLayer.tsx`.
- Each `loadProperties()` run gets a monotonically increasing load id.
- Ignore any older query/requery result if a newer load started after it.
- Keep `loadingRef` locked for the full lifecycle of a load, including the cluster-load + requery path.

4. Reconcile markers by key and always update position
- When a marker for the same address key already exists, update:
  - marker position
  - icon
  - cached property payload
- Do not only update on disposition change.
- This ensures a house that first appears near the curb and later gets a better rooftop/snapped coordinate still remains a single marker that moves, instead of leaving an old visual behind.

5. Make refreshes fully deterministic
- On `refreshKey` changes and post-cluster requeries, reconcile against the latest visible property set only.
- Remove markers not present in the newest accepted key set.
- This prevents old in-flight loads from reintroducing already-replaced markers.

Files to update
- `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`

Expected result
- One pin per address only.
- Pins show house number only.
- No duplicate curb/roof markers for the same house after panning, zooming, refreshing, or parcel reloading.

Technical note
- The screenshot pattern strongly matches a race/reconciliation bug: one marker is left at an older coordinate while a newer marker for the same address is added later. The fix is to serialize/ignore stale loads and update marker positions for existing canonical keys.