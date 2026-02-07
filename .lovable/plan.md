
# Implementation: Fix Share Link PDF + Add Master Phone Number

## Summary
Two issues need to be fixed:
1. **Master user has no phone** → SMS notifications for quote views aren't being sent
2. **PDF 404 error on share links** → Using `getPublicUrl()` on a private storage bucket fails

---

## Changes to Implement

### 1. Update Master's Phone Number (Database)
**Direct database update:**
```sql
UPDATE profiles 
SET phone = '+17708420812' 
WHERE id = '0a56229d-1722-4ea0-90ec-c42fdac6fcc9';
```

This enables SMS notifications when quotes are viewed.

---

### 2. Fix PDF URL Generation (Edge Function)
**File:** `supabase/functions/track-quote-view/index.ts`

**Problem:** Line 141-143 uses `getPublicUrl()` which doesn't work for private buckets.

**Solution:** Replace with `createSignedUrl()` that generates temporary access URLs.

**Change (lines 126-165):**
- Add a helper function `resolvePdfUrl()` that:
  - Returns `null` if input is empty
  - Returns the URL unchanged if it already starts with `http://` or `https://`
  - Creates a 6-hour signed URL if it's a storage path
- Apply this helper to both `trackingLink.pdf_url` and the fallback `enhanced_estimates.pdf_url`

```typescript
// Helper to resolve PDF URL - handles private bucket with signed URLs
async function resolvePdfUrl(pdfValue: string | null | undefined): Promise<string | null> {
  if (!pdfValue) return null;
  
  // If it's already a full URL, return as-is
  if (pdfValue.startsWith('http://') || pdfValue.startsWith('https://')) {
    return pdfValue;
  }
  
  // Otherwise, treat as a storage path and create a signed URL
  try {
    const { data: signedData, error: signedError } = await supabase.storage
      .from('documents')
      .createSignedUrl(pdfValue, 60 * 60 * 6); // 6 hours expiry
    
    if (signedError) {
      console.error("[track-quote-view] Failed to create signed URL:", signedError);
      return null;
    }
    
    console.log("[track-quote-view] Created signed URL for path:", pdfValue);
    return signedData?.signedUrl || null;
  } catch (err) {
    console.error("[track-quote-view] Error creating signed URL:", err);
    return null;
  }
}

// Use the helper for both possible PDF sources
let pdfUrl = await resolvePdfUrl(trackingLink.pdf_url);
if (!pdfUrl && trackingLink.enhanced_estimates?.pdf_url) {
  pdfUrl = await resolvePdfUrl(trackingLink.enhanced_estimates.pdf_url);
}
```

---

### 3. Improve ViewQuote Page Resilience
**File:** `src/pages/ViewQuote.tsx`

**Changes:**
- Remove unused `isMobileDevice` import
- Add `AlertCircle` icon import
- When no PDF URL is available, show a user-friendly message with contact options instead of a generic placeholder

**Before:**
```tsx
<FileText className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
<p className="text-muted-foreground">Quote document will be displayed here.</p>
```

**After:**
```tsx
<AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
<h3 className="text-lg font-semibold mb-2">Document Unavailable</h3>
<p className="text-muted-foreground mb-4">
  We couldn't load the quote document at this time. Please contact us for assistance.
</p>
<div className="flex justify-center gap-3">
  <Button variant="outline" size="sm">
    <Phone className="w-4 h-4 mr-2" />
    Call Us
  </Button>
  <Button variant="outline" size="sm">
    <Mail className="w-4 h-4 mr-2" />
    Email Us
  </Button>
</div>
```

---

## Files Changed

| File | Change |
|------|--------|
| Database | Set Master's phone to `+17708420812` |
| `supabase/functions/track-quote-view/index.ts` | Replace `getPublicUrl()` with `createSignedUrl()` |
| `src/pages/ViewQuote.tsx` | Better fallback UI when PDF unavailable |

---

## Expected Results After Implementation

1. **SMS notifications work** - When someone views a quote, Master receives an SMS at 770-842-0812
2. **PDFs load correctly** - Share links now show the PDF document (signed URLs valid for 6 hours)
3. **Better error handling** - If PDF is unavailable, customers see a helpful message with contact options

---

## Testing Plan

1. Verify Master's phone is set in database
2. Send a new quote email (creates tracking link)
3. Open the link in incognito:
   - PDF should load and display
   - Download button should work
4. Check SMS received at 770-842-0812 with view notification
