
# Plan: Fix Pipeline Stage Key Mismatch

## Problem Identified

The Pipeline Stages in Settings don't match the Kanban because:

| Component | Status Keys Used |
|-----------|-----------------|
| **Settings > Pipeline Stages** | Auto-generates keys from name: `new_lead`, `contacted`, `qualified`, etc. |
| **Existing Pipeline Entries** | Use legacy hardcoded keys: `lead`, `contingency_signed`, `legal_review`, `project`, etc. |
| **Kanban View** | Groups entries by status key - **no matches found** |

**Current Entry Status Distribution:**
- `lead` - 267 entries
- `contingency_signed` - 15 entries  
- `legal_review` - 14 entries
- `ready_for_approval` - 8 entries
- `project` - 7 entries
- `completed` - 3 entries
- `closed` - 1 entry

**Current Stage Keys (Generated):**
- `new_lead`, `contacted`, `qualified`, `appointment_set`, `proposal_sent`, `negotiating`, `closed_won`, `closed_lost`, `estimate_sent`

**Result:** All 315 entries are "orphaned" and dumped into the first column.

## Solution: Add Persistent Stage Keys

Add a `key` column to `pipeline_stages` table so administrators can explicitly set the status key that matches existing entries.

### Part 1: Database Migration

Add `key` column to `pipeline_stages`:

```sql
ALTER TABLE pipeline_stages 
ADD COLUMN key TEXT;

-- Add unique constraint per tenant
ALTER TABLE pipeline_stages
ADD CONSTRAINT pipeline_stages_tenant_key_unique 
UNIQUE (tenant_id, key);

-- Update existing O'Brien stages to match their legacy keys
UPDATE pipeline_stages SET key = 'lead' WHERE name = 'New Lead' AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
UPDATE pipeline_stages SET key = 'contingency_signed' WHERE name = 'Contacted' AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
-- etc.
```

### Part 2: Update usePipelineStages Hook

Use the database `key` column instead of auto-generating:

```typescript
// Before
key: generateStageKey(stage.name),  // "New Lead" → "new_lead"

// After  
key: stage.key || generateStageKey(stage.name),  // Use DB key first, fallback to generated
```

### Part 3: Update PipelineStageManager Component

Allow users to edit the stage key in the Settings UI:
- Add a "Key" input field to the stage editor
- Auto-populate from name if blank
- Validate key uniqueness per tenant
- Show warning if key change would orphan entries

### Part 4: Provide Migration UI

Add a "Fix Orphaned Entries" tool that:
1. Scans for entries with status values not matching any stage key
2. Shows admin which entries would be affected
3. Allows bulk update of entry statuses to new keys

## Alternative Quick Fix

If you want to fix this immediately without UI changes:

**Option A:** Rename stages to match existing keys:
- Rename "New Lead" → "Lead" (generates key `lead`)
- Add "Contingency Signed" stage (generates key `contingency_signed`)
- Add "Legal Review" stage (generates key `legal_review`)
- etc.

**Option B:** Bulk update existing entries to new keys:
```sql
UPDATE pipeline_entries SET status = 'new_lead' WHERE status = 'lead';
UPDATE pipeline_entries SET status = 'contacted' WHERE status = 'contingency_signed';
-- etc.
```

## Recommended Approach

1. Add `key` column to `pipeline_stages` table
2. Update Settings UI to allow key editing
3. Update O'Brien's existing stages with correct keys
4. Update `usePipelineStages` to use database key

This gives full control over stage-to-status mapping without losing existing data.

## Files to Modify

| File | Change |
|------|--------|
| Database migration | Add `key` column to `pipeline_stages` |
| `usePipelineStages.ts` | Use `stage.key` from DB |
| `PipelineStageManager.tsx` | Add key field to edit form |
| `Settings.tsx` | No change needed |
