
# Fix: "Cannot perform Construct on a detached ArrayBuffer" Error

## Problem

When loading PDF attachments, the error appears:
```
TypeError: Cannot perform Construct on a detached ArrayBuffer
```

This happens because:
1. We added a download cache to prevent re-downloading the same PDF files
2. When PDF.js processes an ArrayBuffer, it **transfers ownership** of the buffer
3. The original ArrayBuffer becomes "detached" (unusable) after PDF.js consumes it
4. When the component re-renders and tries to reuse the cached ArrayBuffer, it fails

## Root Cause

In `AttachmentPagesRenderer.tsx` line 110:
```typescript
const pdf = await loadPDFFromArrayBuffer(arrayBuffer);  // ← This detaches the buffer!
```

The ArrayBuffer from cache is passed directly to PDF.js. After the first use, the cached buffer becomes detached and cannot be used again.

## Solution

**Clone the ArrayBuffer before passing it to PDF.js** using `.slice()`. This creates a fresh copy that PDF.js can consume while keeping the original cached buffer intact.

### File: `src/components/estimates/AttachmentPagesRenderer.tsx`

**Line 109-110** - Add `.slice()` to clone the buffer:
```typescript
// BEFORE (passes original, which gets detached)
const pdf = await loadPDFFromArrayBuffer(arrayBuffer);

// AFTER (passes a clone, original stays intact in cache)
const pdf = await loadPDFFromArrayBuffer(arrayBuffer.slice(0));
```

The `.slice(0)` method creates a complete copy of the ArrayBuffer, allowing:
- The cache to retain the original undisturbed
- PDF.js to consume its own copy without affecting future uses

---

## Technical Details

| Aspect | Before | After |
|--------|--------|-------|
| Buffer passed to PDF.js | Original (cached) | Clone via `.slice(0)` |
| Cached buffer after use | Detached (broken) | Intact (reusable) |
| Memory impact | Minimal (one buffer) | Slightly higher (temp clone) |
| Re-render behavior | Crashes | Works correctly |

---

## Why This Happens

ArrayBuffers are "transferable" objects in JavaScript. When you pass an ArrayBuffer to certain APIs (like PDF.js workers), ownership can be transferred and the original becomes empty/detached. This is by design for performance reasons in worker-based APIs.

---

## Files to Modify

1. **`src/components/estimates/AttachmentPagesRenderer.tsx`** (1 line change)
   - Line 110: Add `.slice(0)` when passing ArrayBuffer to `loadPDFFromArrayBuffer()`

---

## Expected Result

- "License and Warranty - Marketing.pdf" and all other attachments load correctly
- No "Cannot perform Construct on a detached ArrayBuffer" errors
- Cache continues to prevent duplicate downloads
- Fast re-renders work properly
