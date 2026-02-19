
# Move Save Button Next to Reset Defaults

## Problem
The three action buttons (Save, Share, Export PDF) are crowded in one row and getting cut off. The Save button logically belongs next to "Reset Defaults" since both are document-management actions, while Share and Export are distribution actions.

## Change

### File: `src/components/estimates/EstimatePreviewPanel.tsx` (lines 758-824)

Restructure the footer to have two rows:

**Row 1** (full width, two buttons side by side):
- **Reset Defaults** (ghost, left) 
- **Save** (outline, right)

**Row 2** (full width, two buttons side by side):
- **Share** (outline, flex-1)
- **Export PDF** (primary, flex-1)

This gives each button more space and groups them logically:
- Top row = document state actions (reset / save)
- Bottom row = distribution actions (share / export)

### Layout Code

```typescript
{/* Bottom Actions */}
<div className="sticky bottom-0 z-20 ...">
  {/* Row 1: Reset + Save */}
  <div className="flex gap-2">
    <Button variant="ghost" size="sm" onClick={handleResetToDefaults} className="flex-1">
      <RotateCcw /> Reset Defaults
    </Button>
    <Button variant="outline" size="sm" onClick={handleSaveToDocuments} disabled={...} className="flex-1">
      <Save /> Save
    </Button>
  </div>
  {/* Row 2: Share + Export */}
  <div className="flex gap-2">
    <Button variant="outline" onClick={handlePrepareAndShare} ...>
      <Share2 /> Share
    </Button>
    <Button onClick={handleExportPDF} ...>
      <Download /> Export PDF
    </Button>
  </div>
</div>
```

No other files affected.
