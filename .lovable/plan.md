
# Render Marketing PDF Pages in Estimate Preview

## Problem

When previewing a metal estimate, the marketing flyer (e.g., "obc_-_metal_roof_flyer.pdf") shows only as an indicator in the sidebar. The user wants to see the **actual PDF pages rendered visually** in the preview, not just a notification that they'll be appended.

## Solution Overview

Use the existing `pdfRenderer.ts` utilities (`loadPDFFromArrayBuffer` and `renderPageToDataUrl`) to fetch the attachment PDFs, render each page to an image, and display them as additional pages in the `EstimatePDFDocument` preview.

## Technical Implementation

### 1. Create Attachment Pages Component

**New File:** `src/components/estimates/AttachmentPagesRenderer.tsx`

A component that:
1. Takes an array of `templateAttachments` (with file paths)
2. Fetches each PDF from Supabase Storage
3. Uses `loadPDFFromArrayBuffer` + `renderPageToDataUrl` to convert pages to images
4. Renders them as letter-sized page divs matching the estimate format

```typescript
// Simplified structure:
interface AttachmentPagesRendererProps {
  attachments: Array<{ file_path: string; filename: string }>;
}

export function AttachmentPagesRenderer({ attachments }: Props) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function loadAllAttachmentPages() {
      for (const att of attachments) {
        // 1. Fetch PDF from storage
        const { data } = await supabase.storage.from('company-docs').download(att.file_path);
        const arrayBuffer = await data.arrayBuffer();
        
        // 2. Load with PDF.js
        const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
        
        // 3. Render each page
        for (let i = 1; i <= pdf.numPages; i++) {
          const rendered = await renderPageToDataUrl(pdf, i, 2);
          pages.push(rendered);
        }
      }
      setPages(pages);
    }
    loadAllAttachmentPages();
  }, [attachments]);
  
  // Render each page as an 816x1056 div with the image
  return pages.map((page, idx) => (
    <div 
      data-report-page
      key={`attachment-${idx}`}
      style={{ width: 816, height: 1056, background: 'white' }}
    >
      <img src={page.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  ));
}
```

### 2. Integrate into EstimatePDFDocument

**File:** `src/components/estimates/EstimatePDFDocument.tsx`

Add attachment pages after the main estimate content:

```typescript
interface EstimatePDFDocumentProps {
  // ... existing props
  templateAttachments?: Array<{ file_path: string; filename: string }>;
}

// In the pages array building logic:
if (templateAttachments && templateAttachments.length > 0) {
  pageList.push(
    <AttachmentPagesRenderer 
      key="attachments"
      attachments={templateAttachments}
    />
  );
}
```

### 3. Pass Attachments Through Preview Chain

**File:** `src/components/estimates/EstimatePreviewPanel.tsx`

Pass `templateAttachments` to the `EstimatePDFDocument`:

```typescript
<EstimatePDFDocument
  // ... existing props
  templateAttachments={templateAttachments}
/>
```

## Data Flow

```text
MultiTemplateSelector
  └── fetchTemplateAttachments() → state: templateAttachments[]
       │
       └── EstimatePreviewPanel (prop: templateAttachments)
            │
            └── EstimatePDFDocument (prop: templateAttachments)
                 │
                 └── AttachmentPagesRenderer
                      ├── Fetch PDF from Storage
                      ├── Load with pdfjs-dist
                      ├── Render pages to data URLs
                      └── Display as <img> in page containers
```

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| PDF fetch fails | Log error, skip attachment, show remaining pages |
| PDF has multiple pages | Render ALL pages as individual preview pages |
| Loading state | Show spinner placeholder until pages are rendered |
| No attachments | Component renders nothing (no change) |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/AttachmentPagesRenderer.tsx` | **NEW** - Component to fetch/render PDF pages |
| `src/components/estimates/EstimatePDFDocument.tsx` | Add `templateAttachments` prop, integrate `AttachmentPagesRenderer` |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Pass `templateAttachments` to `EstimatePDFDocument` |

## Result After Implementation

1. Metal estimate preview shows the cover page (if enabled)
2. Shows estimate content pages with materials/labor
3. Shows warranty page (if enabled)
4. **Shows actual marketing flyer pages rendered as images**
5. Page count in footer reflects total including attachments
6. Export PDF continues to work (merges real PDFs, not images)

