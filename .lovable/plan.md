
# Fix: Quote PDF Missing Attachment Pages

## Status: ✅ COMPLETED

## Problem Summary
When the "View Your Quote" link is opened, only 2 pages of the PDF are visible and the attachments are stuck in a "Loading attachments..." state.

## Solution Implemented

### Changes Made to `src/components/estimates/MultiTemplateSelector.tsx`:

1. **Added `templateAttachments` to all `setPdfData()` calls** (3 locations):
   - `handleCreateEstimate` (line ~1130)
   - `handleSaveLineItemChanges` background PDF regen (line ~1431)
   - `handleExportPDF` (line ~1721)

2. **Passed `templateAttachments` to hidden `<EstimatePDFDocument>`** (line ~2118)

3. **Implemented polling wait for attachment rendering** before PDF capture:
   - Polls every 200ms for up to 15 seconds
   - Checks for absence of `.animate-spin` loaders
   - Confirms `[data-report-page]` elements exist
   - Adds 300ms final delay for render stability

## Testing

1. Create or edit an estimate with template attachments (e.g., metal roof with 5V flyer)
2. Click "Create Estimate" or "Save Changes"
3. Verify the saved PDF includes all pages (cover, content, warranty, attachments)
4. Send quote via email and open "View Your Quote" link
5. Verify all pages load without "Loading attachments..." spinner
