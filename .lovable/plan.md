

# Fix: Restore East Coast Location to O'Brien Contracting

## Overview

Execute Option 1 to reassign the "East Coast" location back to O'Brien Contracting and create a replacement location for "East Coast Roofing Services".

---

## SQL Operations to Execute

### Step 1: Reassign East Coast to O'Brien Contracting

```sql
UPDATE locations 
SET tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
WHERE id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af';
```

### Step 2: Create New Location for East Coast Roofing Services

```sql
INSERT INTO locations (tenant_id, name, is_primary, is_active)
VALUES ('cea48616-dc2c-4ee2-806b-ce0e75411bd4', 'Main Office', true, true);
```

### Step 3: Update Any Orphaned User Assignments

```sql
UPDATE user_location_assignments 
SET tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
WHERE location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af';
```

---

## Expected Results

After executing:
- O'Brien Contracting will have both **East Coast** and **West Coast** locations
- Location dropdown will reappear in the sidebar
- All 1,730 contacts and 277 pipeline entries remain properly linked
- East Coast Roofing Services will have a new "Main Office" location

---

## Verification

1. Hard refresh browser (Ctrl+Shift+R)
2. Location dropdown should appear with both locations
3. Switching to East Coast should show your contacts and leads

