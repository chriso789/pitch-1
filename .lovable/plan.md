

# Fix Mobile Menu Button — Inline Instead of Floating

## Problem
The mobile hamburger menu button is `fixed` positioned, floating over the content with a translucent background, border, and shadow. The screenshot shows it should be integrated inline within the header bar, matching the webapp's layout.

## Solution
Move the menu button from `CollapsibleSidebar` (where it's `fixed`) into `GlobalLayout`'s mobile header row, placing it inline at the left of the top bar — no floating, no extra background/border/shadow.

### Changes

**`src/components/ui/collapsible-sidebar.tsx`**
- Remove the fixed-position `<Button>` that renders the hamburger icon (lines 44-52)
- Instead, accept an `onOpen` callback prop and expose it, or simply keep the Sheet but let the trigger come from outside
- Actually simpler: export `isMobileOpen` / `setIsMobileOpen` via a passed prop or move the Sheet trigger into GlobalLayout

Best approach: Have `CollapsibleSidebar` accept an `onOpenMobile` render pattern. But simplest is:
- Remove the floating button from `CollapsibleSidebar`
- Pass `isMobileOpen` and `setIsMobileOpen` up, or embed the menu button directly in `GlobalLayout`'s header

**`src/shared/components/layout/GlobalLayout.tsx`**
- In the mobile header Row 1, replace the `pl-14` left padding with the actual hamburger `<Menu>` button inline
- The button triggers the sidebar Sheet open
- Remove `pt-14` padding on `<main>` since there's no floating button to accommodate

### Concrete approach
1. `CollapsibleSidebar`: Remove the fixed button. Export a context or accept `mobileOpen`/`setMobileOpen` as props so GlobalLayout can control it.
2. `GlobalLayout`: Place the `<Menu>` icon button as the first element in the mobile header row (before `QuickLocationSwitcher`), styled as a simple ghost button without floating styles. Remove `pt-14`.

