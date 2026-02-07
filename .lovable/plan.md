
# Fix: Slow PDF Export Performance

## Problem Summary

The PDF export is very slow due to multiple issues that compound:
1. Attachment files are re-downloaded repeatedly during export
2. The `allAttachments` array is recreated on every render, triggering re-fetches
3. Each page is rendered at 3x scale (very expensive)
4. Multiple built-in delays add up

## Console Log Evidence

From the logs, the same attachments are downloaded **4+ times**:
```
[AttachmentPagesRenderer] Downloaded: License and Warranty - Marketing.pdf size: 2478652
[AttachmentPagesRenderer] Downloaded: License and Warranty - Marketing.pdf size: 2478652  
[AttachmentPagesRenderer] Downloaded: License and Warranty - Marketing.pdf size: 2478652
[AttachmentPagesRenderer] Downloaded: OC Metal Roof Flyer.pdf size: 7641930
```

This happens because the component remounts multiple times during the capture process.

---

## Technical Fixes

### Fix 1: Memoize `allAttachments` Array

**File**: `src/components/estimates/EstimatePreviewPanel.tsx`

**Line 161** - Currently creates new array every render:
```typescript
// BEFORE (creates new array every render, triggers re-fetch)
const allAttachments = [...activeTemplateAttachments, ...additionalAttachments];

// AFTER (stable reference, only recalculates when dependencies change)
const allAttachments = useMemo(
  () => [...activeTemplateAttachments, ...additionalAttachments],
  [activeTemplateAttachments, additionalAttachments]
);
```

This prevents `AttachmentPagesRenderer` from unnecessarily re-running its `useEffect` and re-downloading files.

---

### Fix 2: Add Download Cache to AttachmentPagesRenderer

**File**: `src/components/estimates/AttachmentPagesRenderer.tsx`

Create a module-level cache for downloaded PDF ArrayBuffers to prevent re-downloading the same file:

```typescript
// At top of file, after imports
// Cache for downloaded PDF ArrayBuffers (persists across re-renders)
const downloadCache = new Map<string, ArrayBuffer>();

export function AttachmentPagesRenderer({ attachments }: AttachmentPagesRendererProps) {
  // ... existing code ...

  async function loadAllAttachmentPages() {
    // ...
    for (const att of attachments) {
      try {
        // Check cache first
        const cacheKey = `${att.document_id}:${att.file_path}`;
        let arrayBuffer = downloadCache.get(cacheKey);
        
        if (!arrayBuffer) {
          // Download only if not cached
          console.log('[AttachmentPagesRenderer] Downloading:', att.filename);
          const { data: blob, error } = await supabase.storage
            .from(bucket)
            .download(att.file_path);
          
          if (error || !blob) {
            loadErrors.push(`Failed to fetch ${att.filename}`);
            continue;
          }
          
          arrayBuffer = await blob.arrayBuffer();
          downloadCache.set(cacheKey, arrayBuffer);
        } else {
          console.log('[AttachmentPagesRenderer] Using cached:', att.filename);
        }
        
        // Continue with PDF processing...
      }
    }
  }
  // ...
}
```

---

### Fix 3: Reduce PDF Capture Scale

**File**: `src/hooks/useMultiPagePDFGeneration.ts`

**Line 157** - Reduce from 3x to 2x for faster generation while still maintaining quality:

```typescript
// BEFORE (3x = 2448x3168 per page, very slow)
scale: 3,

// AFTER (2x = 1632x2112 per page, much faster, still good quality)
scale: 2,
```

---

### Fix 4: Reduce Font/Render Delays

**File**: `src/hooks/useMultiPagePDFGeneration.ts`

The current hook has:
- 150ms font delay (line 48 in waitForFonts)
- 300ms render delay in the preview handler

These can be reduced:

**Line 48** (in waitForFonts):
```typescript
// BEFORE
await new Promise(resolve => setTimeout(resolve, 150));

// AFTER - 50ms is usually sufficient
await new Promise(resolve => setTimeout(resolve, 50));
```

**File**: `src/components/estimates/EstimatePreviewPanel.tsx`

**Line 248** (in handleExportPDF):
```typescript
// BEFORE
await new Promise(resolve => setTimeout(resolve, 300));

// AFTER - 100ms is usually sufficient
await new Promise(resolve => setTimeout(resolve, 100));
```

---

## Summary of Changes

| File | Change | Impact |
|------|--------|--------|
| `EstimatePreviewPanel.tsx` | Memoize `allAttachments` | Prevents unnecessary re-renders |
| `EstimatePreviewPanel.tsx` | Reduce post-poll delay 300→100ms | Saves 200ms |
| `AttachmentPagesRenderer.tsx` | Add ArrayBuffer download cache | Prevents 4x+ duplicate downloads |
| `useMultiPagePDFGeneration.ts` | Reduce scale 3→2 | ~50% faster canvas capture |
| `useMultiPagePDFGeneration.ts` | Reduce font delay 150→50ms | Saves 100ms |

---

## Expected Performance Improvement

| Metric | Before | After |
|--------|--------|-------|
| Attachment downloads | 4+ per file | 1 per file (cached) |
| Canvas pixels per page | 7.8M (3x) | 3.4M (2x) |
| Fixed delays | 450ms | 150ms |
| Estimated export time | 15-30 seconds | 5-10 seconds |

---

## Files to Modify

1. `src/components/estimates/EstimatePreviewPanel.tsx`
   - Memoize `allAttachments` array
   - Reduce post-poll delay

2. `src/components/estimates/AttachmentPagesRenderer.tsx`
   - Add module-level download cache

3. `src/hooks/useMultiPagePDFGeneration.ts`
   - Reduce scale from 3 to 2
   - Reduce font delay
