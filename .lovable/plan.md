
# Plan: Fix Pipeline Stages and Separate from Contact Statuses

## Problems Identified

### Problem 1: Pipeline Stages Not Connected to Kanban

The Pipeline Stage Manager successfully saves stages to the `pipeline_stages` table, but the **Kanban view ignores this table entirely**. It uses hardcoded `LEAD_STAGES` from `usePipelineData.ts`:

```typescript
// Current hardcoded stages (not customizable)
export const LEAD_STAGES = [
  { name: "New Lead", key: "lead", color: "bg-blue-500" },
  { name: "Contingency Signed", key: "contingency_signed", color: "bg-yellow-500" },
  // ... etc
];
```

### Problem 2: Contact Statuses Mixed with Pipeline Statuses

Currently there's confusion between:
- **Contact Qualification Status** (`contacts.qualification_status`) - disposition like "qualified", "interested", "not_home"
- **Pipeline Status** (`pipeline_entries.status`) - workflow stages like "lead", "contingency_signed", "project"

Some values overlap (e.g., `contingency_signed` appears in both), causing confusion.

## Solution Overview

### Part A: Connect Pipeline Stages to Kanban

Modify the Kanban to dynamically load stages from `pipeline_stages` table instead of using hardcoded `LEAD_STAGES`.

### Part B: Create Separate Contact Status Manager

Add a new "Contact Statuses" section in Settings to manage contact qualification statuses separately from pipeline stages.

## Implementation Details

### 1. Create Contact Statuses Table (Database Migration)

```sql
CREATE TABLE public.contact_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6b7280',
  category TEXT NOT NULL DEFAULT 'disposition', -- 'disposition', 'interest', 'action'
  status_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false, -- system statuses can't be deleted
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, key)
);

-- Enable RLS
ALTER TABLE public.contact_statuses ENABLE ROW LEVEL SECURITY;

-- Add policies (same pattern as pipeline_stages)
```

### 2. Update usePipelineData Hook

```typescript
// Replace hardcoded LEAD_STAGES with dynamic fetch
export function usePipelineData() {
  // Fetch stages from pipeline_stages table
  const stagesQuery = useQuery({
    queryKey: ['pipeline-stages', profile?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('tenant_id', profile?.tenant_id)
        .eq('is_active', true)
        .order('stage_order');
      
      if (error) throw error;
      return data.map(stage => ({
        name: stage.name,
        key: stage.name.toLowerCase().replace(/\s+/g, '_'),
        color: hexToTailwind(stage.color), // Convert hex to Tailwind class
        id: stage.id
      }));
    }
  });

  // Use fetched stages instead of LEAD_STAGES
  const stages = stagesQuery.data || LEAD_STAGES; // Fallback to hardcoded
  
  // ... rest of hook
}
```

### 3. Update KanbanPipeline Component

```typescript
// Use dynamic stages from hook
const { 
  entries, 
  groupedData, 
  stages,  // NEW: dynamic stages
  isLoading, 
  // ...
} = usePipelineData();

// Render stages dynamically
{stages.map((stage) => (
  <KanbanColumn
    id={stage.key}
    title={stage.name}
    color={stage.color}
    // ...
  />
))}
```

### 4. Create Contact Status Manager Component

New component at `src/components/settings/ContactStatusManager.tsx` similar to `PipelineStageManager.tsx` but for managing contact disposition statuses.

### 5. Update Settings Page

Add two separate sub-tabs under General or a new "Workflow" tab:
- **Pipeline Stages** - for managing Kanban pipeline stages
- **Contact Statuses** - for managing contact qualification dispositions

### 6. Seed Default Statuses for New Tenants

Create a trigger or initialization function to seed default contact statuses when a new tenant is created:
- Not Home
- Interested
- Not Interested
- Qualified
- Follow Up
- Do Not Contact

## Technical Summary

| Component | Current State | After Fix |
|-----------|--------------|-----------|
| Pipeline Stages in Settings | Saves to `pipeline_stages` but unused | Connected to Kanban view |
| Kanban View | Uses hardcoded `LEAD_STAGES` | Dynamically loads from `pipeline_stages` |
| Contact Status Management | None | New manager component |
| Contact Qualification | Hardcoded options | Customizable from `contact_statuses` table |

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/xxx.sql` | Create `contact_statuses` table + RLS |
| `src/hooks/usePipelineData.ts` | Fetch stages dynamically |
| `src/hooks/usePipelineStages.ts` | New hook for stage management |
| `src/features/pipeline/components/KanbanPipeline.tsx` | Use dynamic stages |
| `src/components/settings/ContactStatusManager.tsx` | New component |
| `src/features/settings/components/Settings.tsx` | Add Contact Statuses tab |

This will cleanly separate **Pipeline Workflow Stages** (for lead/job progression) from **Contact Disposition Statuses** (for qualification tracking), and make both fully customizable per company.
