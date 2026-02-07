
# Optimize PDF Export File Size

## Problem Analysis

Your 52.6MB PDF is caused by a "double-rasterization" problem:

1. **Attached PDFs** (like the 7.6MB "OC Metal Roof Flyer.pdf") get converted to **high-resolution PNG images** for preview
2. During export, these **already-large PNGs get captured again** at full resolution
3. **PNG format** is used everywhere — great for text, but bloated for photos/graphics

**Result**: A 7MB marketing PDF → 15-20MB PNG → captured again → even bigger

---

## Solution Strategy

Implement **smart compression** that maintains quality for text while drastically reducing size for image-heavy content:

### Change 1: Use JPEG for Attachment Pages (Major Impact)
Convert attachment page captures from PNG to optimized JPEG:
- **Before**: `canvas.toDataURL("image/png")` → ~3-5MB per page
- **After**: `canvas.toDataURL("image/jpeg", 0.85)` → ~200-400KB per page

This alone could reduce a 50MB PDF to under 10MB.

### Change 2: Use JPEG for Final PDF Images (Balanced Approach)
For the final jsPDF output, use JPEG compression for attachment-heavy pages:
- Keep text-primary pages as PNG for clarity
- Use JPEG for graphical pages (attachments)
- Target quality: 0.85-0.92 (excellent visual quality, much smaller)

### Change 3: Reduce Attachment Render Scale
Currently rendering at 2x scale which is overkill for attached PDFs:
- Reduce from `scale: 2` to `scale: 1.5` for attachments
- Estimated 44% reduction in pixel count

### Change 4: Add Smart Format Detection
Automatically choose compression based on content type:
- Text pages (estimates, cover) → PNG for sharp text
- Image-heavy pages (flyers, photos) → JPEG for small size

---

## Technical Implementation

### File: `src/lib/pdfRenderer.ts`

Update `renderPageToDataUrl` to use JPEG with configurable quality:

```typescript
export async function renderPageToDataUrl(
  pdf: PDFDocumentProxy,
  pageNum: number,
  scale: number = 1.5,  // Reduced from 2
  pdfId?: string,
  useJpeg: boolean = true,  // NEW: default to JPEG
  quality: number = 0.85    // NEW: compression quality
): Promise<RenderedPage> {
  // ... existing code ...
  
  // Use JPEG for smaller files (attachments are image-heavy)
  const format = useJpeg ? 'image/jpeg' : 'image/png';
  const dataUrl = useJpeg 
    ? canvas.toDataURL(format, quality)
    : canvas.toDataURL('image/png');
  
  // ... rest of function
}
```

### File: `src/components/estimates/AttachmentPagesRenderer.tsx`

Update the render call to use JPEG:

```typescript
// Line 120 - Use JPEG and lower scale for attachments
const rendered = await renderPageToDataUrl(
  pdf, 
  pageNum, 
  1.5,              // Reduced scale
  att.document_id,
  true,             // Use JPEG
  0.85              // Quality
);
```

### File: `src/hooks/useMultiPagePDFGeneration.ts`

Use JPEG for final PDF image embedding:

```typescript
// Detect if this is an attachment page (contains full-bleed image)
const isAttachmentPage = pageElement.querySelector('img[style*="object-fit: contain"]');

// Use JPEG for image-heavy pages, PNG for text
const imageFormat = isAttachmentPage ? 'image/jpeg' : 'image/png';
const imageQuality = isAttachmentPage ? 0.85 : undefined;

const imageData = isAttachmentPage
  ? canvas.toDataURL('image/jpeg', 0.85)
  : canvas.toDataURL('image/png');

pdf.addImage(
  imageData,
  isAttachmentPage ? 'JPEG' : 'PNG',
  xOffset, yOffset, imgWidth, imgHeight
);
```

---

## Expected Size Reduction

| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| Marketing PDF (10 pages) | ~25MB | ~4MB | 84% |
| Estimate pages (3 pages) | ~8MB | ~8MB (PNG) | 0% |
| Cover page | ~3MB | ~3MB (PNG) | 0% |
| Warranty PDF (2 pages) | ~6MB | ~1MB | 83% |
| **Total** | **~52MB** | **~16MB** | **70%** |

With these changes, most estimates should stay **under 15MB** (email-safe) while maintaining:
- ✅ Sharp, crisp text on estimate pages
- ✅ Professional-looking cover page
- ✅ Good quality attached marketing materials
- ✅ Full data integrity (all content preserved)

---

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/pdfRenderer.ts` | Add JPEG option, reduce default scale to 1.5 |
| `src/components/estimates/AttachmentPagesRenderer.tsx` | Use JPEG with 0.85 quality |
| `src/hooks/useMultiPagePDFGeneration.ts` | Smart format detection per page |

---

## Quality Comparison

**JPEG at 0.85 quality**:
- Visually indistinguishable from PNG on marketing materials
- Photos and gradients compress extremely well
- Minor artifacts only visible at extreme zoom (not printed)

**Text pages stay PNG**:
- Sharp edges on all text and numbers
- No compression artifacts on line items
- Professional appearance maintained
