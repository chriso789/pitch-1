
Fix the actual causes of the wrong owner display for 4063 Fonsica Ave and the duplicate pins.

1. Fix the lookup authority bug in `locationResolver`
- Update `supabase/functions/_shared/public_data/locationResolver.ts` so an explicit `address` is used as the primary source when both `address` and `lat/lng` are present.
- Right now it still reverse-geocodes the coordinates first, which is why `4063` is resolving to `4083`.
- Keep `lat/lng` only for county/context fallback, not parcel identity.

2. Make `storm-public-lookup` reject mismatched results end-to-end
- Keep the existing writeback guard, but also return a structured mismatch flag in the response, including stored address vs resolved/result address.
- If the lookup resolves to a different house number, do not cache that result under the selected property key and do not return it as the panel’s effective property data.
- Prefer a second pass using the stored address only when a coordinate-based result disagrees.

3. Stop the UI from showing blocked/mismatched owner data
- Update `src/components/storm-canvass/PropertyInfoPanel.tsx` so it does not merge `pipelineResult.owner_name`, parcel, sqft, or year built into `localProperty` when the backend reports an address mismatch.
- Show the stored property data only, and optionally surface a small “lookup mismatch prevented” warning instead of rendering the neighbor’s owner.

4. Fix the duplicate pin source, not just rendering symptoms
- The database currently has duplicate Fonsica rows for the same homes (`4063_fonsicaave` and `4063_fonsica_ave`, same place_id/address).
- Update parcel loading/upsert logic to canonicalize keys before insert/upsert so old and new normalization formats collapse to one record.
- Add a cleanup migration to merge or remove legacy duplicate `canvassiq_properties` rows for the same tenant + place_id / canonical normalized key.

5. Make marker identity use canonical address identity
- Update `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` so marker/cache identity is based on canonical normalized address key (or place_id fallback), not raw row id alone.
- This prevents legacy duplicate rows from rendering as separate pins during incremental loads.

6. Repair the polluted 4063 flow
- Add a repair path so forcing a refresh on 4063 re-runs lookup against the stored address and overwrites stale local/public enrichment only when the result matches 4063 exactly.
- Ensure no 4083-derived cache row is reused for 4063.

Technical details
- I verified the core bug: `storm-public-lookup` logs “Using stored address "4063 Fonsica Avenue"” but then `resolveLocation()` still prefers `lat/lng`, and the live function response returns `4083 Fonsica Ave` / `KONEWECKI PIOTR`.
- I also verified duplicates in `canvassiq_properties` for Fonsica addresses caused by mixed normalization keys from older vs newer ingestion.

Files to update
- `supabase/functions/_shared/public_data/locationResolver.ts`
- `supabase/functions/storm-public-lookup/index.ts`
- `src/components/storm-canvass/PropertyInfoPanel.tsx`
- `supabase/functions/canvassiq-load-parcels/index.ts`
- `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`
- one new Supabase migration to dedupe legacy `canvassiq_properties` rows

Expected result
- 4063 Fonsica Ave no longer resolves to Peter/4083.
- The panel will not display neighbor data even transiently.
- Only one pin appears per property address.
- Future enrichments persist only when the resolved property exactly matches the selected address.
