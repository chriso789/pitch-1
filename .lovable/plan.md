

## Fix: Contact Import Statement Timeout

### Problem

The batch size logic on line 1562 of `ContactBulkImport.tsx`:

```
const batchSize = length > 500 ? 25 : length > 100 ? 50 : 100;
```

For 86 contacts, the batch size is **100**, meaning all 86 contacts are inserted in one query. This single large insert triggers a database statement timeout because of RLS policy checks, triggers, and pipeline entry creation per contact.

### Fix

**File: `src/features/contacts/components/ContactBulkImport.tsx` (line 1562)**

Reduce the default batch size so even small imports are batched:

```
const batchSize = length > 500 ? 10 : length > 100 ? 20 : 25;
```

This ensures:
- 86 contacts = 4 batches of ~22 each
- 200 contacts = 10 batches of 20
- 1000 contacts = 100 batches of 10

Also increase the inter-batch delay (line 1626-1628) from 150ms to 300ms, and apply it for all imports (remove the `> 100` threshold) to give the database breathing room.

### Result

The 86-contact import will succeed by splitting into manageable batches that complete within the database statement timeout.
