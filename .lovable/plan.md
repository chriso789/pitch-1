

# Bulk Upload for Scope Intelligence

## Overview

Add a dedicated bulk upload feature to Scope Intelligence that allows users to upload as many insurance scope PDFs as they want in a single batch, with all documents processed through the AI extraction pipeline.

---

## Implementation

### 1. New Component: ScopeBulkUploader

**File:** `src/components/insurance/ScopeBulkUploader.tsx`

A modal dialog for bulk uploading insurance scopes, based on the existing `BulkDocumentUpload` pattern.

**Features:**
- Drag-and-drop zone for multiple PDFs
- Document type selector (applies to all files in batch)
- Scrollable file list with status indicators
- Batch processing (5 files at a time for performance)
- Overall progress bar
- Individual file status (pending → uploading → processing → success/error)
- Cancel/retry capabilities

**UI Layout:**
```text
┌─────────────────────────────────────────────────────────────┐
│  Bulk Upload Insurance Scopes                          [X] │
├─────────────────────────────────────────────────────────────┤
│  Document Type: [Estimate ▼]                                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │      📄  Drag & drop insurance scope PDFs           │   │
│  │          or click to select files                   │   │
│  │                                                     │   │
│  │         [Select Files]                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Files to upload (12):                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ✓ StateFarm_Estimate_001.pdf          2.4 MB        │   │
│  │ ⟳ Allstate_Supplement.pdf             1.8 MB        │   │
│  │ ○ Farmers_Final.pdf                   3.2 MB    [X] │   │
│  │ ○ USAA_Reinspection.pdf               1.1 MB    [X] │   │
│  │ ...                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ────────────────────────────────── 45% ──────────────      │
│  Uploading 5 of 12 files...                                 │
│                                                             │
│                         [Cancel]  [Upload 12 Files]         │
└─────────────────────────────────────────────────────────────┘
```

---

### 2. Update ScopeIntelligence Page Header

**File:** `src/pages/ScopeIntelligence.tsx`

Add a "Bulk Upload" button in the header actions area:

```tsx
<div className="flex items-center gap-2">
  {/* ... existing view mode toggle ... */}
  <Button variant="outline" size="sm" onClick={() => setShowBulkUpload(true)}>
    <Upload className="h-4 w-4 mr-2" />
    Bulk Upload
  </Button>
  {/* ... existing refresh and backfill buttons ... */}
</div>
```

Add the dialog component:

```tsx
<ScopeBulkUploader
  open={showBulkUpload}
  onOpenChange={setShowBulkUpload}
  onUploadComplete={() => {
    refetch();
    setShowBulkUpload(false);
  }}
/>
```

---

### 3. Upload Flow

For each file in the batch:

1. **Upload to Storage**
   - Path: `insurance-scopes/{tenant_id}/{timestamp}_{filename}.pdf`
   - Bucket: `documents`

2. **Call scope-document-ingest Edge Function**
   - Pass `storage_path`, `document_type`, `file_name`
   - The existing edge function handles:
     - Creating `insurance_scope_documents` record
     - AI extraction of carrier, totals, line items
     - Creating header and line item records
     - Status updates (extracting → parsing → mapping → complete)

3. **Update UI Status**
   - pending → uploading → processing → success/error

---

### 4. Batch Processing Strategy

Process files in parallel batches of 5 (same pattern as existing `BulkDocumentUpload`):

```typescript
const batchSize = 5;
for (let i = 0; i < files.length; i += batchSize) {
  const batch = files.slice(i, i + batchSize);
  await Promise.all(batch.map(file => processFile(file)));
}
```

This prevents overwhelming the edge function and provides better progress feedback.

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/insurance/ScopeBulkUploader.tsx` | CREATE | Modal dialog for bulk PDF uploads |
| `src/pages/ScopeIntelligence.tsx` | MODIFY | Add bulk upload button and dialog |

---

## Component Structure

```typescript
interface ScopeBulkUploaderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
}

interface FileUploadStatus {
  file: File;
  status: 'pending' | 'uploading' | 'processing' | 'success' | 'error';
  error?: string;
  documentId?: string;
}
```

---

## Key Implementation Details

### Document Type Options
Users can select one document type that applies to all files in the batch:
- Estimate (default)
- Supplement
- Final Settlement
- Denial
- Policy
- Reinspection

### File Validation
- Accept only PDFs: `.pdf` files
- Max file size: 50MB per file (matches existing ScopeUploader)
- No limit on number of files

### Progress Tracking
- Overall progress bar showing % of files completed
- Individual file icons:
  - ○ Pending (gray)
  - ⟳ Uploading/Processing (spinning)
  - ✓ Success (green)
  - ✕ Error (red)

### Error Handling
- Individual file errors don't stop the batch
- Summary toast at completion shows success/failure counts
- Error message displayed per file

---

## Expected User Flow

1. Click "Bulk Upload" button in Scope Intelligence header
2. Dialog opens with dropzone
3. Select document type (optional, defaults to "Estimate")
4. Drag & drop PDFs or click to select
5. Review file list, remove any unwanted files
6. Click "Upload X Files"
7. Watch progress bar as files upload and process
8. See success/error status per file
9. Dialog closes, document list refreshes
10. Documents appear in list as they complete processing

---

## Technical Notes

- Uses same `useUploadScope` mutation pattern but wrapped in batch logic
- Files uploaded to `documents` storage bucket (same as existing)
- Edge function `scope-document-ingest` handles AI extraction (no changes needed)
- All files in batch get same `document_type` (simplifies UX)
- Query cache invalidated on completion to show new documents

