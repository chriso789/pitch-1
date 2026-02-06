
# Plan: Fix Estimate Preview Sidebar - Scroll & Delete Functionality

## ✅ COMPLETED

### Changes Made

1. **Fixed Sidebar Scrolling**
   - Added `overflow-hidden` to the sidebar container
   - Moved padding inside an inner `<div>` wrapper within `ScrollArea`
   - Now all menu items (Terms & Conditions, Custom Fine Print, Signature Block) are reachable via scrolling

2. **Enabled Template Attachment Deletion**
   - Added `removedTemplateIds` state to track hidden template attachments
   - Created `activeTemplateAttachments` computed value filtering out removed ones
   - Updated `handleRemoveAttachment` to support both template and additional attachments
   - Template attachments now show "Attachment Removed" toast instead of blocking

3. **Reset Defaults Restores Attachments**
   - Updated `handleResetToDefaults` to also clear `removedTemplateIds`
   - Clicking "Reset Defaults" now restores any hidden template attachments

### Files Modified

| File | Changes |
|------|---------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Added `useMemo` import, `removedTemplateIds` state, `activeTemplateAttachments` filtering, updated handlers, fixed scroll container layout |
