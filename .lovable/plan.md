

## Standardize Project Details Page to Match Lead/Job Page Protocol

The Project Details page (`src/features/projects/components/ProjectDetails.tsx`) was built separately and never aligned with the layout standards used by the Lead Details and Job Details pages. Here are the specific problems and fixes.

### Problems Found

| Issue | Lead/Job Page | Project Page |
|-------|--------------|--------------|
| Sidebar + top nav | Uses GlobalLayout | No GlobalLayout -- missing sidebar entirely |
| Content container | max-w-7xl mx-auto | No max-width -- stretches full screen |
| Header structure | Name on line 1, address + badges below, contact bar | Everything crammed in one row, gradient text |
| Back button | "Back to Contact" linking to contact | "Back to Dashboard" hardcoded |
| Loading state | Wrapped in GlobalLayout with spinner | Plain "Loading..." text |
| Tab navigation | Scrollable flex with fade gradient | flex-wrap (breaks on many tabs) |

### Changes

**File 1: `src/pages/ProjectDetails.tsx`**
- Wrap `ProjectDetails` in `GlobalLayout` so the sidebar and top nav are always visible (same pattern as LeadDetailsPage)

**File 2: `src/features/projects/components/ProjectDetails.tsx`**

1. **Wrap content in `max-w-7xl mx-auto`** to constrain width and match other detail pages

2. **Fix loading/error states** -- show proper centered spinner with message instead of plain text

3. **Restructure the header** to match the Job Details pattern:
   - Row 1: Back button (navigating to the contact, not hardcoded to dashboard)
   - Row 2: Contact name (plain text, not gradient) + status badge + action buttons
   - Row 3: Subtitle with project number, address, and job info
   - Row 4: Compact contact info bar (same as Job Details page)

4. **Fix tabs** to use scrollable flex layout with `overflow-x-auto`, `flex-shrink-0` on triggers, and a right-side fade gradient -- matching the Job Details page exactly

5. **Remove the gradient text styling** on the title (`gradient-primary bg-clip-text text-transparent`) to use a standard `text-2xl font-bold` like other pages

### Technical Details

| Location | Current | Fix |
|----------|---------|-----|
| `ProjectDetails.tsx` line 226 | `<div className="space-y-6">` | Add `max-w-7xl mx-auto` |
| `ProjectDetails.tsx` line 202 | Plain text loading | Centered Loader2 spinner |
| `ProjectDetails.tsx` line 227 | BackButton to "/dashboard" | Back to contact with contact ID |
| `ProjectDetails.tsx` line 236 | Gradient text h1 | Standard `text-2xl font-bold` matching Job page |
| `ProjectDetails.tsx` line 361 | `<TabsList className="flex-wrap">` | `flex overflow-x-auto` with fade gradient |
| `ProjectDetails.tsx` lines 376-440 | Customer/Project info as overview tab only | Add compact contact bar in header (always visible) |
| `ProjectDetailsPage.tsx` line 16 | No GlobalLayout | Wrap in GlobalLayout |

