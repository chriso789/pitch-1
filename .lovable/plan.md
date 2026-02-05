# Completed Enhancements

## Scanner Fix, Template Attachments & Estimate Cover Pages ✅

**Status: COMPLETED** (February 5, 2026)

### Changes Made

1. **Company Docs PDF Validation** ✅
   - Updated `SmartDocs.tsx` to only accept PDF files
   - Added error toast for non-PDF uploads
   - Updated file input `accept` attribute

2. **Template Attachment System** ✅
   - Created `estimate_template_attachments` junction table
   - Enabled RLS with tenant-based policies
   - Database cleanup: removed incorrectly uploaded image.jpg

3. **Estimate Cover Page** ✅
   - Created `EstimateCoverPage.tsx` component
   - Added `showCoverPage` option to `PDFComponentOptions.ts`
   - Integrated cover page rendering in `EstimatePDFDocument.tsx`
   - Added "Include Cover Page" toggle to `EstimateAddonsPanel.tsx`

### Future Work (Template Attachment UI)

The database table for template attachments is ready. Next steps:
- Create `TemplateAttachmentManager.tsx` UI component
- Add attachment section to estimate template editor
- Implement PDF merge for attached documents during export
