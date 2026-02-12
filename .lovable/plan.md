

## Fix: Import Duplicate Detection + Location Scoping

### Problem

The CSV import currently checks for duplicates in **other** locations (cross-location), but does **not** check for duplicates within the **same** location. If you upload a list to "East Coast" that contains contacts already in "East Coast", they'll be imported again as duplicates.

Additionally, the location scoping (`currentLocationId`) is already being passed and used correctly — contacts get `location_id` set to the current location on insert (line 1524). So location isolation is working, but duplicate prevention within the same location is missing.

### Changes

**File: `src/features/contacts/components/ContactBulkImport.tsx`**

1. **Expand `checkForDuplicatesAcrossLocations` to also check the SAME location** — rename it to something like `checkForDuplicates` and add a second query that checks for existing contacts in the current location with matching phone numbers or email addresses.

2. **Same-location duplicate logic:**
   - Query all contacts in the current tenant where `location_id = currentLocationId` and `is_deleted = false`
   - Build lookup maps by normalized phone AND by lowercase email
   - For each import row, check if phone or email already exists in the same location
   - Mark these as "same-location duplicates" and exclude from the clean import set

3. **Update the UI duplicate summary** to distinguish between:
   - Same-location duplicates (skipped because they already exist in this location)
   - Cross-location duplicates (skipped because they exist in another location)

4. **Also check during the actual `handleImport`** — the same-location check should run at import time too (not just preview time), to catch any contacts added between preview and import.

### Technical Details

The updated duplicate check function will:

```
1. Query contacts WHERE tenant_id = X AND location_id = currentLocationId AND is_deleted = false
2. Query contacts WHERE tenant_id = X AND location_id != currentLocationId AND is_deleted = false  
3. Build phone + email lookup maps for both sets
4. For each import row:
   - If phone/email matches same-location contact -> mark as "already exists" (skip)
   - If phone/email matches other-location contact -> mark as "exists in other location" (skip)
   - Otherwise -> clean for import
```

The UI will show a clear summary like:
- "12 duplicates skipped (already in East Coast)"  
- "3 duplicates skipped (exist in West Coast)"
- "85 contacts ready to import"

### Result

- No duplicate contacts will be imported into the same location
- Cross-location duplicates continue to be caught
- Users get clear feedback about why contacts were skipped
- All imported contacts are correctly scoped to the location where the import button was clicked
