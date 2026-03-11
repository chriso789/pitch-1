

# Fix Status Badge Double-Click on Lead Details

## Problem
The status badge (e.g., "Ready for Approval") requires two clicks: first click switches from badge to a `<Select>` component, second click opens the dropdown. This feels like a double-click.

## Fix

**File: `src/pages/LeadDetails.tsx` (lines 739-776)**

Replace the two-mode pattern (badge → Select) with a single `Select` that is always rendered but styled to look like the current badge. This way one click opens the dropdown directly.

- Remove the `isEditingStatus` state toggle pattern
- Replace the conditional render with a single `Select` component styled as a pill/badge
- Use `onOpenChange` to detect when the dropdown closes (no need for separate edit mode)
- Style the `SelectTrigger` to match the current badge appearance (rounded-full, colored dot, etc.)

```tsx
// Replace lines 739-776 with:
<Select 
  value={lead.status} 
  onValueChange={handleStatusUpdateWithCheck}
>
  <SelectTrigger className="h-auto w-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer hover:bg-muted transition-colors [&>svg:last-child]:hidden">
    <div className={`w-2 h-2 rounded-full ${stages.find(s => s.key === lead.status)?.color || 'bg-gray-500'}`} />
    <span className="text-sm font-medium capitalize">
      {stages.find(s => s.key === lead.status)?.name || lead.status.replace('_', ' ')}
    </span>
    <ChevronDown className="h-4 w-4 text-muted-foreground" />
  </SelectTrigger>
  <SelectContent>
    {/* same filtered stages content */}
  </SelectContent>
</Select>
```

This also lets us remove the `isEditingStatus` state variable (line 326) since it's no longer needed. The same approach should be checked for the sales rep and secondary rep selects if they have the same pattern (they do -- lines 873-913 and 918-986), but those are less frequently used so can be addressed separately if desired.

