
Fix both issues at the source: bad writeback for 4063 Fonsica Ave, and client-side multi-pin rendering.

1. Repair the wrong 4063 record
- Add a safe refresh path that re-enriches the selected property using its stored address as the source of truth, not just the pin lat/lng.
- When the selected property is 4063, overwrite the poisoned owner/parcel/home details with the corrected lookup result.
- Also clear stale enrichment fields if the incoming lookup does not match the property address.

2. Stop neighbor data from being written again
- Update `storm-public-lookup` to load the target `canvassiq_properties` row when `property_id` is provided.
- Compare the property’s stored address + normalized key against the resolved lookup address before updating `canvassiq_properties`.
- If the house number/address does not match closely enough, return a mismatch warning and do not persist owner/property details.

3. Make lookup prefer the property address over reverse geocoding
- In `storm-public-lookup`, when `property_id` exists, use the property row’s stored `address.street` / `address.formatted` first.
- Use lat/lng only as a fallback for county/location context, not as the owner-resolution authority.
- This prevents slightly off-center pins from drifting to 4083 and writing that owner onto 4063.

4. Unify address normalization everywhere
- Replace the multiple address-key formats with one shared normalizer across:
  - `storm-public-lookup`
  - `locationResolver`
  - `canvassiq-load-parcels`
  - `GooglePropertyMarkersLayer`
- Standardize keys like `4063_fonsica_ave` vs `4063_fonsicaave` so cache lookup, dedupe, and writeback all agree.

5. Fix the multiple pins
- I checked the DB rows for these Fonsica addresses and did not find duplicate stored rows for 4063/4083/4123, so this appears to be a rendering/deduping issue, not duplicate property records.
- Update the marker layer to dedupe by the shared normalized address key consistently and keep only one marker per address in memory.
- Prefer the best row per address deterministically so the UI cannot show two pins for the same house.

Technical details
- Wrong owner persists because `canvassiq_properties` for `4063 Fonsica Ave` already contains `KONEWECKI PIOTR` and parcel `0966052005`, which belongs to `4083 Fonsica Ave`.
- `storm_properties_public` currently has a cache row for `4083`, not `4063`, so the UI is showing polluted data already saved onto the 4063 property row.
- The current server flow still trusts `resolveLocation({ lat, lng, address })` and then updates `canvassiq_properties` by `property_id` without a strict address-match guard.

Files to update
- `supabase/functions/storm-public-lookup/index.ts`
- `supabase/functions/_shared/public_data/locationResolver.ts`
- `supabase/functions/_shared/public_data/normalize.ts`
- `supabase/functions/canvassiq-load-parcels/index.ts`
- `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`
- `src/components/storm-canvass/PropertyInfoPanel.tsx`

Expected result
- 4063 Fonsica Ave shows the correct owner and house details after refresh.
- Neighbor data can no longer be written onto the wrong pin.
- Only one pin appears per address on the map.