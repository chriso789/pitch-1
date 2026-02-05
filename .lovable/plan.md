
# Fix SmartDocs Tag Save Issue

## Problem
When saving the `workmanship_lien_release.pdf` document in SmartDocs, the tag placements are not being saved to the database. The document shows 0 placements despite the user adding tags and clicking Save.

## Root Cause Analysis

Looking at the save flow in `DocumentTagEditor.tsx`:

1. **Line 650-668**: `collectCurrentPageTags()` filters canvas objects for those with `tagKey` property
2. **Line 716**: Tags are added with `(tagRect as any).tagKey = tagKey`
3. **Line 777-835**: `handleSave()` collects tags, deletes existing, and inserts new

**Potential Issues:**
- Canvas objects may not be properly retaining the `tagKey` property after canvas operations
- The Fabric.js 6.x property assignment using `(object as any).tagKey` may be getting lost during serialization/deserialization
- Race condition where save is called before canvas fully renders the PDF page

## Technical Solution

### 1. Use Fabric.js Custom Properties Properly

Fabric.js requires custom properties to be registered to persist across operations. Add `tagKey` and `isLabel` to the object's `stateProperties`:

```typescript
// When creating tag rectangle
const tagRect = new Rect({
  left,
  top,
  width,
  height,
  fill: "rgba(59, 130, 246, 0.15)",
  stroke: "#3b82f6",
  strokeWidth: 2,
  rx: 4,
  ry: 4,
  hasControls: true,
  hasBorders: true,
});

// Use Fabric.js 6.x proper custom property assignment
tagRect.set('tagKey', tagKey);
```

### 2. Add Debug Logging to Save Function

Add console logging to trace exactly what's happening:

```typescript
const handleSave = async () => {
  console.log("[Save] Starting save, canvas:", !!fabricCanvas, "tenantId:", tenantId);
  
  const currentTags = collectCurrentPageTags();
  console.log("[Save] Collected tags from current page:", currentTags.length, currentTags);
  
  // ... rest of save logic
};
```

### 3. Fix collectCurrentPageTags to Handle Fabric.js 6.x

```typescript
const collectCurrentPageTags = (): TagPlacement[] => {
  if (!fabricCanvas) {
    console.warn("[collectCurrentPageTags] No canvas available");
    return [];
  }
  
  const objects = fabricCanvas.getObjects();
  console.log("[collectCurrentPageTags] Total objects on canvas:", objects.length);
  
  const tagRects = objects.filter((obj: any) => {
    const hasTagKey = obj.tagKey || obj.get?.('tagKey');
    const isNotLabel = !obj.isLabel && !obj.get?.('isLabel');
    return hasTagKey && isNotLabel;
  });
  
  console.log("[collectCurrentPageTags] Tag rects found:", tagRects.length);
  // ... rest of function
};
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/features/documents/components/DocumentTagEditor.tsx` | Fix custom property assignment, add debug logging, improve tag collection |

## Testing After Fix

1. Open SmartDocs
2. Click Edit on `workmanship_lien_release.pdf`
3. Add 2-3 smart tags to the document
4. Check browser console for debug logs
5. Click Save
6. Verify toast shows "Saved X tag placements"
7. Close editor and verify document appears in "Tagged Documents" section
8. Re-open document and verify tags are displayed

