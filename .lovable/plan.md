

## Add Pipeline-Specific Autocomplete Search

### What Changes

Replace the plain text search input in the pipeline with an autocomplete dropdown that shows matching **leads/projects** (pipeline entries) as you type — not contacts.

### Current Behavior
- The search bar filters the kanban columns in real-time but shows no dropdown suggestions
- The `AutocompleteSearch` component elsewhere queries the **contacts** table directly

### New Behavior
- As you type 2+ characters, a dropdown appears showing matching pipeline entries
- Each suggestion shows the CLJ number, contact name, status badge, and address
- Clicking a suggestion navigates to that lead's details page
- The kanban columns still filter in real-time as you type (existing behavior preserved)

### Technical Details

**File: `src/features/pipeline/components/Pipeline.tsx`**

Replace the plain `<Input>` search (lines 1079-1096) with a new `PipelineSearch` component that:
- Uses the existing `pipelineData` (already loaded) to find matches client-side — no extra database queries needed
- Searches across all stages by contact name, CLJ number, and address
- Shows a dropdown with up to 8 matching entries
- Each dropdown item displays:
  - CLJ number (e.g., `C3076-L1-J0`)
  - Contact name
  - Current stage as a small badge
  - Address snippet
- Clicking a result navigates to `/lead/{entry.id}`
- Typing still filters the kanban board in real-time (keep `setSearchQuery`)
- The X button to clear search remains

**New File: `src/features/pipeline/components/PipelineSearch.tsx`**

A self-contained autocomplete component that:
- Accepts `pipelineData` (the grouped data object) and `stages` as props
- Flattens all entries across stages for searching
- Debounces input (300ms) before showing suggestions
- Handles click-outside to dismiss dropdown
- Uses the same search logic as `filterBySearch` (name, CLJ number, address)

| File | Change |
|------|--------|
| `src/features/pipeline/components/PipelineSearch.tsx` | New component — pipeline-specific autocomplete |
| `src/features/pipeline/components/Pipeline.tsx` | Replace plain Input with PipelineSearch component |

