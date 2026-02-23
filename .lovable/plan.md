

# Move Inspection Button to Lead Details Header Area

## What Changes

Remove the "Inspection" tab from the tabs section and instead place a compact "Start Inspection" button directly in the lead details header area -- near the Rep/Split Rep row (around line 995). This makes it immediately visible without needing to click any tab.

## Specific Changes

### File: `src/pages/LeadDetails.tsx`

1. **Remove the Inspection tab trigger** (line 1111-1114) from the TabsList
2. **Remove the Inspection TabsContent** (lines 1190-1204) from the tabs card
3. **Add an inline Inspection row** below the Rep/Split Rep row (after line ~995), styled similarly to the rep row:
   - A compact row with a `ClipboardCheck` icon, "Inspection" label, the "Start Inspection" button, and the `InspectionHistory` component (showing past inspection count/list inline)
   - Layout: `flex items-center gap-2` to keep it on one line, matching the density of the stats bar and rep row above it

### Layout

The new row will sit between the Rep row and the Contact card, looking like:

```
Rep: Taylor Johnston  |  Split Rep: + Add Split Rep
Inspection: [Start Inspection]  (past: 2 completed)
```

This keeps all lead-level actions visible above the fold without requiring tab navigation.
