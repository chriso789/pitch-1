
## Fix: Reduce Quote PDF File Sizes

### Problem
Your quote PDFs are coming out at **27+ MB** - too large for email (Gmail limit is 25MB). The screenshot shows Gmail blocking the attachments.

### Root Cause Analysis
The PDF generation pipeline has these issues:

| Stage | Current Setting | Problem |
|-------|-----------------|---------|
| Attachment page rendering | `scale: 1.5`, JPEG 0.85 | Reasonable |
| html2canvas capture | `scale: 2` for ALL pages | Too high for attachments |
| Attachment JPEG export | Quality 0.85 | Could be lower |

**Key insight**: Attachment pages are already compressed images. Capturing them through html2canvas at `scale: 2` and JPEG 0.85 doubles the work and inflates file size without quality benefit.

### Solution
Implement **adaptive compression** based on page type:

| Page Type | html2canvas Scale | Export Format | Quality | Target Size |
|-----------|-------------------|---------------|---------|-------------|
| Text content (estimate) | 2.0 | PNG | N/A | ~200KB/page |
| Attachment pages | 1.0 | JPEG | 0.65 | ~150KB/page |

### Technical Changes

#### File: `src/hooks/useMultiPagePDFGeneration.ts`

**1. Detect attachment pages BEFORE capture (around line 134)**
```typescript
const pageElement = pageElements[i] as HTMLElement;

// Detect if this is an attachment page (image-only content)
const isAttachmentPage = pageElement.querySelector('img[style*="object-fit"]') !== null;

// Use lower scale for attachment pages (already images, don't need double resolution)
const captureScale = isAttachmentPage ? 1.0 : 2.0;
```

**2. Update html2canvas call (line 156)**
```typescript
const canvas = await html2canvas(pageElement, {
  scale: captureScale, // Dynamic: 1.0 for attachments, 2.0 for text
  useCORS: true,
  allowTaint: true,
  backgroundColor: '#ffffff',
  logging: false,
  imageTimeout: 5000,
  onclone: (_clonedDoc, clonedElement) => {
    applyPDFStyles(clonedElement);
  },
});
```

**3. Lower JPEG quality for attachments (line 187)**
```typescript
// Use JPEG at 0.65 quality for attachments (aggressive compression)
// This provides significant file size reduction with acceptable visual quality
const imageData = isAttachmentPage
  ? canvas.toDataURL('image/jpeg', 0.65)  // Changed from 0.85
  : canvas.toDataURL('image/png');
```

#### File: `src/lib/pdfRenderer.ts` (Optional - further optimization)

**4. Also reduce initial attachment render quality (line 121 in AttachmentPagesRenderer)**
```typescript
// Render at 1.0 scale instead of 1.5, quality 0.70 instead of 0.85
const rendered = await renderPageToDataUrl(pdf, pageNum, 1.0, att.document_id, true, 0.70);
```

### Expected Results

| Before | After | Reduction |
|--------|-------|-----------|
| ~27MB per quote | ~3-5MB per quote | **80-85%** |
| Gmail blocked | Email delivers | ✅ |

**Why this works:**
- Attachment pages are mostly images of product brochures
- Human eyes can't distinguish JPEG 0.65 from 0.85 at normal viewing distance
- Reducing scale from 2.0 to 1.0 cuts pixel count by 75%
- Combined effect: (1/4 pixels) × (lower quality) = massive size reduction

### Visual Quality Comparison (for reference)

```text
JPEG Quality Settings:
- 0.95 = Archival quality, nearly lossless
- 0.85 = High quality (current) - professional photos
- 0.70 = Good quality - web images
- 0.65 = Acceptable quality (proposed) - document attachments
- 0.50 = Noticeable artifacts
```

For product flyers viewed on screen or printed once, 0.65 quality is absolutely acceptable and customers won't notice the difference.

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useMultiPagePDFGeneration.ts` | Adaptive scale (1.0 vs 2.0), lower JPEG quality (0.65) |
| `src/components/estimates/AttachmentPagesRenderer.tsx` | Optional: reduce initial render scale to 1.0 |
