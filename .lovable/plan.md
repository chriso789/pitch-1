

# Add "View Lead Details" Navigation from Contact Profile

## Problem
The contact profile page for Nicole Walker shows pipeline entry cards at the top (the card with "Pipeline Lead", status badge, CLJ numbers, and win probability), but those cards have no button or link to navigate to the Lead Details page (`/lead/{pipeline_entry_id}`). The only action available is "Quick Convert to Job" for `ready_for_approval` entries.

The "View" button exists in the Pipeline tab's converter section, but the prominent pipeline summary cards at the top of the page lack direct navigation.

## Solution

Add a "View Details" button to each pipeline summary card in the Contact Profile header section, allowing one-click navigation to `/lead/{entry.id}`.

## Changes

**File: `src/pages/ContactProfile.tsx`**

In the pipeline status cards section (lines 306-368), add a "View Details" button next to the existing "Quick Convert to Job" button. For all pipeline entries (not just `ready_for_approval`), add a button that navigates to `/lead/{entry.id}`.

Specifically, inside each pipeline card's `CardContent` (after the win probability section around line 347), add:

```
<div className="pt-3 border-t flex gap-2">
  <Button 
    variant="outline" 
    className="flex-1"
    onClick={() => navigate(`/lead/${entry.id}`)}
  >
    <Eye className="h-4 w-4 mr-2" />
    View Details
  </Button>
  {entry.status === 'ready_for_approval' && (
    <JobApprovalDialog ...>
      <Button className="flex-1">
        Quick Convert to Job
      </Button>
    </JobApprovalDialog>
  )}
</div>
```

This replaces the current structure where "Quick Convert to Job" only shows for `ready_for_approval` entries and no navigation exists otherwise.

The `Eye` icon import already exists in the file's import list (it's used in `ContactJobsTab`), so we just need to add it to the `ContactProfile.tsx` imports.

## Technical Details

| File | Change |
|------|--------|
| `src/pages/ContactProfile.tsx` | Add `Eye` to lucide-react imports; add "View Details" button to pipeline summary cards that navigates to `/lead/{entry.id}` |

## Result
- Every pipeline card at the top of the Contact Profile will have a "View Details" button
- Clicking it navigates to `/lead/{pipeline_entry_id}` (the Lead Details page)
- For `ready_for_approval` entries, both "View Details" and "Quick Convert to Job" buttons appear side by side

