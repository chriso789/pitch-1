
# Fix: Pipeline Drag Handler - Missing Columns Error

## Problem Identified

When dragging a pipeline entry to the "Project" status, the `pipeline-drag-handler` edge function throws an error:

```
Could not find the 'approved_at' column of 'projects' in the schema cache
```

**Root Cause:** Lines 266-267 in `pipeline-drag-handler/index.ts` try to insert `approved_by` and `approved_at` columns that don't exist in the `projects` table.

```typescript
// These columns don't exist in the projects table:
approved_by: user.id,     // Line 266
approved_at: new Date().toISOString()  // Line 267
```

## Projects Table Schema (Actual)

| Column | Exists |
|--------|--------|
| `id`, `tenant_id`, `pipeline_entry_id` | ✅ |
| `name`, `status`, `project_type` | ✅ |
| `selling_price`, `gross_profit` | ❌ (Not in schema) |
| `created_by`, `location_id`, `contact_id` | ✅ `contact_id` missing! |
| `approved_by`, `approved_at` | ❌ **Missing** |

## Solution

Remove the non-existent columns from the insert statement in `pipeline-drag-handler/index.ts`:

**File:** `supabase/functions/pipeline-drag-handler/index.ts` (lines 253-270)

**Changes:**
1. Remove `approved_by` and `approved_at` from the insert
2. Remove `selling_price`, `gross_profit` (also not in schema)
3. Remove `contact_id` (not in projects schema - address inherited via pipeline_entry)
4. Store approval info in `metadata` JSONB field instead

**Current (broken):**
```typescript
.insert({
  tenant_id: profile.tenant_id,
  pipeline_entry_id: pipelineEntryId,
  contact_id: fullEntry.contact_id,    // ❌ Column doesn't exist
  location_id: fullEntry.location_id,
  name: projectName,
  status: 'active',
  project_type: fullEntry.lead_type || 'roofing',
  selling_price: fullEntry.selling_price,  // ❌ Column doesn't exist
  gross_profit: fullEntry.gross_profit,    // ❌ Column doesn't exist
  created_by: user.id,
  approved_by: user.id,                     // ❌ Column doesn't exist
  approved_at: new Date().toISOString()     // ❌ Column doesn't exist
})
```

**Fixed:**
```typescript
.insert({
  tenant_id: profile.tenant_id,
  pipeline_entry_id: pipelineEntryId,
  location_id: fullEntry.location_id,
  name: projectName,
  status: 'active',
  created_by: user.id,
  metadata: {
    approved_by: user.id,
    approved_by_name: `${profile.first_name} ${profile.last_name}`,
    approved_at: new Date().toISOString(),
    project_type: fullEntry.lead_type || 'roofing',
    source: 'pipeline_drag'
  }
})
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/pipeline-drag-handler/index.ts` | Remove non-existent columns, use metadata JSONB |

---

## Testing After Fix

1. Navigate to `/pipeline`
2. Drag a card from "Ready for Approval" to "Project"
3. Verify the project is created successfully
4. Check that no error toast appears
