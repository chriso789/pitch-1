
# Plan: Add Review/Delete Actions to Completed Requirement Bubbles

## Problem Summary
Currently, when a requirement bubble (Contract, Estimate, Notice of Commencement, Required Photos) is marked as "Complete":
- The bubble displays with a green checkmark but is **not clickable**
- Users cannot view, review, or delete the associated document
- If the wrong document was scanned, users must go to the Documents tab to find and delete it

The user needs to be able to:
1. **Review** - View the uploaded document directly from the bubble
2. **Delete** - Remove the document so a different one can be scanned
3. **Re-upload** - After deletion, the bubble returns to "Pending" state for new upload

---

## Solution Overview

Add a **Popover menu** to completed requirement bubbles with three actions:
- **View Document** - Opens the document in preview modal
- **Replace Document** - Opens scanner/upload options (like incomplete state)
- **Delete Document** - Removes the document after confirmation

---

## Technical Implementation

### File to Modify: `src/components/ApprovalRequirementsBubbles.tsx`

#### 1. Add New State Variables

```typescript
// State for managing completed bubble actions
const [viewingDocument, setViewingDocument] = useState<{
  id: string;
  filename: string;
  file_path: string;
  mime_type: string | null;
  document_type: string | null;
} | null>(null);
const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
const [deletingDocKey, setDeletingDocKey] = useState<string | null>(null);
const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
const [isDeleting, setIsDeleting] = useState(false);
```

#### 2. Add Query to Fetch Documents for This Lead

```typescript
// Fetch documents for this pipeline entry to enable review/delete
const { data: requirementDocuments, refetch: refetchDocuments } = useQuery({
  queryKey: ['requirement-documents', pipelineEntryId],
  queryFn: async () => {
    if (!pipelineEntryId) return [];
    const { data, error } = await supabase
      .from('documents')
      .select('id, filename, file_path, mime_type, document_type')
      .eq('pipeline_entry_id', pipelineEntryId)
      .in('document_type', ['contract', 'notice_of_commencement', 'required_photos', 'inspection_photo', 'photos']);
    if (error) throw error;
    return data || [];
  },
  enabled: !!pipelineEntryId,
});
```

#### 3. Add Helper to Find Document for a Requirement

```typescript
const getDocumentForRequirement = (stepKey: string) => {
  if (!requirementDocuments) return null;
  
  // Map step keys to document types
  const typeMap: Record<string, string[]> = {
    'contract': ['contract'],
    'notice_of_commencement': ['notice_of_commencement'],
    'required_photos': ['required_photos', 'inspection_photo', 'photos'],
  };
  
  const docTypes = typeMap[stepKey] || [stepKey];
  return requirementDocuments.find(doc => 
    doc.document_type && docTypes.includes(doc.document_type)
  );
};
```

#### 4. Add Delete Handler

```typescript
const handleDeleteRequirementDoc = async () => {
  if (!deletingDocId) return;
  
  setIsDeleting(true);
  try {
    const { error } = await supabase.functions.invoke('delete-documents', {
      body: { document_ids: [deletingDocId], mode: 'delete_only' }
    });
    
    if (error) throw error;
    
    toast({
      title: "Document Deleted",
      description: "You can now upload a new document.",
    });
    
    refetchDocuments();
    onUploadComplete?.();
  } catch (error: any) {
    toast({
      title: "Delete Failed",
      description: error.message || "Could not delete document",
      variant: "destructive",
    });
  } finally {
    setIsDeleting(false);
    setDeleteConfirmOpen(false);
    setDeletingDocId(null);
    setDeletingDocKey(null);
  }
};
```

#### 5. Update Completed Bubble Rendering (Lines 640-664)

Replace the non-interactive completed bubble with a Popover:

```typescript
// BEFORE: Static completed bubble (lines 640-664)
<div className={cn(
  "relative w-10 h-10 sm:w-14 sm:h-14 rounded-full ...",
  isComplete ? `bg-gradient-to-br ${step.color} ...` : "..."
)}>
  ...
</div>

// AFTER: Interactive Popover for completed bubbles
{isComplete ? (
  <Popover>
    <PopoverTrigger asChild>
      <div className={cn(
        "relative w-10 h-10 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-300",
        "border-2 sm:border-4 cursor-pointer",
        `bg-gradient-to-br ${step.color} border-white shadow-lg hover:scale-110 hover:-translate-y-1 hover:shadow-xl`
      )}>
        <Icon className="h-4 w-4 sm:h-6 sm:w-6 text-white" />
        {/* Checkmark Badge */}
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-success rounded-full flex items-center justify-center border-2 border-background shadow-md">
          <CheckCircle className="h-3 w-3 text-success-foreground" />
        </div>
      </div>
    </PopoverTrigger>
    <PopoverContent className="w-56 p-2">
      <div className="space-y-1">
        {/* View Document */}
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            const doc = getDocumentForRequirement(step.key);
            if (doc) setViewingDocument(doc);
          }}
          disabled={!getDocumentForRequirement(step.key)}
        >
          <Eye className="h-4 w-4 mr-2" />
          View Document
        </Button>
        
        {/* Replace Document */}
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            setScanningDocType(step.key);
            setScanningDocLabel(step.label);
            setScannerOpen(true);
          }}
        >
          <Camera className="h-4 w-4 mr-2" />
          Replace Document
        </Button>
        
        {/* Delete Document */}
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive hover:text-destructive"
          onClick={() => {
            const doc = getDocumentForRequirement(step.key);
            if (doc) {
              setDeletingDocId(doc.id);
              setDeletingDocKey(step.label);
              setDeleteConfirmOpen(true);
            }
          }}
          disabled={!getDocumentForRequirement(step.key)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Document
        </Button>
      </div>
    </PopoverContent>
  </Popover>
) : (
  // ... existing incomplete bubble rendering
)}
```

#### 6. Add DocumentPreviewModal for Viewing

```typescript
// Add import at top
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';

// Add modal after AlertDialogs
{viewingDocument && (
  <DocumentPreviewModal
    document={viewingDocument}
    isOpen={!!viewingDocument}
    onClose={() => setViewingDocument(null)}
    onDownload={(doc) => {
      // Simple download handler
      const bucket = doc.document_type === 'contract' ? 'documents' : 'documents';
      supabase.storage.from(bucket).download(doc.file_path).then(({ data }) => {
        if (data) {
          const url = URL.createObjectURL(data);
          const a = document.createElement('a');
          a.href = url;
          a.download = doc.filename;
          a.click();
          URL.revokeObjectURL(url);
        }
      });
    }}
  />
)}
```

#### 7. Add Delete Confirmation Dialog

```typescript
// Delete confirmation AlertDialog (after Override dialog)
<AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete {deletingDocKey} Document?</AlertDialogTitle>
      <AlertDialogDescription>
        This will permanently delete the document. You will need to upload a new one to complete this requirement.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={handleDeleteRequirementDoc}
        disabled={isDeleting}
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {isDeleting ? 'Deleting...' : 'Delete Document'}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

#### 8. Add New Imports

```typescript
import { Eye, Trash2 } from 'lucide-react';
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';
```

---

## UI Changes

### Completed Bubble Popover Menu

```text
+-------------------------+
|  👁️  View Document      |
|  📷  Replace Document   |
|  🗑️  Delete Document    |  (red text)
+-------------------------+
```

### User Flow

1. **View**: Click completed bubble → "View Document" → Preview modal opens
2. **Replace**: Click completed bubble → "Replace Document" → Scanner opens → New doc replaces old
3. **Delete**: Click completed bubble → "Delete Document" → Confirm dialog → Document removed → Bubble returns to "Pending"

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/ApprovalRequirementsBubbles.tsx` | Add imports, state, query, handlers, Popover for completed bubbles, preview modal, delete confirmation |

---

## Special Handling

### Estimate Bubble
The Estimate bubble is different - it doesn't upload a document but selects an existing estimate. For completed estimates:
- **View Estimate** → Navigate to estimate detail or show estimate summary
- **Change Estimate** → Re-open the estimate selector popover
- **Clear Selection** → Remove the selected estimate

### Required Photos
May have multiple photos. The popover will show:
- **View Photos** → Opens photo gallery
- **Add More Photos** → Opens camera
- **Manage Photos** → Navigate to Documents tab filtered to photos

---

## Benefits

1. **Quick Access** - Review documents without leaving the progress view
2. **Easy Correction** - Delete and re-scan wrong documents immediately
3. **Clear Feedback** - Confirmation before destructive actions
4. **Consistent UX** - Same popover pattern for incomplete and complete states
