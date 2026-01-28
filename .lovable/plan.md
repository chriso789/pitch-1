

# Fix: Share Button Downloads Updated PDF After Editing

## Problem

After editing an estimate and clicking "Save Changes", the Share/Export button (ExternalLink icon) downloads the OLD PDF showing $19,631.09 instead of the updated estimate showing $17,972.

---

## Root Cause

The `handleSaveLineItemChanges` function in `MultiTemplateSelector.tsx` only updates the database via the edge function. It does NOT regenerate the PDF.

| Function | Database Update | PDF Generation | PDF Upload |
|----------|-----------------|----------------|------------|
| `handleCreateEstimate` | Yes | Yes | Yes |
| `handleSaveLineItemChanges` | Yes | **NO** | **NO** |

When clicking the share button, `handleViewPDF` in `SavedEstimatesList.tsx` retrieves the stale PDF from storage using the `pdf_url` field.

---

## Solution

Add PDF regeneration and upload to `handleSaveLineItemChanges` after the database update succeeds.

### Code Changes

**File: `src/components/estimates/MultiTemplateSelector.tsx`**

Update the `handleSaveLineItemChanges` function (lines 1058-1127) to:

1. Update the database via edge function (existing)
2. Prepare PDF data with current line items and breakdown
3. Show the PDF template component for capture
4. Generate PDF from the `estimate-pdf-pages` element
5. Upload the new PDF to storage (replaces old file via upsert)
6. Update the `pdf_url` in the database if it changed
7. Hide PDF template and reset state

```typescript
const handleSaveLineItemChanges = async () => {
  if (!existingEstimateId || lineItems.length === 0) return;
  
  setSavingLineItems(true);
  try {
    // 1. Build line items JSON
    const lineItemsJson = {
      materials: materialItems.map(item => ({ /* ... */ })),
      labor: laborItems.map(item => ({ /* ... */ })),
    };

    // 2. Update database via edge function (existing code)
    const { data, error } = await supabase.functions.invoke('update-estimate-line-items', {
      body: {
        estimate_id: existingEstimateId,
        line_items: lineItemsJson,
        selling_price: breakdown.sellingPrice,
        pricing_config: config
      }
    });

    if (error) throw error;

    // 3. Get tenant info for PDF upload
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', user?.id)
      .single();
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;

    // 4. Prepare PDF data and show template for capture
    setPdfData({
      estimateNumber: editingEstimateNumber,
      customerName: customerInfo?.name,
      customerAddress: customerInfo?.address,
      companyInfo,
      companyLocations,
      materialItems,
      laborItems,
      breakdown,
      config,
      finePrintContent,
      options: pdfOptions,
    });
    setShowPDFTemplate(true);

    // 5. Wait for render
    await new Promise(resolve => setTimeout(resolve, 500));

    // 6. Generate PDF
    let pdfBlob: Blob | null = null;
    try {
      const pdfResult = await generateMultiPagePDF('estimate-pdf-pages', 1, {
        filename: `${editingEstimateNumber}.pdf`,
        format: 'letter',
        orientation: 'portrait',
      });
      
      if (pdfResult.success && pdfResult.blob) {
        pdfBlob = pdfResult.blob;
      }
    } catch (pdfError) {
      console.error('PDF regeneration failed:', pdfError);
    }

    // 7. Hide PDF template
    setShowPDFTemplate(false);
    setPdfData(null);

    // 8. Upload new PDF to storage
    if (pdfBlob && editingEstimateNumber && tenantId) {
      const result = await saveEstimatePdf({
        pdfBlob,
        pipelineEntryId,
        tenantId,
        estimateNumber: editingEstimateNumber,
        description: `Updated estimate ${editingEstimateNumber}`,
        userId: user?.id || '',
      });
      
      if (result.success) {
        // Update pdf_url in database
        await supabaseClient
          .from('enhanced_estimates')
          .update({ pdf_url: result.filePath })
          .eq('id', existingEstimateId);
      }
    }

    toast({
      title: 'Changes Saved',
      description: 'Estimate and PDF updated successfully'
    });

    // 9. Invalidate queries and reset state (existing code)
    queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
    resetToOriginal();
    setExistingEstimateId(null);
    setEditingEstimateNumber(null);
    setIsEditingLoadedEstimate(false);
    setSelectedTemplateId(null);
    setLineItems([]);
    
  } catch (error) {
    console.error('Error saving line item changes:', error);
    setShowPDFTemplate(false);
    setPdfData(null);
    toast({
      title: 'Error',
      description: 'Failed to save line item changes',
      variant: 'destructive'
    });
  } finally {
    setSavingLineItems(false);
  }
};
```

---

## Data Flow After Fix

```text
User edits estimate line items
        ↓
Clicks "Save Changes"
        ↓
Edge function updates database with new values
        ↓
PDF data prepared with updated breakdown ← NEW
        ↓
PDF template rendered for capture        ← NEW
        ↓
PDF generated from updated component     ← NEW
        ↓
PDF uploaded to storage (replaces old)   ← NEW
        ↓
pdf_url updated in database              ← NEW
        ↓
Share button retrieves UPDATED PDF       ← FIXED
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Add PDF regeneration and upload to `handleSaveLineItemChanges` function after database update |

---

## Expected Result

**Before:**
- Edit estimate price from $19,631 to $17,972
- Click "Save Changes" → Database shows $17,972
- Click Share button → Downloads PDF showing $19,631

**After:**
- Edit estimate price from $19,631 to $17,972
- Click "Save Changes" → Database updated, new PDF generated
- Click Share button → Downloads PDF showing $17,972

---

## Technical Notes

- Uses existing `generateMultiPagePDF` and `saveEstimatePdf` utilities
- `saveEstimatePdf` uses `upsert: true` so it automatically replaces the old PDF file
- The PDF template component is briefly shown (can be hidden off-screen) for html2canvas capture
- If PDF generation fails, the database update still succeeds - error is logged but not blocking

