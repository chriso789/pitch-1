

## Fix: Attachments Not Appearing in Shared Quote Email

### Problem Summary
When a user views their quote from the email link, the PDF doesn't include the attachments they added in the Preview Panel. The customer sees only 2-3 pages instead of the full document with attachments.

### Root Cause
The **Share** button in the Preview Panel sends the customer the **stored** PDF from the database (`pdf_url` in `enhanced_estimates`). This PDF is only updated when the estimate is **saved**, not when the user adds attachments in the preview and clicks Share.

**Current Flow:**
1. User opens Preview Panel
2. User adds attachments via "Add Document" 
3. User clicks "Share" → opens ShareEstimateDialog
4. Edge function retrieves `estimate.pdf_url` from database
5. Customer receives **old PDF** (without new attachments)

### Solution
**Regenerate and upload the PDF before sending the share email.** This ensures the customer always receives the current preview configuration including all attachments.

### Technical Changes

#### 1. Update `EstimatePreviewPanel.tsx`

**Before Share, regenerate and upload PDF:**

```typescript
// Add new props to pass regeneration info
interface EstimatePreviewPanelProps {
  // ... existing props
  tenantId?: string;  // NEW
  userId?: string;    // NEW
}
```

**Create a new function to regenerate PDF before sharing:**

```typescript
const handlePrepareAndShare = async () => {
  // 1. Generate fresh PDF with current attachments
  setIsExporting(true);
  try {
    const container = document.getElementById('estimate-preview-template');
    if (!container) throw new Error('Preview not found');
    
    // Wait for attachments to render
    // ... (same polling logic as handleExportPDF)
    
    const pageCount = container.querySelectorAll('[data-report-page]').length;
    const result = await generateMultiPagePDF('estimate-preview-template', pageCount, {
      filename: `${estimateNumber}.pdf`,
      format: 'letter',
    });
    
    if (result.success && result.blob && estimateId && tenantId && userId) {
      // 2. Upload fresh PDF to storage
      const pdfPath = `${pipelineEntryId}/estimates/${estimateNumber}.pdf`;
      await supabase.storage.from('documents').upload(pdfPath, result.blob, {
        contentType: 'application/pdf',
        upsert: true
      });
      
      // 3. Update pdf_url in database
      await supabase.from('enhanced_estimates')
        .update({ pdf_url: pdfPath })
        .eq('id', estimateId);
        
      console.log('[Share] PDF regenerated with attachments before sharing');
    }
  } catch (err) {
    console.error('PDF regeneration failed:', err);
    // Continue with share anyway - will use existing PDF
  } finally {
    setIsExporting(false);
  }
  
  // 4. Open share dialog
  setShowShareDialog(true);
};
```

**Update Share button to use new handler:**

```tsx
<Button
  variant="outline"
  onClick={handlePrepareAndShare}  // Changed from () => setShowShareDialog(true)
  disabled={isExporting || isGeneratingPDF || !(estimateId || pipelineEntryId)}
  className="flex-1"
>
  {isExporting ? (
    <>
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      Preparing...
    </>
  ) : (
    <>
      <Share2 className="h-4 w-4 mr-2" />
      Share
    </>
  )}
</Button>
```

#### 2. Update `MultiTemplateSelector.tsx`

Pass `tenantId` and `userId` to the EstimatePreviewPanel:

```tsx
<EstimatePreviewPanel
  // ... existing props
  tenantId={tenantId}
  userId={userId}
/>
```

#### 3. Add Import Statement

In `EstimatePreviewPanel.tsx`:
```typescript
import { supabase } from '@/integrations/supabase/client';
```

### User Flow After Fix

1. User opens Preview Panel
2. User adds attachments
3. User clicks "Share" → shows "Preparing..." spinner
4. System regenerates PDF with all current attachments
5. System uploads fresh PDF to storage
6. System updates `pdf_url` in database
7. ShareEstimateDialog opens
8. User sends email
9. Customer receives email and clicks link
10. **Customer sees full PDF with all attachments**

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add `tenantId`/`userId` props, create `handlePrepareAndShare()` function, update Share button |
| `src/components/estimates/MultiTemplateSelector.tsx` | Pass `tenantId` and `userId` to EstimatePreviewPanel |

### Benefits
- Attachments always appear in shared quotes
- No extra user action required (auto-regenerates on share)
- Existing Export PDF functionality unchanged
- Same PDF generation logic reused (consistent quality)

