
# Plan: Fix Document Scanner - Multi-Page Scanning for Mobile

## Problem Summary
The "Scan with Camera" button in the Approval Requirements section is **not working properly** on mobile. The current implementation:
1. Uses a simple file input with `capture="environment"` which only captures ONE image at a time
2. Immediately uploads after capture - no way to scan multiple pages of a document
3. Users need to scan multi-page contracts, notices, etc. but can only do one page at a time

## Solution Overview
Create a **Document Scanner Dialog** that:
- Opens the camera for sequential multi-page document capture
- Shows a live camera feed with capture button
- Allows users to scan as many pages as needed
- Shows thumbnails of scanned pages with ability to remove/reorder
- Uploads all pages as a single batch when complete

---

## Part 1: Create DocumentScannerDialog Component

### New File: `src/components/documents/DocumentScannerDialog.tsx`

A full-screen mobile-friendly dialog with:
- Live camera preview using `navigator.mediaDevices.getUserMedia()`
- "Capture" button to take a photo of each page
- Thumbnails strip showing all captured pages
- "Add Page" and "Done" buttons
- Progress indicator during batch upload

**Key Features:**
- Uses WebRTC camera access like `CanvassPhotoCapture.tsx` does (proven pattern in codebase)
- Maintains a `capturedPages: string[]` array for previews
- Allows removal of individual pages before upload
- Batch uploads all pages with sequential naming
- Supports offline mode with IndexedDB fallback

### Component Structure
```text
+----------------------------------+
|  📄 Scan Document               X|
|  Contract • 3 pages              |
+----------------------------------+
|                                  |
|   [CAMERA LIVE PREVIEW]          |
|                                  |
|                                  |
|                                  |
|                                  |
+----------------------------------+
| [📷 1] [📷 2] [📷 3] [+]         |  <- Thumbnails strip
+----------------------------------+
|  [Cancel]         [Upload (3)]   |
+----------------------------------+
```

---

## Part 2: Update ApprovalRequirementsBubbles

### File: `src/components/ApprovalRequirementsBubbles.tsx`

**Changes:**
1. Add state for document scanner dialog: `const [scannerOpen, setScannerOpen] = useState(false)`
2. Add state for current scanning document type: `const [scanningDocType, setScanningDocType] = useState<string | null>(null)`
3. Replace `cameraInputRef.current?.click()` with dialog open:
   ```typescript
   onClick={() => {
     setScanningDocType('contract');
     setScannerOpen(true);
   }}
   ```
4. Add the `DocumentScannerDialog` component with callbacks
5. Handle upload completion to mark requirement as satisfied

### Lines to Modify:
- Line 516: Change camera button onClick to open scanner dialog
- Line 607: Change generic camera button to open scanner dialog
- Add dialog component at end of JSX (before hidden inputs)
- Remove hidden camera inputs (lines 761-768, 783-796) - no longer needed

---

## Part 3: Multi-Page Upload Handler

### New function in DocumentScannerDialog: `handleBatchUpload`

```typescript
async function handleBatchUpload(pages: Blob[], documentType: string) {
  // 1. Get user profile and tenant
  const { data: { user } } = await supabase.auth.getUser();
  
  // 2. For each page, upload to storage
  for (let i = 0; i < pages.length; i++) {
    const fileName = `${pipelineEntryId}/${Date.now()}_${documentType}_page${i + 1}.jpg`;
    await supabase.storage.from('documents').upload(fileName, pages[i]);
  }
  
  // 3. Create single document record with page count metadata
  await supabase.from('documents').insert({
    tenant_id,
    pipeline_entry_id: pipelineEntryId,
    document_type: documentType,
    filename: `${documentType}_${pages.length}_pages.pdf`,
    file_path: folderPath,
    page_count: pages.length,
    // ...
  });
  
  // 4. Trigger requirement refresh
  onUploadComplete?.();
}
```

---

## Part 4: Mobile-Optimized Camera UI

### Camera Component Features:
- Full viewport height on mobile
- Large capture button (touch-friendly)
- Flash toggle (if available)
- Page counter badge
- Swipe gestures on thumbnail strip
- Safe area insets for notch/home indicator

### CSS Considerations:
```css
/* Use existing mobile detection utils */
.scanner-dialog {
  /* Full screen on mobile */
  height: 100vh;
  padding-bottom: env(safe-area-inset-bottom);
}

.capture-button {
  /* Large touch target */
  width: 72px;
  height: 72px;
}
```

---

## Part 5: Offline Support (Optional Enhancement)

Leverage existing patterns from `CanvassPhotoCapture.tsx` and `OfflinePhotoSyncManager.tsx`:
- Store captured pages in IndexedDB when offline
- Sync when connection restored
- Show pending indicator

---

## Files to Create
| File | Purpose |
|------|---------|
| `src/components/documents/DocumentScannerDialog.tsx` | Main scanner dialog component |

## Files to Modify
| File | Changes |
|------|---------|
| `src/components/ApprovalRequirementsBubbles.tsx` | Replace camera input clicks with dialog, add scanner dialog |
| `src/components/documents/index.ts` | Export new component |

---

## Technical Implementation Details

### Camera Access (proven pattern from CanvassPhotoCapture)
```typescript
const startCamera = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { 
      facingMode: 'environment',  // Back camera
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  videoRef.current.srcObject = stream;
};
```

### Capture to Canvas
```typescript
const capturePhoto = () => {
  const canvas = canvasRef.current;
  const video = videoRef.current;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  
  canvas.toBlob((blob) => {
    setCapturedPages(prev => [...prev, blob]);
  }, 'image/jpeg', 0.9);
};
```

### State Management
```typescript
const [capturedPages, setCapturedPages] = useState<{
  blob: Blob;
  preview: string;
}[]>([]);
```

---

## User Flow After Implementation

1. User taps Contract bubble → popover shows "Scan with Camera" and "Upload from Device"
2. User taps "Scan with Camera" → **Document Scanner Dialog opens**
3. Camera preview shows → User positions first page
4. User taps capture button → Page 1 thumbnail appears at bottom
5. User positions second page → taps capture → Page 2 thumbnail appears
6. User repeats for all pages needed
7. User taps "Upload (N)" → All pages upload
8. Dialog closes → Requirement marked complete

---

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Pages per capture | 1 | Unlimited |
| Camera UX | Native file picker | Custom scanner UI |
| Page review | None | Thumbnail strip |
| Remove page | N/A | Tap X on thumbnail |
| Upload feedback | Basic toast | Progress indicator |
| Mobile experience | Basic | Optimized |
