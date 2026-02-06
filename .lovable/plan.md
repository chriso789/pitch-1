
# Plan: Fix Estimate Preview Sidebar - Scroll & Delete Functionality

## Issues Identified

From the screenshot and code analysis:

| Issue | Root Cause |
|-------|------------|
| **Sidebar menu cut off** | `ScrollArea` needs proper height constraints; content overflows without visible scroll |
| **Cannot delete template attachments** | `handleRemoveAttachment` explicitly blocks template attachment removal (shows toast "Cannot Remove") |
| **Duplicate "ATTACHMENTS" headers** | Two sources rendering attachment headers - one from collapsible title and potentially another from the manager component |

---

## Solution Architecture

### 1. Fix Sidebar Scrolling

The `ScrollArea` is inside a flex container but needs explicit height management:

**Current Structure (Line 252-254):**
```tsx
<div className="w-80 border-r flex flex-col bg-muted/30">
  <ScrollArea className="flex-1 p-4">
    {/* All content here */}
  </ScrollArea>
</div>
```

**Fix:**
- Add `overflow-hidden` to the parent flex container
- Ensure `ScrollArea` has `h-full` and proper viewport styling
- Remove padding from `ScrollArea` and add it to an inner container to prevent scroll gutter issues

### 2. Enable Attachment Deletion for All Types

**Current behavior (Lines 151-165):**
- Template attachments are blocked from deletion with a toast message
- Only additional attachments can be removed

**New behavior:**
- Allow deletion of ANY attachment (template or additional)
- Track removed template attachments in local state
- Filter them out when combining attachments
- Show visual distinction for template-sourced vs manually-added

### 3. Remove Duplicate Header

The screenshot shows "ATTACHMENTS (3)" appearing twice. This is caused by:
- The `Collapsible` trigger showing one header
- The `EstimateAttachmentsManager` potentially having its own header

**Fix:** Ensure the `EstimateAttachmentsManager` doesn't render its own section header since the parent already has the collapsible trigger with the header.

---

## Technical Implementation

### File 1: `EstimatePreviewPanel.tsx`

**Scrolling Fix (Line 252-254):**
```tsx
<div className="w-80 border-r flex flex-col bg-muted/30 overflow-hidden">
  <ScrollArea className="flex-1">
    <div className="p-4 space-y-4">
      {/* All content moves inside this wrapper */}
    </div>
  </ScrollArea>
</div>
```

**Template Attachment Deletion (Lines 134-136, 151-165):**
```tsx
// Add state to track removed template attachments
const [removedTemplateIds, setRemovedTemplateIds] = useState<Set<string>>(new Set());

// Filter template attachments to exclude removed ones
const activeTemplateAttachments = templateAttachments.filter(
  a => !removedTemplateIds.has(a.document_id)
);

// Update handleRemoveAttachment to support all types
const handleRemoveAttachment = useCallback((documentId: string) => {
  const isTemplateAttachment = templateAttachments.some(a => a.document_id === documentId);
  
  if (isTemplateAttachment) {
    // Track as removed (don't delete from DB, just hide in this session)
    setRemovedTemplateIds(prev => new Set([...prev, documentId]));
    toast({
      title: 'Attachment Removed',
      description: 'Template attachment hidden from this estimate',
    });
  } else {
    // Remove additional attachment normally
    setAdditionalAttachments(prev => prev.filter(a => a.document_id !== documentId));
  }
}, [templateAttachments, toast]);

// Update allAttachments to use filtered template list
const allAttachments = [...activeTemplateAttachments, ...additionalAttachments];
```

### File 2: `EstimateAttachmentsManager.tsx`

- No header changes needed - the component correctly doesn't have its own header
- Verify the component only renders the list and "Add Document" button

---

## Visual Improvements

### Sidebar Layout Enhancement

| Before | After |
|--------|-------|
| Content cut off at bottom | Full scrollable sidebar with visible scrollbar on hover |
| Cannot delete template attachments | X button works on all attachments |
| Two attachment headers | Single clean collapsible section |

### Attachment Item Visual Distinction

```tsx
// In SortableAttachmentItem:
<Badge variant={attachment.isFromTemplate ? "secondary" : "outline"}>
  {attachment.isFromTemplate ? "Template" : "Added"}
</Badge>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Fix scroll container, enable all attachment deletion, add `removedTemplateIds` state |
| `src/components/estimates/EstimateAttachmentsManager.tsx` | Minor - verify no duplicate headers, enhance delete button visibility |

---

## Expected Results

After implementation:
1. Sidebar scrolls smoothly to reveal all menu items (Terms & Conditions, Custom Fine Print, Signature Block fully visible)
2. All attachments (template and additional) can be removed via X button
3. Single "ATTACHMENTS (n)" header in the collapsible
4. Removed template attachments are hidden for the current session
5. Reset Defaults button restores removed template attachments
