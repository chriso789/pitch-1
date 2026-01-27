
# Plan: Enhance Document Scanner to Generate Combined PDF

## Problem Summary
The current `DocumentScannerDialog` captures multiple pages as JPEG images but:
1. Uploads them as **individual JPEG files** to storage
2. Creates a document record with a `.pdf` filename but stores `image/jpeg` files
3. Does NOT generate an actual combined PDF document

The "Notice of Commencement" and other scanned documents need to be **real, combined PDFs** that can be shared, printed, and viewed as a single document.

---

## Solution Overview
Enhance the `DocumentScannerDialog` to convert captured pages into a **combined PDF blob** using `jsPDF` before uploading. The result will be a single `.pdf` file stored in Supabase Storage.

---

## Technical Implementation

### File to Modify: `src/components/documents/DocumentScannerDialog.tsx`

#### 1. Add jsPDF Import
```typescript
import jsPDF from 'jspdf';
```

#### 2. Create PDF Generation Helper Function
Add a new function to convert captured image blobs into a combined PDF:

```typescript
const generateCombinedPDF = async (pages: CapturedPage[]): Promise<Blob> => {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter', // 8.5" x 11" standard
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10; // 10mm margins

  for (let i = 0; i < pages.length; i++) {
    // Add new page for subsequent pages
    if (i > 0) {
      pdf.addPage();
    }

    // Convert blob to data URL for jsPDF
    const dataUrl = await blobToDataURL(pages[i].blob);
    
    // Create image element to get dimensions
    const img = await loadImage(dataUrl);
    
    // Calculate dimensions to fit page with margins
    const imgAspect = img.width / img.height;
    const pageAspect = (pageWidth - 2 * margin) / (pageHeight - 2 * margin);
    
    let imgWidth: number;
    let imgHeight: number;
    
    if (imgAspect > pageAspect) {
      // Image is wider than page - fit to width
      imgWidth = pageWidth - 2 * margin;
      imgHeight = imgWidth / imgAspect;
    } else {
      // Image is taller than page - fit to height
      imgHeight = pageHeight - 2 * margin;
      imgWidth = imgHeight * imgAspect;
    }

    // Center on page
    const xOffset = (pageWidth - imgWidth) / 2;
    const yOffset = (pageHeight - imgHeight) / 2;

    pdf.addImage(dataUrl, 'JPEG', xOffset, yOffset, imgWidth, imgHeight);
  }

  return pdf.output('blob');
};

// Helper: Convert Blob to Data URL
const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Helper: Load image to get dimensions
const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
};
```

#### 3. Update `handleBatchUpload` Function
Replace the current logic that uploads individual JPEGs with PDF generation:

**Before (current - lines 172-208):**
- Uploads individual JPEG files
- Creates record with `mime_type: 'image/jpeg'`
- Stores array of page paths in metadata

**After (new logic):**
```typescript
const handleBatchUpload = async () => {
  // ... existing validation ...

  setIsUploading(true);
  setUploadProgress(0);

  try {
    // Get user and tenant info (existing code)
    // ...

    setUploadProgress(10);

    // Generate combined PDF from captured pages
    const pdfBlob = await generateCombinedPDF(capturedPages);
    
    setUploadProgress(50);

    // Upload single PDF file
    const timestamp = Date.now();
    const sanitizedLabel = documentLabel.replace(/\s+/g, '_');
    const fileName = `${pipelineEntryId}/${timestamp}_${documentType}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(fileName, pdfBlob, {
        contentType: 'application/pdf',
      });

    if (uploadError) throw uploadError;

    setUploadProgress(80);

    // Create document record with PDF info
    const { error: dbError } = await supabase
      .from('documents')
      .insert({
        tenant_id: profile.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        document_type: documentType,
        filename: `${sanitizedLabel}.pdf`,
        file_path: fileName,
        file_size: pdfBlob.size,
        mime_type: 'application/pdf',  // Actual PDF now
        uploaded_by: user.id,
        metadata: {
          page_count: capturedPages.length,
          scan_timestamp: timestamp,
          generated_from: 'document_scanner',
        },
      });

    if (dbError) throw dbError;

    setUploadProgress(100);

    toast({
      title: 'PDF Created',
      description: `${capturedPages.length}-page PDF uploaded successfully.`,
    });

    // Cleanup and close
    // ... existing cleanup code ...
  } catch (error: any) {
    // ... existing error handling ...
  }
};
```

---

## Changes Summary

| Aspect | Before | After |
|--------|--------|-------|
| Storage | Multiple JPEG files | Single PDF file |
| MIME type | `image/jpeg` | `application/pdf` |
| File format | Fake `.pdf` filename | Real PDF document |
| Metadata | `all_pages` array | `page_count` only |
| Compatibility | Requires custom viewer | Standard PDF viewers |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/documents/DocumentScannerDialog.tsx` | Add jsPDF import, add PDF generation helpers, update upload handler |

---

## Benefits

1. **Real PDF Output** - Documents are actual PDFs that can be opened in any PDF viewer
2. **Single File** - One file to manage instead of multiple page images
3. **Professional Quality** - Pages properly sized for letter format (8.5" x 11")
4. **Shareable** - Can be emailed, printed, or attached to permit applications
5. **Notice of Commencement Ready** - Proper format for official documents

---

## User Flow (Unchanged)

1. User taps "Notice of Commencement" bubble → "Scan Document"
2. Camera opens → User captures pages one by one
3. User reviews thumbnails → Can remove/retake pages
4. User taps "Upload" → **Pages combined into real PDF**
5. Single PDF file uploaded to storage
6. Document record created → Requirement marked complete
