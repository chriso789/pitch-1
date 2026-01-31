
# Fix: Cross-Location Data Contamination in Pipeline

## Problem Summary

West Coast clients are appearing in the East Coast pipeline view. The user has "East Coast" selected but sees clients that should only exist in West Coast. This is corrupting business records and "messing up the books."

## Root Cause Analysis

After investigating the database, I found that **duplicate entries were created during CSV imports**:

| Contact | West Coast Import | East Coast Import (DUPLICATE) |
|---------|-------------------|-------------------------------|
| Irina Gorovits | 2026-01-23 03:24 | 2026-01-23 14:24 |
| James White | 2026-01-23 03:24 | 2026-01-23 14:22 |
| Henry Germann | 2026-01-23 03:24 | 2026-01-23 14:18 |
| Gary Neiskes | 2026-01-23 03:24 | 2026-01-23 14:16 |

The contacts were originally imported to **West Coast** at 03:24, then **re-imported to East Coast** later the same day at 14:16-14:24. The bulk import system does not check if a contact with the same phone/email already exists in another location.

The pipeline location filter code is working correctly. The issue is **bad data** from duplicate imports.

## Solution Overview

### Part 1: Immediate Data Cleanup (Database Fix)

Soft-delete the duplicate East Coast pipeline entries that are copies of West Coast entries.

### Part 2: Prevention (Code Enhancement)

Add duplicate contact detection to the CSV import process that warns users when importing contacts that already exist in another location.

---

## Part 1: Database Cleanup

### Step 1.1: Identify and soft-delete duplicate East Coast entries

```sql
-- First, identify the duplicates (contacts imported to East Coast that match West Coast contacts by phone)
-- These East Coast entries were created AFTER the West Coast entries

-- Soft-delete the duplicate East Coast pipeline entries
UPDATE pipeline_entries 
SET is_deleted = true
WHERE id IN (
  SELECT pe1.id
  FROM pipeline_entries pe1
  JOIN contacts c1 ON pe1.contact_id = c1.id
  JOIN pipeline_entries pe2 ON pe2.id != pe1.id
  JOIN contacts c2 ON pe2.contact_id = c2.id
  WHERE pe1.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
    AND pe2.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
    AND pe1.is_deleted = false
    AND pe2.is_deleted = false
    AND pe1.location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6' -- East Coast
    AND pe2.location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16' -- West Coast
    AND pe1.created_at > pe2.created_at  -- East Coast was created AFTER West Coast (duplicate)
    AND REGEXP_REPLACE(c1.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(c2.phone, '[^0-9]', '', 'g')
);
```

This SQL query will be run manually in Supabase SQL Editor to clean up the existing duplicate data.

---

## Part 2: Prevent Future Duplicates

### Changes to ContactBulkImport.tsx

Add duplicate detection that checks if contacts with the same phone/email already exist in other locations before import.

### Step 2.1: Add duplicate check function

Add a new function to check for existing contacts across all locations:

```typescript
// Check for duplicate contacts across locations before import
const checkForDuplicatesAcrossLocations = async (
  contacts: ContactImportData[],
  tenantId: string,
  currentLocationId: string | null
): Promise<{ 
  duplicates: Array<{
    importRow: ContactImportData;
    existingContact: { name: string; phone: string; location_name: string };
  }>;
  clean: ContactImportData[];
}> => {
  // Extract all phones from import data
  const importPhones = contacts
    .map(c => c.phone?.replace(/\D/g, ''))
    .filter(p => p && p.length >= 7);

  if (importPhones.length === 0) {
    return { duplicates: [], clean: contacts };
  }

  // Check for existing contacts with matching phones in OTHER locations
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select(`
      id,
      first_name,
      last_name,
      phone,
      location_id,
      locations!contacts_location_id_fkey(name)
    `)
    .eq('tenant_id', tenantId)
    .eq('is_deleted', false)
    .neq('location_id', currentLocationId) // Different location
    .not('phone', 'is', null);

  if (!existingContacts || existingContacts.length === 0) {
    return { duplicates: [], clean: contacts };
  }

  // Build lookup map of existing phones
  const existingPhoneMap = new Map<string, typeof existingContacts[0]>();
  existingContacts.forEach(c => {
    const normalizedPhone = c.phone?.replace(/\D/g, '');
    if (normalizedPhone && normalizedPhone.length >= 7) {
      existingPhoneMap.set(normalizedPhone, c);
    }
  });

  // Separate duplicates from clean records
  const duplicates: Array<{
    importRow: ContactImportData;
    existingContact: { name: string; phone: string; location_name: string };
  }> = [];
  const clean: ContactImportData[] = [];

  contacts.forEach(c => {
    const normalizedPhone = c.phone?.replace(/\D/g, '');
    const existing = normalizedPhone ? existingPhoneMap.get(normalizedPhone) : null;
    
    if (existing) {
      duplicates.push({
        importRow: c,
        existingContact: {
          name: `${existing.first_name} ${existing.last_name}`,
          phone: existing.phone || '',
          location_name: (existing.locations as any)?.name || 'Unknown Location'
        }
      });
    } else {
      clean.push(c);
    }
  });

  return { duplicates, clean };
};
```

### Step 2.2: Add UI warning for duplicates

Add state and UI to show warning when duplicates are detected:

```typescript
// New state for cross-location duplicates
const [crossLocationDuplicates, setCrossLocationDuplicates] = useState<Array<{
  importRow: ContactImportData;
  existingContact: { name: string; phone: string; location_name: string };
}>>([]);
const [skipDuplicates, setSkipDuplicates] = useState(true);
```

Add warning UI:

```tsx
{crossLocationDuplicates.length > 0 && (
  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
    <div className="flex items-center gap-2 mb-2">
      <AlertCircle className="h-5 w-5 text-amber-500" />
      <span className="text-sm font-medium text-amber-500">
        {crossLocationDuplicates.length} contact(s) already exist in another location
      </span>
    </div>
    <p className="text-sm text-muted-foreground mb-2">
      These contacts have matching phone numbers in other locations and will be skipped to prevent duplicates:
    </p>
    <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
      {crossLocationDuplicates.slice(0, 5).map((dup, i) => (
        <li key={i}>
          {dup.importRow.first_name} {dup.importRow.last_name} ({dup.importRow.phone}) 
          → exists in <strong>{dup.existingContact.location_name}</strong>
        </li>
      ))}
      {crossLocationDuplicates.length > 5 && (
        <li>...and {crossLocationDuplicates.length - 5} more</li>
      )}
    </ul>
  </div>
)}
```

### Step 2.3: Filter out duplicates during import

Modify the import logic to skip contacts that already exist in other locations.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/features/contacts/components/ContactBulkImport.tsx` | Add `checkForDuplicatesAcrossLocations` function, add duplicate warning UI, filter duplicates during import |

---

## Expected Behavior After Fix

1. **Immediate**: Run the cleanup SQL to soft-delete duplicate East Coast entries
2. **Future imports**: When importing contacts to a location, the system will:
   - Check if any phone numbers already exist in other locations
   - Display a warning listing the duplicates
   - Skip importing those duplicates by default
   - Prevent cross-location data contamination

---

## Data Verification After Cleanup

After running the cleanup SQL:
- East Coast should have ~31-32 unique entries (down from 35)
- West Coast should remain at 20 entries (unchanged, as originals)
- No duplicate phone numbers should exist across locations

---

## Technical Notes

- The cleanup uses soft-delete (`is_deleted = true`) rather than hard delete to preserve audit trail
- The duplicate check compares normalized phone numbers (digits only) to handle formatting differences
- Only contacts in OTHER locations are flagged as duplicates; re-importing to the same location is allowed for updates
