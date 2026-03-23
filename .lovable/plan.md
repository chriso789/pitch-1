
What I recognize from the image:

- This is not just a label/readability issue; there are true duplicate app pins for the same homes.
- The duplicates are visible for several house numbers, including:
  - 4182
  - 4183
  - 4102
  - 4103
  - 4123
  - 4063
- The duplicate pins are slightly offset from each other, which strongly suggests two separate marker instances are being rendered for one canonical address.
- Some homes nearby appear only once (for example 4083 and 4143), so the bug is selective/intermittent rather than every address duplicating.
- The pattern matches a frontend marker lifecycle problem more than a data problem:
  - old markers are not being removed
  - or an older async load is drawing after a newer load
  - or the marker layer is being remounted and both old/new instances briefly coexist

What the codebase confirms:
- `GoogleLiveLocationMap.tsx` is still forcing a remount with:
  - `key={\`markers-\${refreshKey || 0}\`}`
- In that same file, `refreshKey` is not passed into `GooglePropertyMarkersLayer` as a normal prop.
- That means an old marker-layer instance can still finish async work after unmount and place markers onto the shared map, creating exactly the kind of doubled pins shown in your screenshot.

Most likely root cause:
- orphaned markers from stale/unmounted `GooglePropertyMarkersLayer` instances, not duplicate rows in the property data

Recommended implementation focus:
1. Remove the `key`-based remount in `GoogleLiveLocationMap.tsx`
2. Pass `refreshKey` as a normal prop instead
3. Add an explicit mounted/cancel guard in `GooglePropertyMarkersLayer.tsx`
4. Reject any async reconciliation from an unmounted or stale instance
5. Keep marker identity tied only to the canonical normalized address key

Expected result after that fix:
- one pin per address
- number-only pins
- no duplicate markers after refreshes, pans, zooms, or parcel reloads
