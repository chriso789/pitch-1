

# Data Reset: Clear Imported Leads for Fresh Location-Specific Import

## Current State Summary

| Location | Pipeline Entries | With Estimates | Estimate Value | Projects |
|----------|------------------|----------------|----------------|----------|
| **East Coast** | 35 | 6 entries | $227,737 (7 estimates) | 2 |
| **West Coast** | 19 | 3 entries | $186,474 (8 estimates) | 0 |

---

## ⚠️ Critical Decision Required

Some pipeline entries have **active work** (estimates and projects). Before wiping, you need to decide:

### Entries with Estimates (Would Be Lost):

**East Coast:**
| Contact | Job # | Estimates | Total Value |
|---------|-------|-----------|-------------|
| Daniel Murphey | 3075-1-0 | 2 | $95,958 |
| Henry Germann | 3329-1-0 | 1 | $68,788 |
| Paul Wilbert | 2572-1-0 | 1 | $27,987 |
| Grosso House | 3074-1-0 | 1 | $25,000 |
| Yvonnie Spencer | 3076-1-0 | 1 | $10,004 |
| Gary Neiskes | 3328-1-0 | 1 | $0 |

**West Coast:**
| Contact | Job # | Estimates | Total Value |
|---------|-------|-----------|-------------|
| Edward Lake | 2570-2-0 | 2 | $66,251 |
| Don Brandt | 3077-1-0 | 3 | $65,310 |
| Punit Shah | 3333-1-0 | 3 | $54,913 |

### Entries with Projects:
- Paul Wilbert (JOB-0003) - East Coast
- Yvonnie Spencer (JOB-0011) - East Coast

---

## Option A: Full Wipe (Lose All Work)

Delete ALL pipeline entries and contacts so you can re-import cleanly.

**What gets deleted:**
- All 54 pipeline entries
- All estimates ($414K worth)
- Both projects
- All associated contacts

### SQL for Option A:
```sql
-- WARNING: This deletes ALL work including estimates and projects

-- Step 1: Delete estimates
DELETE FROM enhanced_estimates 
WHERE pipeline_entry_id IN (
  SELECT id FROM pipeline_entries 
  WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
);

-- Step 2: Delete estimate line items (if any orphaned)
DELETE FROM enhanced_estimate_line_items 
WHERE estimate_id NOT IN (SELECT id FROM enhanced_estimates);

-- Step 3: Delete projects
DELETE FROM projects 
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Step 4: Delete pipeline activities
DELETE FROM pipeline_activities 
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Step 5: Delete pipeline entries
DELETE FROM pipeline_entries 
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Step 6: Delete contacts
DELETE FROM contacts 
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
```

---

## Option B: Keep Entries with Work, Wipe Only Empty Imports

Keep the 9 entries that have estimates/projects, delete the rest.

**What gets kept:**
- 9 pipeline entries with estimates
- All estimates ($414K)
- Both projects
- Associated contacts

**What gets deleted:**
- 45 pipeline entries without work
- Their associated contacts (if no other links)

### SQL for Option B:
```sql
-- Soft-delete pipeline entries that have NO estimates and NO projects
UPDATE pipeline_entries 
SET is_deleted = true
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND id NOT IN (
    SELECT DISTINCT pipeline_entry_id FROM enhanced_estimates
    UNION
    SELECT DISTINCT pipeline_entry_id FROM projects WHERE pipeline_entry_id IS NOT NULL
  );

-- Result: Only entries with real work remain
-- You can then re-import your lists - duplicates will be flagged by the new detection system
```

---

## Recommendation

**Option B is safer** - it preserves the $414K in estimates and active projects while clearing out the empty imported leads.

After running Option B:
1. You'll have 9 entries left (the ones with real work)
2. Import your East Coast list with "East Coast" selected
3. Import your West Coast list with "West Coast" selected
4. The duplicate detection added earlier will warn you if any imports match existing contacts

---

## No Code Changes Required

This is purely a data operation. Run the SQL in [Supabase SQL Editor](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/sql/new).

**Tell me which option you want and I'll confirm the exact SQL to run.**

