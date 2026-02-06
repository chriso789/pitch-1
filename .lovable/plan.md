# Plan: Template Attachments Management & Page Organization for Estimates

## ✅ COMPLETED

## Problems Identified

1. **Metal flyer not attached when editing estimate**: When loading an existing estimate for editing, the code sets `selectedTemplateId` (line 418) but **does NOT call `fetchTemplateAttachments()`**. This means template attachments are only loaded when a user manually selects a template from the dropdown - not when editing a saved estimate.

2. **No UI to add/remove attachments**: There's no interface for users to:
   - See which attachments are linked to a template
   - Add new attachments to an estimate
   - Remove unwanted attachments from an estimate

3. **No way to organize/reorder pages**: Users cannot reorder the extra pages (Cover Page, Warranty Info, Attachments, etc.) in the estimate preview.

---

## Solution Overview

### Fix 1: Load Template Attachments When Editing Estimate

**File**: `src/components/estimates/MultiTemplateSelector.tsx`

Add a call to `fetchTemplateAttachments()` after setting the template ID in `loadEstimateForEditing`:

```typescript
// Around line 418
if (estimate.template_id) {
  setSelectedTemplateId(estimate.template_id);
  // FIX: Also fetch template attachments for the loaded template
  fetchTemplateAttachments(estimate.template_id);
}
```

---

### Fix 2: Add Attachments Management UI Panel

Create a new component that displays in the Estimate Preview Panel's left sidebar, allowing users to:
- View all auto-attached documents from template
- Add additional PDF attachments from their Documents library
- Remove attachments from this estimate (without removing from template)
- Reorder attachments via drag-and-drop

**New Component**: `src/components/estimates/EstimateAttachmentsManager.tsx`

```typescript
interface EstimateAttachmentsManagerProps {
  templateAttachments: TemplateAttachment[];
  additionalAttachments: TemplateAttachment[];
  onAddAttachment: (attachment: TemplateAttachment) => void;
  onRemoveAttachment: (documentId: string) => void;
  onReorderAttachments: (attachments: TemplateAttachment[]) => void;
}
```

**Features**:
- Section showing "Template Attachments" (auto-linked from template)
- Section showing "Additional Attachments" (manually added for this estimate)
- "Add Document" button that opens a picker from company documents
- Drag handles for reordering
- Remove buttons for each attachment

---

### Fix 3: Add Page Order Management UI

Add a collapsible panel in the Preview sidebar that shows all pages and allows drag-to-reorder:

**Location**: `src/components/estimates/EstimatePreviewPanel.tsx` - add new section in left panel

```typescript
// New state to track page order
const [pageOrder, setPageOrder] = useState<string[]>([
  'cover_page',
  'content_pages',
  'warranty_info',
  'attachments'
]);

// Page Order UI with drag-and-drop
<div className="space-y-2">
  <h4>Page Order</h4>
  <DndContext onDragEnd={handleDragEnd}>
    <SortableContext items={pageOrder}>
      {pageOrder.map((pageId) => (
        <SortablePageItem key={pageId} id={pageId} label={getPageLabel(pageId)} />
      ))}
    </SortableContext>
  </DndContext>
</div>
```

This uses the existing `@dnd-kit` library already installed in the project.

---

## Technical Implementation

### Step 1: Fix Attachment Loading on Estimate Edit

**File**: `src/components/estimates/MultiTemplateSelector.tsx`

In `loadEstimateForEditing()`, after setting the template ID, call `fetchTemplateAttachments`:

| Line | Change |
|------|--------|
| ~418 | Add `fetchTemplateAttachments(estimate.template_id);` after `setSelectedTemplateId(estimate.template_id);` |

---

### Step 2: Create Attachments Manager Component

**New File**: `src/components/estimates/EstimateAttachmentsManager.tsx`

Component with:
- List of template attachments (with "From Template" badge)
- List of additional attachments
- Add button with document picker dialog
- Remove buttons per attachment
- Drag-and-drop reordering

---

### Step 3: Add to Preview Panel Sidebar

**File**: `src/components/estimates/EstimatePreviewPanel.tsx`

Add new props:
- `additionalAttachments` - user-added attachments
- `onAttachmentsChange` - callback for add/remove/reorder

Add new UI section after "Attachments" indicator:
- Show `EstimateAttachmentsManager` component
- Wire up callbacks

---

### Step 4: Create Page Order Manager Component  

**New File**: `src/components/estimates/PageOrderManager.tsx`

Draggable list of page types with toggle visibility:
- Cover Page (on/off + position)
- Estimate Content (always on)
- Warranty Info (on/off + position)
- Attachments (on/off + position)

---

### Step 5: Wire Up Page Order to PDF Generation

**File**: `src/components/estimates/EstimatePDFDocument.tsx`

Accept new `pageOrder` prop and render pages in specified order instead of hardcoded order.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/estimates/EstimateAttachmentsManager.tsx` | UI to add/remove/reorder attachments |
| `src/components/estimates/PageOrderManager.tsx` | UI to reorder pages in estimate |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Call `fetchTemplateAttachments()` when loading estimate for edit |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add attachments manager and page order UI to sidebar |
| `src/components/estimates/EstimatePDFDocument.tsx` | Accept `pageOrder` prop, render pages in user-specified order |

---

## User Flow After Implementation

### Editing an Existing Estimate
1. User clicks "Edit" on a metal roof estimate
2. System loads estimate AND template attachments (metal flyer)
3. Preview shows metal flyer attached
4. User can remove flyer if not wanted for this estimate

### Managing Attachments
1. User opens Preview panel
2. Sees "Attachments" section in sidebar showing template-linked documents
3. Can click "Add Document" to attach additional PDFs
4. Can click X to remove any attachment
5. Can drag to reorder attachments

### Organizing Pages
1. User opens Preview panel
2. Sees "Page Order" section with draggable list
3. Drags "Warranty Info" above "Attachments"
4. Preview updates to show new page order
5. Exported PDF follows same order
