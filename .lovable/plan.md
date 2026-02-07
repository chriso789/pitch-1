
# Plan: Add Rename Button to Smart Docs Tagged Documents

## Problem

In the **Smart Docs** tab, documents listed under "Tagged Documents" cannot be renamed. The existing rename functionality only appears in the "Company Docs" tab. Users want to rename documents like `ob_customer_completion.pdf` to more descriptive names like `Customer Completion Form`.

## Current State

| Tab | Rename Available? |
|-----|-------------------|
| Company Docs | ✅ Yes - "Rename" button exists |
| Smart Docs (Tagged Documents) | ❌ No - Missing rename button |

The infrastructure is already in place:
- `DocumentRenameDialog` component exists and works
- `renameDoc` state is already defined
- Dialog is already rendered at the bottom of the component

## Solution

Add a "Rename" button to the Tagged Documents section, positioned alongside the existing action buttons (Preview, Edit Tags, Delete, Apply to Lead).

---

## Technical Implementation

### File: `src/components/features/documents/components/SmartDocs.tsx`

**Add Rename button to Tagged Documents row (around line 468):**

Insert the Rename button between the Preview button and the Edit Tags button:

```tsx
{/* Line ~459-499: Tagged Documents action buttons */}
<div className="flex gap-2">
  <Button
    size="sm"
    variant="outline"
    onClick={() => setPreviewDoc(doc)}
    className="gap-1"
  >
    <Eye className="h-4 w-4" />
    Preview
  </Button>
  
  {/* NEW: Add Rename button */}
  <Button
    size="sm"
    variant="outline"
    onClick={() => setRenameDoc(doc)}
    className="gap-1"
  >
    <Pencil className="h-4 w-4" />
    Rename
  </Button>
  
  {canEditSmartTags && (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setTagEditorDoc(doc)}
        className="gap-1"
      >
        <Sparkles className="h-4 w-4" />
        Edit Tags
      </Button>
      {/* ... rest of buttons */}
    </>
  )}
</div>
```

---

## Visual Result

**Before:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ 📄 ob_customer_completion.pdf                                         │
│    🏷️ 14 smart tags  Uploaded 1/4/2026                               │
│                                                                       │
│    [Preview] [Edit Tags] [🗑️] [Apply to Lead]                        │
└──────────────────────────────────────────────────────────────────────┘
```

**After:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ 📄 Customer Completion Form.pdf                                       │
│    🏷️ 14 smart tags  Uploaded 1/4/2026                               │
│                                                                       │
│    [Preview] [Rename] [Edit Tags] [🗑️] [Apply to Lead]              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/features/documents/components/SmartDocs.tsx` | Add Rename button to Tagged Documents section (lines 468-470) |

---

## Expected Behavior

1. User clicks "Rename" button on any tagged document
2. Dialog opens with current filename (minus extension)
3. User edits the name and clicks Save
4. Document is renamed in the database
5. UI refreshes to show new name
6. Extension is preserved (`.pdf` stays `.pdf`)
