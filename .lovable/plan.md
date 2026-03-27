
I checked the data: Andrea Iacono exists in Tristate as both a contact and a pipeline lead, so this is not a missing-record issue. The problem is the pipeline page’s fetch/scoping logic.

### What is actually broken
- `src/features/pipeline/components/Pipeline.tsx` is using its own manual tenant/profile lookup instead of the app’s hardened tenant hooks.
- That page re-queries `profiles` directly by `auth.uid()` and builds its own tenant context, which is risky in switched-company sessions.
- It also mixes `business_locations` with the newer `locations` + `LocationContext` flow.
- Result: the board can fetch with bad or unresolved scope and render as completely empty even though Tristate data exists.

### Plan

1. **Unify tenant resolution on the pipeline page**
   - Update `src/features/pipeline/components/Pipeline.tsx` to use `useUserProfile` and `useEffectiveTenantId`.
   - Remove the duplicate direct `profiles` lookup used to derive tenant/role.
   - Do not run the pipeline query until the effective tenant is resolved.

2. **Fix the pipeline fetch path**
   - Keep the explicit tenant filter, but only apply it once a valid tenant exists.
   - Preserve the selected location filter after tenant resolution.
   - Add a guard so the page never silently queries with a null tenant and shows an “empty” board.

3. **Align location handling**
   - Replace the page’s `business_locations` fetch with the same location source used by `LocationContext`.
   - Make the pipeline page honor the active company + active location consistently.
   - This avoids “company switched but filter source is stale” behavior.

4. **Use one pipeline data model**
   - Refactor the page to consume the shared pipeline hook pattern (`usePipelineData`) or extend it so the board and the rest of the app use the same tenant-safe query logic.
   - Keep the existing rep/date/search filters on top of that shared dataset.

5. **Add a meaningful failure state**
   - If tenant/profile context is still resolving, show loading instead of a blank board.
   - If the query returns zero rows, show whether it is due to company scope, location filter, or true no-data state.

### Files to update
- `src/features/pipeline/components/Pipeline.tsx`
- `src/hooks/usePipelineData.ts` (if expanded so the main board can use it cleanly)
- `src/contexts/LocationContext.tsx` only if a small sync fix is needed after refactor

### Technical notes
- Andrea’s records are present in Tristate and tied to `location_id = 8ecc4284-f815-4c44-8588-ab09232ee715` (`Main Office`).
- Tristate also has multiple other pipeline entries, so the board should not be zeroed out.
- The likely bug is UI-side scoping, not deleted data.
- I will preserve the explicit tenant/location “belt-and-suspenders” filtering already used elsewhere so this does not regress during company switching.
