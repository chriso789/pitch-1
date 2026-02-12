

## Fix Job Details Page Layout

The Job Details page header is broken because everything (job title, contact card, and action buttons) is crammed into one `flex items-start justify-between` row on line 344. This causes elements to overlap and get cut off, especially on smaller screens. The rest of the page also has issues: the tabs bar has 11 tabs forced into a `grid-cols-10`, and the loading state doesn't use `GlobalLayout`.

### Changes

**File: `src/pages/JobDetails.tsx`**

**1. Fix loading/error states to use GlobalLayout**
- Wrap the loading spinner (lines 302-311) and "not found" state (lines 313-323) inside `<GlobalLayout>` so the sidebar and header remain visible during loading.

**2. Restructure header layout (lines 329-446)**

Replace the current cramped single-row layout with a clean stacked layout:

```text
Row 1: Back button (standalone)
Row 2: Job title + status badges (left) | Action buttons (right)
Row 3: Job number + project number (subtitle)
Row 4: Contact card (full-width, compact horizontal layout)
```

Specific changes:
- Move the "Back to Contact" button to its own row (already done, just ensure separation)
- Put the job title, badges, and action buttons in a flex row with `flex-wrap` so buttons wrap on mobile instead of overflowing
- Convert the contact card from a `w-80` fixed-width card into a compact horizontal bar with contact info inline (name, phone, address all in one row), saving vertical space
- Remove the contact card from inside the title flex row

**3. Fix tabs grid (line 576)**
- Change `grid-cols-10` to use a scrollable flex layout instead, since there are 11 tab triggers (Overview, Activity, Budget, Payments, Comms, Invoices, QBO, Photos, Documents, Timeline, Audit) but only 10 columns defined
- Use `flex overflow-x-auto` on TabsList for proper horizontal scrolling

### Technical Details

| Location | Issue | Fix |
|----------|-------|-----|
| Lines 302-311 | Loading state has no sidebar/nav | Wrap in `GlobalLayout` |
| Lines 313-323 | Error state has no sidebar/nav | Wrap in `GlobalLayout` |
| Lines 344-445 | Title, contact card, buttons all in one row | Stack into separate rows |
| Line 367 | Contact card `w-80` fixed width in flex row | Convert to full-width compact bar |
| Line 576 | `grid-cols-10` but 11 tabs | Use scrollable flex layout |

