
# Plan: Fix Spinning "Save Changes" Button

## Problem Identified

The "Save Changes" button spinner continues indefinitely even though the edge function completes successfully. The issue is in the **PDF regeneration step** that happens AFTER the edge function call.

### Root Cause Analysis

In `handleSaveLineItemChanges` (lines 1321-1461):

1. ✅ Edge function `update-estimate-line-items` completes successfully (confirmed by logs)
2. ⚠️ PDF regeneration step begins - this is where the hang occurs

The function flow is:
```text
setSavingLineItems(true) → Edge Function → PDF Generation → PDF Upload → Toast → Finally Block
                                             ↑
                                    HANGING HERE
```

**Specific Issues:**

1. **Storage Upload Timeout**: The `saveEstimatePdf` function uploads to Supabase Storage without a timeout. If the storage request hangs (network issue, CORS, bucket policy), the entire function hangs.

2. **Missing Error Boundaries**: The PDF generation and upload are wrapped in a try/catch, but if the Supabase client itself hangs on a request, the Promise never resolves or rejects.

3. **Blocking Sequential Operations**: The PDF upload and database update happen sequentially without timeouts.

---

## Solution

### Approach 1: Add Timeouts to Critical Operations

Wrap the PDF save and database update operations with Promise.race to add timeouts:

```typescript
// Create a timeout promise
const withTimeout = <T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId)) as Promise<T>;
};

// Usage in handleSaveLineItemChanges:
if (pdfBlob && editingEstimateNumber && tenantId && user?.id) {
  try {
    const result = await withTimeout(
      saveEstimatePdf({...}),
      30000, // 30 second timeout
      'PDF upload timed out'
    );
    // ...
  } catch (uploadError) {
    console.warn('PDF upload failed, continuing anyway:', uploadError);
    // Don't throw - the estimate was already saved successfully
  }
}
```

### Approach 2: Move PDF Generation to Background (Recommended)

Since the edge function already saves the estimate data successfully, make the PDF regeneration non-blocking:

```typescript
// After edge function success, show success toast immediately
toast({
  title: 'Changes Saved',
  description: 'Estimate updated successfully'
});

// Reset UI state immediately
queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
resetToOriginal();
setExistingEstimateId(null);
// ... other cleanup

// Regenerate PDF in background (fire and forget with error handling)
regeneratePDFInBackground(editingEstimateNumber, tenantId, user?.id).catch(err => {
  console.warn('Background PDF regeneration failed:', err);
});

// Finally block still resets saving state
```

### Approach 3: Immediate Fix - Ensure Finally Block Always Executes

The safest fix is to ensure `setSavingLineItems(false)` is called even if PDF operations hang:

**File:** `src/components/estimates/MultiTemplateSelector.tsx`

Restructure the try/catch/finally to guarantee spinner stops:

```typescript
const handleSaveLineItemChanges = async () => {
  if (!existingEstimateId || lineItems.length === 0) return;
  
  setSavingLineItems(true);
  let saveSucceeded = false;
  
  try {
    // Step 1: Save to database (critical)
    const { data, error } = await supabase.functions.invoke('update-estimate-line-items', {...});
    if (error) throw error;
    saveSucceeded = true;
    
    // Show success immediately after database save
    toast({
      title: 'Changes Saved',
      description: 'Estimate updated. Regenerating PDF...'
    });
    
  } catch (error) {
    console.error('Error saving line item changes:', error);
    toast({
      title: 'Error',
      description: 'Failed to save line item changes',
      variant: 'destructive'
    });
  } finally {
    // ALWAYS reset saving state immediately after database operation
    setSavingLineItems(false);
  }
  
  // If save succeeded, regenerate PDF in background (non-blocking)
  if (saveSucceeded) {
    regeneratePDFAndUpload().catch(err => {
      console.warn('PDF regeneration failed:', err);
      toast({
        title: 'PDF Update Failed',
        description: 'Estimate saved but PDF could not be updated',
        variant: 'destructive'
      });
    });
    
    // Reset UI state
    queryClient.invalidateQueries({ queryKey: ['saved-estimates', pipelineEntryId] });
    resetToOriginal();
    setExistingEstimateId(null);
    setEditingEstimateNumber(null);
    setIsEditingLoadedEstimate(false);
    setEditEstimateProcessed(false);
    setSelectedTemplateId(null);
    setLineItems([]);
  }
};
```

---

## Recommended Implementation

I recommend **Approach 3** - immediately stop the spinner after the edge function completes, then handle PDF regeneration as a non-blocking follow-up operation. This provides the best user experience because:

1. User gets immediate feedback that their changes are saved
2. PDF regeneration happens in background
3. If PDF fails, the estimate data is still saved
4. No more hanging spinners

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Restructure `handleSaveLineItemChanges` to separate database save from PDF regeneration |

---

## Technical Details

### Current Flow (Blocking)
```text
[Save Button] → setSaving(true) → EdgeFunction → PDF Generate → PDF Upload → DB Update → Toast → setSaving(false)
                     ↑___________________________|← If any step hangs, spinner hangs___|
```

### Proposed Flow (Non-Blocking PDF)
```text
[Save Button] → setSaving(true) → EdgeFunction → setSaving(false) → Toast("Saved!")
                                        ↓
                            [Background: PDF Generate → PDF Upload → DB Update]
                                        ↓ (if fails)
                            [Toast("PDF update failed")]
```

This guarantees the spinner stops immediately after the critical database operation completes.
