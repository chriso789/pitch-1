
# Add Edit Button for Project/Lead Details

## Problem
The lead/project page displays Priority, Roof Type, Roof Age, and Est. Value as read-only text (lines 792-818 of `LeadDetails.tsx`). There is no edit button to modify these fields, unlike the Sales Rep field which has an inline edit pencil icon.

## Solution
Add an edit button (pencil icon) next to the lead information row that opens a dialog to edit all four fields.

---

## Implementation Details

### 1. Create EditProjectDetailsDialog Component

**New File:** `src/components/lead-details/EditProjectDetailsDialog.tsx`

A dialog component with form fields for:
- **Priority** (Select: high, medium, low)
- **Roof Type** (Select: shingle, metal, tile, flat, slate, cedar, other)
- **Roof Age** (Number input, stored in metadata.roof_age_years)
- **Estimated Value** (Number input with $ formatting)

```text
┌────────────────────────────────────────────────┐
│  ✏️ Edit Project Details               [X]    │
├────────────────────────────────────────────────┤
│                                                │
│  Priority:        [High      ▼]                │
│                                                │
│  Roof Type:       [Tile      ▼]                │
│                                                │
│  Roof Age (years): [15        ]                │
│                                                │
│  Estimated Value:  [$100,000  ]                │
│                                                │
│              [Cancel]  [Save Changes]          │
└────────────────────────────────────────────────┘
```

**Props:**
- `open: boolean`
- `onOpenChange: (open: boolean) => void`
- `pipelineEntryId: string`
- `initialValues: { priority, roof_type, roof_age_years, estimated_value }`
- `onSave: () => void` (callback to refresh data)

### 2. Update LeadDetails.tsx

**Location:** Lines 792-818 (the Lead Information section)

**Changes:**
1. Add state for dialog visibility:
```typescript
const [showEditProjectDialog, setShowEditProjectDialog] = useState(false);
```

2. Add edit button at the end of the information row:
```tsx
<div className="flex items-center gap-4 text-sm mt-2">
  {/* Existing Priority, Roof, Roof Age, Est. Value displays */}
  
  {/* NEW: Edit button */}
  <Button 
    variant="ghost" 
    size="sm" 
    className="h-5 w-5 p-0"
    onClick={() => setShowEditProjectDialog(true)}
  >
    <Edit2 className="h-3 w-3" />
  </Button>
</div>
```

3. Import and render the dialog:
```tsx
import { EditProjectDetailsDialog } from '@/components/lead-details/EditProjectDetailsDialog';

// At bottom of component, before closing tags:
<EditProjectDetailsDialog
  open={showEditProjectDialog}
  onOpenChange={setShowEditProjectDialog}
  pipelineEntryId={id!}
  initialValues={{
    priority: lead.priority || 'medium',
    roof_type: lead.roof_type || 'shingle',
    roof_age_years: lead.metadata?.roof_age_years || null,
    estimated_value: lead.estimated_value || null,
  }}
  onSave={() => {
    refetchLead();
    setShowEditProjectDialog(false);
  }}
/>
```

### 3. Database Update Logic

The dialog will update `pipeline_entries` with:
```typescript
await supabase
  .from('pipeline_entries')
  .update({
    priority: formData.priority,
    roof_type: formData.roof_type,
    estimated_value: formData.estimated_value,
    metadata: {
      ...existingMetadata,
      roof_age_years: formData.roof_age_years
    }
  })
  .eq('id', pipelineEntryId);
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/lead-details/EditProjectDetailsDialog.tsx` | **Create** | New dialog component with form |
| `src/pages/LeadDetails.tsx` | **Modify** | Add edit button + dialog state + render dialog |

---

## Visual Result

**Before:**
```
Priority: High   Roof: Tile   Roof Age: 15 years   Est. Value: $100,000
```

**After:**
```
Priority: High   Roof: Tile   Roof Age: 15 years   Est. Value: $100,000  ✏️
                                                                         ^
                                                              Edit button (pencil)
```

---

## Technical Notes

- Uses existing Select and Input components from shadcn/ui
- Follows the same pattern as Sales Rep inline editing (Edit2 icon)
- Respects the existing `roof_type` enum values from database
- Preserves other metadata fields when updating `metadata.roof_age_years`
