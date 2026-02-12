

## Fix: Job Details Page Header Layout Broken by Long Name

### Problem

The job name (`h1`) is set to `text-3xl font-bold` inside a flex container, but there are no width constraints or text overflow handling. When the job name is long (e.g., includes the full address), the text wraps across many lines and pushes the entire header layout out of shape.

### Fix

**File: `src/pages/JobDetails.tsx`**

1. **Add `min-w-0` to the flex-1 container** (line 346) -- this is required for flex children to allow text truncation/overflow to work properly.

2. **Truncate the h1 heading** (line 348) -- add `truncate` class so long names are cut off with an ellipsis instead of wrapping endlessly. Also reduce from `text-3xl` to `text-2xl` for a more reasonable header size.

3. **Add a tooltip or title attribute** on the h1 so the full name is still accessible on hover.

4. **Restructure the header flex layout** (line 329) -- change from `flex items-start justify-between` to a layout that keeps the "Back to Contact" button on its own row above the header, preventing it from being pushed down by the tall text block:
   - Move the back button outside the flex row
   - Use `flex items-start gap-4` between the name/badges and the contact card
   - Add `min-w-0` to the name container so truncation works

### Result

The header will show a clean, single-line job name with ellipsis for overflow, the contact card stays aligned to the right, and the back button sits cleanly above.

