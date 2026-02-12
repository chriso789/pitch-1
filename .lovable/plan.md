

## Fix Job Details Page Layout (Final)

### Issues from Screenshot

1. **Title overflow**: The job name "Cesar Yax - 9160 Fountain Road, ..." is truncated. The name combines contact + address, which gets too long.
2. **Tabs cut off**: 11 tabs overflow the container. `overflow-x-auto` is applied but there's no visual scroll indicator, so users don't know more tabs exist (Timeline, Audit are hidden).
3. **Overall spacing/structure**: The header area needs tighter organization matching other pages.

### Changes

**File: `src/pages/JobDetails.tsx`**

**1. Fix the title display (lines 350-367)**
- Show the contact name and address on separate lines instead of one combined truncated title
- Title line: Just the contact name (e.g., "Cesar Yax") with status badges
- Subtitle line: Full address + job number + project number
- This prevents truncation and keeps all info visible

**2. Fix the tabs to be scrollable with visual cues (line 567)**
- Add `scrollbar-thin` and padding/gradient fade hints so users can see there are more tabs
- Wrap in a relative container with a right-side fade gradient to indicate scrollability
- Ensure `flex-shrink-0` on each TabsTrigger so they don't compress

**3. Clean up the contact bar (lines 407-436)**
- The address currently duplicates city: "9160 Fountain Road, Wellington, FL 33467-4736 US, Wellington," -- this is a data issue but the display should handle it gracefully by not repeating
- Add `truncate` on the address span with a `max-w` to prevent it from stretching the layout

**4. Ensure consistent indentation of main content inside GlobalLayout (lines 331-744)**
- The opening `div` at line 331 and closing at line 744 have inconsistent nesting -- fix the indentation so the whole page body is properly inside `max-w-7xl`

### Technical Summary

| Area | Problem | Fix |
|------|---------|-----|
| Title (line 352) | Combined name+address truncates | Split into name (h1) and address (subtitle) |
| Tabs (line 567) | 11 tabs overflow with no scroll indicator | Add fade gradient hint + `flex-shrink-0` on triggers |
| Contact bar (line 432) | Address duplicates city name | Trim trailing duplicate + add max-width |
| Structure (lines 331-744) | Minor indentation inconsistency | Clean up nesting |
