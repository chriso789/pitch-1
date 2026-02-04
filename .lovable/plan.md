
# Add Document Scanner to Documents Tab

## Overview

Add a "Scan Document" button to the Documents section that opens the professional document scanner, allowing users to scan documents with their device camera and save them directly to a selected document folder (category).

---

## Current State

| Component | Status |
|-----------|--------|
| `DocumentScannerDialog` | Exists - full OpenCV edge detection, perspective correction, multi-page PDF generation |
| `DocumentsTab` | Has folder grid, upload dropdown, but no scan button |
| Scanner in ApprovalRequirementsBubbles | Working - preset document type |

---

## Implementation Approach

### Option A: Scan Button Opens Category Selection Dialog First
User clicks "Scan" → selects folder/category → scanner opens → saves to that folder

### Option B: Scan Button Opens Scanner Directly → Category Selection After
User clicks "Scan" → captures pages → selects folder on save → saves to that folder

**Recommendation:** Option A is cleaner UX - user decides destination upfront before scanning.

---

## Changes Required

### 1. Modify DocumentsTab.tsx

**Add state variables:**
- `scannerOpen` - controls scanner dialog visibility
- `scanCategory` - selected category for scanned document
- `showCategoryPickerForScan` - shows folder picker dialog

**Add UI elements:**
1. Add "Scan Document" button next to "Upload Document" dropdown
2. Create category picker dialog that opens when scan button is clicked
3. Import and render `DocumentScannerDialog` with selected category

**Location of scan button:** In the CardHeader alongside the upload dropdown and "Add Smart Doc" button

```text
┌─────────────────────────────────────────────────────┐
│ 📁 Documents                                        │
│                    [Scan Doc] [Upload ▾] [SmartDoc] │
├─────────────────────────────────────────────────────┤
```

### 2. Category Picker Dialog

Simple dialog with the same folder grid shown on the main view:
- Shows all 8 document categories
- User taps a category → scanner opens with that category preset
- Scanner saves to that folder automatically

---

## UI Flow

```text
User Flow:
1. User taps "Scan Document" button
2. Category picker dialog appears (grid of 8 folders)
3. User taps desired folder (e.g., "Insurance", "Contracts")
4. Dialog closes, scanner dialog opens
5. User captures pages with camera
6. User taps "Upload" in scanner
7. PDF is saved to the selected folder
8. Success toast, documents list refreshes
```

---

## Code Changes

### File: `src/components/DocumentsTab.tsx`

**1. Add imports:**
```typescript
import { Camera } from 'lucide-react';
import { DocumentScannerDialog } from '@/components/documents/DocumentScannerDialog';
```

**2. Add state variables (after existing state):**
```typescript
const [scannerOpen, setScannerOpen] = useState(false);
const [scanCategory, setScanCategory] = useState<string>('other');
const [showScanCategoryPicker, setShowScanCategoryPicker] = useState(false);
```

**3. Add category selection handler:**
```typescript
const handleStartScan = (category: string) => {
  setScanCategory(category);
  setShowScanCategoryPicker(false);
  setScannerOpen(true);
};
```

**4. Add Scan button to CardHeader (alongside Upload dropdown):**
```typescript
<Button 
  variant="outline"
  onClick={() => setShowScanCategoryPicker(true)}
>
  <Camera className="h-4 w-4 mr-2" />
  Scan Document
</Button>
```

**5. Add Category Picker Dialog:**
```typescript
<Dialog open={showScanCategoryPicker} onOpenChange={setShowScanCategoryPicker}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Select Document Folder</DialogTitle>
    </DialogHeader>
    <div className="grid grid-cols-2 gap-3 py-4">
      {DOCUMENT_CATEGORIES.map((category) => {
        const Icon = category.icon;
        return (
          <Button
            key={category.value}
            variant="outline"
            className="h-auto py-4 flex flex-col items-center gap-2"
            onClick={() => handleStartScan(category.value)}
          >
            <div className={`${category.color} text-white p-2 rounded-lg`}>
              <Icon className="h-5 w-5" />
            </div>
            <span className="text-sm">{category.label}</span>
          </Button>
        );
      })}
    </div>
  </DialogContent>
</Dialog>
```

**6. Add DocumentScannerDialog at end of component:**
```typescript
<DocumentScannerDialog
  open={scannerOpen}
  onOpenChange={setScannerOpen}
  documentType={scanCategory}
  documentLabel={getCategoryDetails(scanCategory)?.label || 'Document'}
  pipelineEntryId={pipelineEntryId}
  onUploadComplete={() => {
    fetchDocuments();
    onUploadComplete?.();
  }}
/>
```

---

## Folder View Enhancement (Bonus)

When inside a folder view (`activeFolder` is set), also add a scan button:

```typescript
{/* In active folder header section */}
<div className="flex gap-2">
  <Button 
    onClick={() => triggerFileInput(activeFolder)}
    disabled={uploading}
  >
    <Upload className="h-4 w-4 mr-2" />
    Upload
  </Button>
  <Button 
    variant="outline"
    onClick={() => {
      setScanCategory(activeFolder);
      setScannerOpen(true);
    }}
  >
    <Camera className="h-4 w-4 mr-2" />
    Scan
  </Button>
</div>
```

This allows users to scan directly when browsing a specific folder.

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/components/DocumentsTab.tsx` | Add scan button, category picker dialog, DocumentScannerDialog integration |

---

## Mobile Considerations

The scanner is already mobile-optimized with:
- Back camera preference (`facingMode: 'environment'`)
- Touch-friendly capture button
- Full-screen camera view
- Edge detection with visual feedback
- Manual crop fallback

No additional mobile changes needed.

---

## Testing Checklist

After implementation:
1. Click "Scan Document" button in Documents section
2. Verify category picker dialog appears with all 8 folders
3. Select a category (e.g., "Insurance")
4. Verify scanner opens with camera access
5. Capture a document page
6. Verify edge detection overlay works
7. Add additional pages if needed
8. Click Upload
9. Verify PDF is created in the selected folder
10. Navigate to that folder and confirm document appears
11. Test folder-view scan button (when inside a folder)
