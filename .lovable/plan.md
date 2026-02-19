

# Fix: Mobile Tab Layout and Move Notes to Lead Header

## Problems (from screenshots)

1. **Tabs too wide on mobile** -- The TabsList with 5 tabs (Comms, Photos, Notes, Activity, Timeline) stretches beyond its container. Missing the scroll-and-fade pattern required by mobile nav standards.
2. **"Notes" tab doesn't belong here** -- The Notes tab is a simple lead notes textarea that should be a compact one-liner in the lead details header area, not buried in the tabbed section alongside Photos and Comms.
3. **Internal Team Notes already exists above** -- There's already an `InternalNotesSection` card between the header and approval requirements (line 1044-1050). The "Notes" tab duplicates note-taking in a confusing way.

## Solution

### 1. Move Lead Notes inline into the header area (one-liner)

Replace the `InternalNotesSection` standalone card (lines 1044-1050) placement with a compact layout that includes BOTH the `LeadNotesSection` (simple lead notes) as a one-line expandable field in the stats/details area, AND keeps the Internal Team Notes card.

Specifically, add the `LeadNotesSection` as a compact inline row right after the stats bar (after line 861), styled as a single-line input that expands on focus/click. This puts lead notes directly in the header where the user expects them.

### 2. Remove "Notes" tab from the tabbed card

Remove the Notes `TabsTrigger` and `TabsContent` from the Comms/Photos tab card (lines 1089-1092 and 1157-1163). This reduces the tab count from 5 to 4, giving more breathing room on mobile.

### 3. Fix tab overflow on mobile with scroll-and-fade pattern

Apply the established mobile navigation pattern to the remaining TabsList:
- Add `flex flex-nowrap overflow-x-auto` to the TabsList
- Add `flex-shrink-0` to each TabsTrigger
- Add a right-side fade gradient as a visual cue for scrollable content
- Remove fixed `h-8` constraint that compresses tabs on small screens

## Technical Changes

### `src/pages/LeadDetails.tsx`

**A) Add inline notes row after stats bar (~line 861)**

```tsx
{/* Inline Lead Notes - compact one-liner */}
<div className="flex items-start gap-2 mt-2">
  <StickyNote className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
  <LeadNotesSection 
    pipelineEntryId={id!}
    initialNotes={lead.notes}
    onNotesUpdate={refetchLead}
  />
</div>
```

**B) Update `LeadNotesSection` component** to support a compact inline mode: single-line input that shows a truncated preview, expanding to full textarea on click/focus.

**C) Remove Notes tab trigger and content** from the tabbed card (lines 1089-1092 and 1157-1163).

**D) Fix TabsList for mobile** (line 1075):

```tsx
<TabsList className="h-auto flex flex-nowrap overflow-x-auto w-full justify-start gap-1 bg-transparent p-0">
  <TabsTrigger value="comms" className="text-xs h-7 px-3 flex-shrink-0">
    ...
  </TabsTrigger>
  {/* etc */}
</TabsList>
```

### `src/components/lead-details/LeadNotesSection.tsx`

Refactor to support a compact inline mode:
- Default display: single-line text preview showing truncated notes (or "Add notes..." placeholder)
- On click: expand to a textarea for editing
- Auto-save on blur/debounce (already implemented)
- Visually fits within the lead header stats area

## Result
- Lead notes appear as a one-line field directly in the lead details header -- always visible, no tab navigation needed
- Photos tab has more room on mobile without the Notes tab competing for space
- Remaining tabs (Comms, Photos, Activity, Timeline) use scroll-and-fade on mobile to prevent overflow
- Internal Team Notes card remains as a separate section below the header (unchanged)
