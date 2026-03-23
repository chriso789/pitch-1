
Fix the “multiple pins per address” confusion by separating real duplicate markers from Google’s built-in street-number labels and tightening marker identity.

1. Confirm and preserve the actual data model
- Keep the current DB dedupe path for `canvassiq_properties` by canonical address key.
- Do not treat the screenshot as proof of duplicate rows: the queried Fonsica addresses each currently have one property row.

2. Remove the visual double-number effect in Google map view
- The screenshot pattern matches two overlapping systems:
  - our custom circular markers that render street numbers
  - Google hybrid-map address labels rendered by the base map
- Update `GoogleLiveLocationMap.tsx` map styling for the active canvass view to hide Google road/address labels in this mode, especially on satellite/hybrid.
- Keep parcel/house markers as the single visible numbering system.

3. Tighten marker identity in the Google markers layer
- Update `GooglePropertyMarkersLayer.tsx` so marker keys are based on canonical property identity instead of raw row id alone:
  - prefer `normalized_address_key`
  - fallback to `address_hash` / place id
  - fallback to row id only if needed
- Use that same canonical key for both `markersRef` and `propertiesCacheRef`.
- This prevents multiple markers from surviving when two rows represent the same home or when reloaded data swaps between equivalent records.

4. Make dedupe resilient to legacy address payloads
- Improve `getNormalizedAddressKey()` in `GooglePropertyMarkersLayer.tsx` so it derives the same canonical key from:
  - `normalized_address_key`
  - `address.street`
  - `address.formatted`
  - parsed street number + short street name
- Normalize suffixes consistently (`street` → `st`, `avenue` → `ave`) before marker rendering.

5. Prevent same-number / nearby-address confusion
- Right now nearby homes on different streets can legitimately share the same house number in the same viewport.
- Adjust marker labeling rules so the Google marker only shows:
  - number-only at lower zoom
  - number + short street hint at very high zoom or selected state
- This avoids “4063 twice” appearing ambiguous when one is a Google basemap label or a nearby cross-street property.

6. Keep parcel loads from reintroducing apparent duplicates
- Review `canvassiq-load-parcels` insertion identity and ensure canonical normalized keys are used consistently before insert/upsert.
- If needed, expand the existing cleanup migration strategy to merge any remaining legacy rows keyed by underscore/non-underscore variants.

Technical details
- Current evidence suggests the screenshot is not primarily caused by duplicate database rows for 4052, 4063, 4083, 4122, or 4123.
- The stronger root cause is visual duplication in Google hybrid mode: Google renders house-number/address labels on the basemap while the app also renders number badges.
- A second, smaller risk remains in `GooglePropertyMarkersLayer.tsx`: markers are deduped by address during query processing, but rendered/tracked by raw `property.id`, so equivalent rows can still become separate on incremental reloads.

Files to update
- `src/components/storm-canvass/GoogleLiveLocationMap.tsx`
- `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`
- optionally `supabase/functions/canvassiq-load-parcels/index.ts` if any remaining canonicalization gap is found during implementation review

Expected result
- Only one app-controlled marker appears per property.
- Google’s built-in street-number labels no longer visually “duplicate” the app pins in canvass mode.
- Same-number homes in nearby streets are less confusing because marker labeling becomes context-aware.
