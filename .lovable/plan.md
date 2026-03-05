

# Merge Duplicate Benedict Lal Contacts

## Problem
"Benedict Lal" at 512 Park Ave exists as two separate contact records:

| Record | ID | address_street | city | state | zip | Created |
|--------|----|---------------|------|-------|-----|---------|
| **Original** | `27e41e33...` | `512 Park Avenue, West Palm Beach, FL 33403 US` | West Palm Beach | null | null | Jan 19 |
| **Duplicate** | `eee5494d...` | `512 park ave` | west palm beach | FL | 33403 | Feb 12 |

The duplicate slipped past the unique index because the street normalization differs (`512 park avenue west palm beach fl 33403 us` vs `512 park ave`).

The duplicate has 1 pipeline entry (lead 3352-1-0) and no other related data.

## Data Fix (SQL operations)

### 1. Re-link the duplicate's pipeline entry to the original contact
Move pipeline entry `3f20dcd4...` from duplicate `eee5494d` to original `27e41e33`.

### 2. Delete the duplicate contact
Remove `eee5494d` after its pipeline entry is moved.

### 3. Fix the original contact's address fields
The original has the full formatted address crammed into `address_street` with null state/zip. Update to properly parsed fields:
- `address_street` → `512 Park Avenue`
- `address_city` → `West Palm Beach`
- `address_state` → `FL`
- `address_zip` → `33403`

### 4. Clean up duplicate pipeline entries on the original
The original contact `27e41e33` already has TWO pipeline entries (contact_number 3099 and 3290, both "lead" status). After merging, it will have three. The two older ones should be reviewed — if both are duplicates, soft-delete or remove the extra one.

This is a data-only fix via SQL. No code changes needed.

